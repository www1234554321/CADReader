import { CADRenderer } from '../cad/renderer';
import { HistoryManager } from '../cad/history';
import {
  CADEntity,
  Point2D,
  LineEntity,
  PolylineEntity,
  CircleEntity,
  TextEntity
} from '../cad/types';
import { calculateBoundingBox } from '../cad/parser';

export type ToolMode =
  | 'select'
  | 'pan'
  | 'measure_length'
  | 'measure_area'
  | 'calibrate'
  | 'draw_line'
  | 'draw_rect'
  | 'draw_circle'
  | 'draw_text'
  | 'move';

export class EditorTool {
  private renderer: CADRenderer;
  private history: HistoryManager;
  public activeMode: ToolMode = 'select';

  // Selection & Mouse interactions
  private isMouseDown: boolean = false;
  private dragStartWorld: Point2D | null = null;
  private dragStartScreen: Point2D | null = null;
  private currentMouseWorld: Point2D | null = null;

  // Multi-step drawing tool state
  private tempDrawPoints: Point2D[] = [];

  // Move operation state
  private moveBasePoint: Point2D | null = null;

  public onSelectionChange?: (selectedEntities: CADEntity[]) => void;
  public onTextPromptRequest?: (callback: (text: string) => void) => void;

  constructor(renderer: CADRenderer, history: HistoryManager) {
    this.renderer = renderer;
    this.history = history;
    this.setupOverlay();
  }

  public setMode(mode: ToolMode) {
    this.activeMode = mode;
    this.tempDrawPoints = [];
    this.moveBasePoint = null;
    this.dragStartWorld = null;
    this.renderer.requestRender();
  }

  private setupOverlay() {
    this.renderer.overlayCallback = (ctx) => this.renderOverlay(ctx);
  }

  public handleMouseDown(screenPt: Point2D, button: number) {
    this.isMouseDown = true;
    this.dragStartScreen = screenPt;
    const worldPt = this.renderer.screenToWorld(screenPt);
    this.dragStartWorld = worldPt;

    // Middle mouse or pan tool triggers pan
    if (button === 1 || this.activeMode === 'pan') return;

    if (this.activeMode === 'select') {
      const doc = this.renderer.getDocument();
      if (!doc) return;

      // Single click selection test
      const clickedEntity = this.hitTest(worldPt, doc.entities);
      if (clickedEntity) {
        this.renderer.selectedIds.clear();
        this.renderer.selectedIds.add(clickedEntity.id);
      } else {
        this.renderer.selectedIds.clear();
      }
      this.notifySelectionChange();
      this.renderer.requestRender();
    } else if (this.activeMode === 'draw_line' || this.activeMode === 'draw_rect' || this.activeMode === 'draw_circle') {
      this.tempDrawPoints.push(worldPt);

      if (this.activeMode === 'draw_line' && this.tempDrawPoints.length === 2) {
        this.finishDrawLine();
      } else if (this.activeMode === 'draw_rect' && this.tempDrawPoints.length === 2) {
        this.finishDrawRect();
      } else if (this.activeMode === 'draw_circle' && this.tempDrawPoints.length === 2) {
        this.finishDrawCircle();
      }
    } else if (this.activeMode === 'draw_text') {
      if (this.onTextPromptRequest) {
        this.onTextPromptRequest((text) => {
          if (text && text.trim().length > 0) {
            this.finishDrawText(worldPt, text);
          }
        });
      }
    } else if (this.activeMode === 'move') {
      if (this.renderer.selectedIds.size > 0) {
        if (!this.moveBasePoint) {
          this.moveBasePoint = worldPt;
        } else {
          this.finishMove(worldPt);
        }
      }
    }
  }

  public handleMouseMove(screenPt: Point2D, isDragging: boolean) {
    const worldPt = this.renderer.screenToWorld(screenPt);
    this.currentMouseWorld = worldPt;

    if (this.isMouseDown && this.dragStartScreen) {
      // Pan canvas if middle mouse or pan mode or dragging background
      if (this.activeMode === 'pan' || (isDragging && this.activeMode === 'select' && this.renderer.selectedIds.size === 0)) {
        const dx = screenPt.x - this.dragStartScreen.x;
        const dy = screenPt.y - this.dragStartScreen.y;
        this.renderer.panX += dx;
        this.renderer.panY -= dy; // Screen vs world Y inversion
        this.dragStartScreen = screenPt;
        this.renderer.requestRender();
        return;
      }
    }

    this.renderer.requestRender();
  }

