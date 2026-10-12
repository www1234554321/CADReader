import { CADRenderer } from '../cad/renderer';
import { Point2D, CADEntity } from '../cad/types';

export interface SnapPoint {
  x: number;
  y: number;
  type: 'endpoint' | 'midpoint' | 'center';
}

export function findSnapPoint(
  worldPt: Point2D,
  entities: CADEntity[],
  thresholdWorld: number
): SnapPoint | null {
  let closestSnap: SnapPoint | null = null;
  let minDistance = thresholdWorld;

  const check = (pt: Point2D, type: 'endpoint' | 'midpoint' | 'center') => {
    const dist = Math.hypot(pt.x - worldPt.x, pt.y - worldPt.y);
    if (dist < minDistance) {
      minDistance = dist;
      closestSnap = { x: pt.x, y: pt.y, type };
    }
  };

  for (const ent of entities) {
    switch (ent.type) {
      case 'LINE':
        check(ent.start, 'endpoint');
        check(ent.end, 'endpoint');
        check({ x: (ent.start.x + ent.end.x) / 2, y: (ent.start.y + ent.end.y) / 2 }, 'midpoint');
        break;
      case 'LWPOLYLINE':
      case 'POLYLINE':
        if (ent.vertices) {
          ent.vertices.forEach(v => check(v, 'endpoint'));
          for (let i = 0; i < ent.vertices.length - 1; i++) {
            const v1 = ent.vertices[i];
            const v2 = ent.vertices[i + 1];
            check({ x: (v1.x + v2.x) / 2, y: (v1.y + v2.y) / 2 }, 'midpoint');
          }
        }
        break;
      case 'CIRCLE':
      case 'ARC':
        check(ent.center, 'center');
        break;
    }
  }

  return closestSnap;
}

export function calculatePolylineArea(points: Point2D[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

export class MeasureManager {
  private renderer: CADRenderer;
  public mode: 'none' | 'length' | 'area' | 'calibrate' = 'none';
  public points: Point2D[] = [];
  public activeMouseWorld: Point2D | null = null;
  public activeSnap: SnapPoint | null = null;

  public onMeasurementUpdate?: (result: { type: string; value: number; formatted: string }) => void;
  public onCalibrateRequest?: (pixelDistanceWorld: number) => void;

  constructor(renderer: CADRenderer) {
    this.renderer = renderer;
  }

  public setMode(mode: 'none' | 'length' | 'area' | 'calibrate') {
    this.mode = mode;
    this.points = [];
    this.activeMouseWorld = null;
    this.activeSnap = null;
    this.renderer.overlayCallback = mode === 'none' ? null : (ctx) => this.renderOverlay(ctx);
    this.renderer.requestRender();
  }

  public handleMouseMove(worldPt: Point2D) {
    if (this.mode === 'none') return;

    const doc = this.renderer.getDocument();
    const snapRadiusWorld = 15 / this.renderer.zoom; // 15px snap radius
    if (doc) {
      this.activeSnap = findSnapPoint(worldPt, doc.entities, snapRadiusWorld);
    } else {
      this.activeSnap = null;
    }

    this.activeMouseWorld = this.activeSnap ? { x: this.activeSnap.x, y: this.activeSnap.y } : worldPt;
    this.renderer.requestRender();
  }

  public handlePointClick(worldPt: Point2D) {
    if (this.mode === 'none') return;

    const pt = this.activeSnap ? { x: this.activeSnap.x, y: this.activeSnap.y } : worldPt;
    this.points.push(pt);

    const scale = this.renderer.getDocument()?.unitScale || 1.0;
    const unitName = this.renderer.getDocument()?.unitName || 'mm';

    if (this.mode === 'length') {
      let totalLength = 0;
      for (let i = 0; i < this.points.length - 1; i++) {
        totalLength += Math.hypot(
          this.points[i + 1].x - this.points[i].x,
          this.points[i + 1].y - this.points[i].y
        );
      }
      const realLength = totalLength * scale;
      if (this.onMeasurementUpdate) {
        this.onMeasurementUpdate({
          type: '長度量測',
          value: realLength,
          formatted: `${realLength.toFixed(2)} ${unitName}`
        });
      }
    } else if (this.mode === 'area') {
      const areaWorld = calculatePolylineArea(this.points);
      const realArea = areaWorld * scale * scale;
      let areaStr = `${realArea.toFixed(2)} ${unitName}²`;
      if (unitName === 'mm') {
        areaStr += ` (${(realArea / 1e6).toFixed(3)} m²)`;
      }
      if (this.onMeasurementUpdate) {
        this.onMeasurementUpdate({
          type: '面積量測',
          value: realArea,
          formatted: areaStr
        });
      }
    } else if (this.mode === 'calibrate') {
      if (this.points.length === 2) {
        const distWorld = Math.hypot(
          this.points[1].x - this.points[0].x,
          this.points[1].y - this.points[0].y
        );
        if (this.onCalibrateRequest) {
          this.onCalibrateRequest(distWorld);
        }
        this.setMode('none');
      }
    }

    this.renderer.requestRender();
  }

  public finishMeasurement() {
    this.setMode('none');
  }

  private renderOverlay(ctx: CanvasRenderingContext2D) {
    // Draw Snap Indicator if present
    if (this.activeSnap) {
      const screenSnap = this.renderer.worldToScreen(this.activeSnap);
      ctx.strokeStyle = '#f59e0b'; // Amber
      ctx.fillStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screenSnap.x, screenSnap.y, 6, 0, Math.PI * 2);
      ctx.stroke();

      // Snap marker square/icon
      ctx.strokeRect(screenSnap.x - 4, screenSnap.y - 4, 8, 8);
    }

    if (this.points.length === 0) return;

    ctx.strokeStyle = '#38bdf8'; // Sky blue
    ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);

    const pointsScreen = this.points.map(p => this.renderer.worldToScreen(p));

    ctx.beginPath();
    ctx.moveTo(pointsScreen[0].x, pointsScreen[0].y);
    for (let i = 1; i < pointsScreen.length; i++) {
      ctx.lineTo(pointsScreen[i].x, pointsScreen[i].y);
    }

    if (this.activeMouseWorld) {
      const mouseScreen = this.renderer.worldToScreen(this.activeMouseWorld);
      ctx.lineTo(mouseScreen.x, mouseScreen.y);
      if (this.mode === 'area' && pointsScreen.length >= 2) {
        ctx.lineTo(pointsScreen[0].x, pointsScreen[0].y);
      }
    }

    if (this.mode === 'area') {
      ctx.fill();
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw vertex points & distance labels
    ctx.fillStyle = '#38bdf8';
    pointsScreen.forEach((p, idx) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();

      // Render segment lengths
      if (idx > 0) {
        const prev = pointsScreen[idx - 1];
        const midX = (p.x + prev.x) / 2;
        const midY = (p.y + prev.y) / 2;
        const distWorld = Math.hypot(
          this.points[idx].x - this.points[idx - 1].x,
          this.points[idx].y - this.points[idx - 1].y
        );
        const scale = this.renderer.getDocument()?.unitScale || 1.0;
        const unitName = this.renderer.getDocument()?.unitName || 'mm';
        const text = `${(distWorld * scale).toFixed(1)} ${unitName}`;

        ctx.font = '12px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#000000';
        ctx.shadowBlur = 4;
        ctx.fillText(text, midX + 6, midY - 6);
        ctx.shadowBlur = 0;
      }
    });
  }
}
