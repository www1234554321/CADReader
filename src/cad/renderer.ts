import { CADDocument, CADEntity, Point2D, BoundingBox } from './types';

export class CADRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private doc: CADDocument | null = null;

  // Pan & Zoom Viewport transformation state
  public zoom: number = 1.0;
  public panX: number = 0;
  public panY: number = 0;

  // Selected entities mapping
  public selectedIds: Set<string> = new Set();

  // Overlay preview drawing (measurements, snap hints, temporary line shapes)
  public overlayCallback: ((ctx: CanvasRenderingContext2D) => void) | null = null;

  // Canvas Theme
  public isDarkMode: boolean = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context from canvas');
    this.ctx = ctx;
    this.resizeCanvas();
  }

  public setDocument(doc: CADDocument) {
    this.doc = doc;
    this.selectedIds.clear();
    this.fitView();
  }

  public getDocument(): CADDocument | null {
    return this.doc;
  }

  public resizeCanvas() {
    const parent = this.canvas.parentElement;
    if (parent) {
      this.canvas.width = parent.clientWidth;
      this.canvas.height = parent.clientHeight;
    }
    this.requestRender();
  }

  // Coordinate Conversion: World (CAD units) -> Screen (Canvas Pixels)
  public worldToScreen(worldPt: Point2D): Point2D {
    const screenX = worldPt.x * this.zoom + this.panX;
    // Invert Y axis for standard Cartesian CAD system (Y goes upwards)
    const screenY = this.canvas.height - (worldPt.y * this.zoom + this.panY);
    return { x: screenX, y: screenY };
  }

  // Coordinate Conversion: Screen (Canvas Pixels) -> World (CAD units)
  public screenToWorld(screenPt: Point2D): Point2D {
    const worldX = (screenPt.x - this.panX) / this.zoom;
    const worldY = (this.canvas.height - screenPt.y - this.panY) / this.zoom;
    return { x: worldX, y: worldY };
  }

  // Auto Zoom Fit view to fit drawing bounding box
  public fitView() {
    if (!this.doc || this.doc.entities.length === 0) {
      this.zoom = 1;
      this.panX = this.canvas.width / 2;
      this.panY = this.canvas.height / 2;
      this.requestRender();
      return;
    }

    const bounds = this.doc.bounds;
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;

    if (width <= 0 || height <= 0) {
      this.zoom = 1;
      this.panX = this.canvas.width / 2 - bounds.minX;
      this.panY = this.canvas.height / 2 - bounds.minY;
      this.requestRender();
      return;
    }

    const padding = 60; // Pixels
    const availWidth = Math.max(100, this.canvas.width - padding * 2);
    const availHeight = Math.max(100, this.canvas.height - padding * 2);

    const scaleX = availWidth / width;
    const scaleY = availHeight / height;
    this.zoom = Math.min(scaleX, scaleY);

    const centerWorldX = (bounds.minX + bounds.maxX) / 2;
    const centerWorldY = (bounds.minY + bounds.maxY) / 2;

    this.panX = this.canvas.width / 2 - centerWorldX * this.zoom;
    this.panY = this.canvas.height / 2 - centerWorldY * this.zoom;

    this.requestRender();
  }

  public toggleTheme() {
    this.isDarkMode = !this.isDarkMode;
    this.requestRender();
  }

  public requestRender() {
    requestAnimationFrame(() => this.render());
  }

  public render() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Clear background
    ctx.fillStyle = this.isDarkMode ? '#0f172a' : '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    // Draw Grid
    this.drawGrid(ctx);

    if (!this.doc) return;

    // Render CAD Entities
    for (const entity of this.doc.entities) {
      const layer = this.doc.layers.get(entity.layer);
      if (layer && !layer.visible) continue;

      const isSelected = this.selectedIds.has(entity.id);
      let color = isSelected ? '#f43f5e' : (entity.color || (layer ? layer.color : '#38bdf8'));

      if (!this.isDarkMode && color === '#ffffff') color = '#0f172a';
      if (this.isDarkMode && (color === '#000000' || color === '#0f172a')) color = '#ffffff';

      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = isSelected ? 3 : 1.5;

      this.renderEntity(ctx, entity);
      ctx.restore();
    }

    // Render Overlay Callback (Measurement tool, Snapping, Drawing preview)
    if (this.overlayCallback) {
      ctx.save();
      this.overlayCallback(ctx);
      ctx.restore();
    }
  }

  private drawGrid(ctx: CanvasRenderingContext2D) {
    const width = this.canvas.width;
    const height = this.canvas.height;

    ctx.save();
    ctx.strokeStyle = this.isDarkMode ? '#1e293b' : '#e2e8f0';
    ctx.lineWidth = 1;

    // Calculate grid step in world space
    let gridSpacingWorld = 100;
    const gridSpacingScreen = gridSpacingWorld * this.zoom;

    if (gridSpacingScreen < 20) gridSpacingWorld = 500;
    if (gridSpacingScreen > 200) gridSpacingWorld = 20;

    const topLeftWorld = this.screenToWorld({ x: 0, y: 0 });
    const bottomRightWorld = this.screenToWorld({ x: width, y: height });

    const startX = Math.floor(topLeftWorld.x / gridSpacingWorld) * gridSpacingWorld;
    const endX = Math.ceil(bottomRightWorld.x / gridSpacingWorld) * gridSpacingWorld;

    const startY = Math.floor(bottomRightWorld.y / gridSpacingWorld) * gridSpacingWorld;
    const endY = Math.ceil(topLeftWorld.y / gridSpacingWorld) * gridSpacingWorld;

    ctx.beginPath();
    for (let x = startX; x <= endX; x += gridSpacingWorld) {
      const p1 = this.worldToScreen({ x, y: startY });
      const p2 = this.worldToScreen({ x, y: endY });
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }

    for (let y = startY; y <= endY; y += gridSpacingWorld) {
      const p1 = this.worldToScreen({ x: startX, y });
      const p2 = this.worldToScreen({ x: endX, y });
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();

    // Draw Origin Axis (X: Red, Y: Green)
    const originScreen = this.worldToScreen({ x: 0, y: 0 });
    ctx.lineWidth = 1.5;

    // X Axis
    ctx.strokeStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(originScreen.x, originScreen.y);
    ctx.lineTo(originScreen.x + 50, originScreen.y);
    ctx.stroke();

    // Y Axis
    ctx.strokeStyle = '#22c55e';
    ctx.beginPath();
    ctx.moveTo(originScreen.x, originScreen.y);
    ctx.lineTo(originScreen.x, originScreen.y - 50);
    ctx.stroke();

    ctx.restore();
  }

  private renderEntity(ctx: CanvasRenderingContext2D, entity: CADEntity) {
    switch (entity.type) {
      case 'LINE': {
        const p1 = this.worldToScreen(entity.start);
        const p2 = this.worldToScreen(entity.end);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        break;
      }

      case 'LWPOLYLINE':
      case 'POLYLINE': {
        if (!entity.vertices || entity.vertices.length < 2) return;
        ctx.beginPath();
        const start = this.worldToScreen(entity.vertices[0]);
        ctx.moveTo(start.x, start.y);

        for (let i = 1; i < entity.vertices.length; i++) {
          const pt = this.worldToScreen(entity.vertices[i]);
          ctx.lineTo(pt.x, pt.y);
        }

        if (entity.closed) {
          ctx.closePath();
        }
        ctx.stroke();
        break;
      }

      case 'CIRCLE': {
        const center = this.worldToScreen(entity.center);
        const radiusScreen = entity.radius * this.zoom;
        ctx.beginPath();
        ctx.arc(center.x, center.y, Math.max(1, radiusScreen), 0, Math.PI * 2);
        ctx.stroke();
        break;
      }

      case 'ARC': {
        const center = this.worldToScreen(entity.center);
        const radiusScreen = entity.radius * this.zoom;
        // DXF angles are counter-clockwise from positive X-axis
        // Canvas coordinate inverted Y flip:
        const startAngle = -entity.startAngle;
        const endAngle = -entity.endAngle;
        ctx.beginPath();
        ctx.arc(center.x, center.y, Math.max(1, radiusScreen), startAngle, endAngle, true);
        ctx.stroke();
        break;
      }

      case 'TEXT':
      case 'MTEXT': {
        const pos = this.worldToScreen(entity.position);
        const fontSizeScreen = Math.max(10, entity.height * this.zoom);
        ctx.font = `${fontSizeScreen}px sans-serif`;
        ctx.textBaseline = 'bottom';
        ctx.fillText(entity.text, pos.x, pos.y);
        break;
      }
    }
  }
}