  public handleMouseUp(screenPt: Point2D) {
    this.isMouseDown = false;
    this.dragStartWorld = null;
    this.dragStartScreen = null;
  }

  public deleteSelected() {
    const doc = this.renderer.getDocument();
    if (!doc || this.renderer.selectedIds.size === 0) return;

    this.history.pushState(doc);
    doc.entities = doc.entities.filter(ent => !this.renderer.selectedIds.has(ent.id));
    this.renderer.selectedIds.clear();
    doc.bounds = calculateBoundingBox(doc.entities);
    this.notifySelectionChange();
    this.renderer.requestRender();
  }

  public updateSelectedProperty(props: { layer?: string; color?: string; text?: string }) {
    const doc = this.renderer.getDocument();
    if (!doc || this.renderer.selectedIds.size === 0) return;

    this.history.pushState(doc);
    for (const ent of doc.entities) {
      if (this.renderer.selectedIds.has(ent.id)) {
        if (props.layer) ent.layer = props.layer;
        if (props.color) ent.color = props.color;
        if (props.text && (ent.type === 'TEXT' || ent.type === 'MTEXT')) {
          ent.text = props.text;
        }
      }
    }
    this.notifySelectionChange();
    this.renderer.requestRender();
  }

  private hitTest(worldPt: Point2D, entities: CADEntity[]): CADEntity | null {
    const toleranceWorld = 12 / this.renderer.zoom; // 12px tolerance

    for (let i = entities.length - 1; i >= 0; i--) {
      const ent = entities[i];
      switch (ent.type) {
        case 'LINE': {
          const dist = this.pointToSegmentDistance(worldPt, ent.start, ent.end);
          if (dist <= toleranceWorld) return ent;
          break;
        }
        case 'LWPOLYLINE':
        case 'POLYLINE': {
          if (ent.vertices && ent.vertices.length >= 2) {
            for (let j = 0; j < ent.vertices.length - 1; j++) {
              const dist = this.pointToSegmentDistance(worldPt, ent.vertices[j], ent.vertices[j + 1]);
              if (dist <= toleranceWorld) return ent;
            }
          }
          break;
        }
        case 'CIRCLE':
        case 'ARC': {
          const distToCenter = Math.hypot(worldPt.x - ent.center.x, worldPt.y - ent.center.y);
          if (Math.abs(distToCenter - ent.radius) <= toleranceWorld) return ent;
          break;
        }
        case 'TEXT':
        case 'MTEXT': {
          const dist = Math.hypot(worldPt.x - ent.position.x, worldPt.y - ent.position.y);
          if (dist <= toleranceWorld * 2 || dist <= ent.height) return ent;
          break;
        }
      }
    }
    return null;
  }

  private pointToSegmentDistance(p: Point2D, a: Point2D, b: Point2D): number {
    const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const proj = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    return Math.hypot(p.x - proj.x, p.y - proj.y);
  }

  private finishDrawLine() {
    const doc = this.renderer.getDocument();
    if (!doc || this.tempDrawPoints.length < 2) return;

    this.history.pushState(doc);
    const newEntity: LineEntity = {
      id: `line_${Date.now()}`,
      type: 'LINE',
      layer: '0',
      start: this.tempDrawPoints[0],
      end: this.tempDrawPoints[1]
    };
    doc.entities.push(newEntity);
    doc.bounds = calculateBoundingBox(doc.entities);
    this.tempDrawPoints = [];
    this.renderer.requestRender();
  }

  private finishDrawRect() {
    const doc = this.renderer.getDocument();
    if (!doc || this.tempDrawPoints.length < 2) return;

    this.history.pushState(doc);
    const p1 = this.tempDrawPoints[0];
    const p2 = this.tempDrawPoints[1];

    const newEntity: PolylineEntity = {
      id: `rect_${Date.now()}`,
      type: 'LWPOLYLINE',
      layer: '0',
      closed: true,
      vertices: [
        { x: p1.x, y: p1.y },
        { x: p2.x, y: p1.y },
        { x: p2.x, y: p2.y },
        { x: p1.x, y: p2.y }
      ]
    };
    doc.entities.push(newEntity);
    doc.bounds = calculateBoundingBox(doc.entities);
    this.tempDrawPoints = [];
    this.renderer.requestRender();
  }

  private finishDrawCircle() {
    const doc = this.renderer.getDocument();
    if (!doc || this.tempDrawPoints.length < 2) return;

    this.history.pushState(doc);
    const center = this.tempDrawPoints[0];
    const edge = this.tempDrawPoints[1];
    const radius = Math.hypot(edge.x - center.x, edge.y - center.y);

    const newEntity: CircleEntity = {
      id: `circle_${Date.now()}`,
      type: 'CIRCLE',
      layer: '0',
      center,
      radius
    };
    doc.entities.push(newEntity);
    doc.bounds = calculateBoundingBox(doc.entities);
    this.tempDrawPoints = [];
    this.renderer.requestRender();
  }

  private finishDrawText(position: Point2D, text: string) {
    const doc = this.renderer.getDocument();
    if (!doc) return;

    this.history.pushState(doc);
    const newEntity: TextEntity = {
      id: `text_${Date.now()}`,
      type: 'TEXT',
      layer: '0',
      position,
      text,
      height: 200
    };
    doc.entities.push(newEntity);
    doc.bounds = calculateBoundingBox(doc.entities);
    this.renderer.requestRender();
  }

  private finishMove(targetWorldPt: Point2D) {
    const doc = this.renderer.getDocument();
    if (!doc || !this.moveBasePoint || this.renderer.selectedIds.size === 0) return;

    this.history.pushState(doc);
    const dx = targetWorldPt.x - this.moveBasePoint.x;
    const dy = targetWorldPt.y - this.moveBasePoint.y;

    for (const ent of doc.entities) {
      if (this.renderer.selectedIds.has(ent.id)) {
        switch (ent.type) {
          case 'LINE':
            ent.start.x += dx; ent.start.y += dy;
            ent.end.x += dx; ent.end.y += dy;
            break;
          case 'LWPOLYLINE':
          case 'POLYLINE':
            ent.vertices.forEach(v => { v.x += dx; v.y += dy; });
            break;
          case 'CIRCLE':
          case 'ARC':
            ent.center.x += dx; ent.center.y += dy;
            break;
          case 'TEXT':
          case 'MTEXT':
            ent.position.x += dx; ent.position.y += dy;
            break;
        }
      }
    }

    doc.bounds = calculateBoundingBox(doc.entities);
    this.moveBasePoint = null;
    this.setMode('select');
    this.renderer.requestRender();
  }

  private notifySelectionChange() {
    if (!this.onSelectionChange) return;
    const doc = this.renderer.getDocument();
    if (!doc) {
      this.onSelectionChange([]);
      return;
    }
    const selected = doc.entities.filter(e => this.renderer.selectedIds.has(e.id));
    this.onSelectionChange(selected);
  }

  private renderOverlay(ctx: CanvasRenderingContext2D) {
    if (this.tempDrawPoints.length > 0 && this.currentMouseWorld) {
      ctx.strokeStyle = '#22c55e'; // Green preview line
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);

      const p1 = this.renderer.worldToScreen(this.tempDrawPoints[0]);
      const pCurrent = this.renderer.worldToScreen(this.currentMouseWorld);

      if (this.activeMode === 'draw_line') {
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(pCurrent.x, pCurrent.y);
        ctx.stroke();
      } else if (this.activeMode === 'draw_rect') {
        ctx.beginPath();
        ctx.strokeRect(p1.x, p1.y, pCurrent.x - p1.x, pCurrent.y - p1.y);
      } else if (this.activeMode === 'draw_circle') {
        const radiusScreen = Math.hypot(pCurrent.x - p1.x, pCurrent.y - p1.y);
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, radiusScreen, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.setLineDash([]);
    }

    // Move preview offset vector
    if (this.activeMode === 'move' && this.moveBasePoint && this.currentMouseWorld) {
      const pBase = this.renderer.worldToScreen(this.moveBasePoint);
      const pCurrent = this.renderer.worldToScreen(this.currentMouseWorld);

      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pBase.x, pBase.y);
      ctx.lineTo(pCurrent.x, pCurrent.y);
      ctx.stroke();
    }
  }
}
