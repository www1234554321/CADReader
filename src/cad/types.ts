export interface Point2D {
  x: number;
  y: number;
}

export interface Point3D {
  x: number;
  y: number;
  z?: number;
}

export type EntityType = 'LINE' | 'LWPOLYLINE' | 'POLYLINE' | 'CIRCLE' | 'ARC' | 'ELLIPSE' | 'TEXT' | 'MTEXT';

export interface BaseEntity {
  id: string;
  type: EntityType;
  layer: string;
  color?: string; // Hex color string or ACI index string
  colorNumber?: number;
}

export interface LineEntity extends BaseEntity {
  type: 'LINE';
  start: Point2D;
  end: Point2D;
}

export interface PolylineVertex extends Point2D {
  bulge?: number;
}

export interface PolylineEntity extends BaseEntity {
  type: 'LWPOLYLINE' | 'POLYLINE';
  vertices: PolylineVertex[];
  closed?: boolean;
}

export interface CircleEntity extends BaseEntity {
  type: 'CIRCLE';
  center: Point2D;
  radius: number;
}

export interface ArcEntity extends BaseEntity {
  type: 'ARC';
  center: Point2D;
  radius: number;
  startAngle: number; // In radians
  endAngle: number;   // In radians
}

export interface EllipseEntity extends BaseEntity {
  type: 'ELLIPSE';
  center: Point2D;
  majorAxisEndPoint: Point2D;
  axisRatio: number;
  startAngle: number; // In radians
  endAngle: number;   // In radians
}

export interface TextEntity extends BaseEntity {
  type: 'TEXT' | 'MTEXT';
  position: Point2D;
  text: string;
  height: number;
  rotation?: number; // In radians
}

export type CADEntity = LineEntity | PolylineEntity | CircleEntity | ArcEntity | EllipseEntity | TextEntity;

export interface LayerInfo {
  name: string;
  visible: boolean;
  color: string;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CADDocument {
  name: string;
  entities: CADEntity[];
  layers: Map<string, LayerInfo>;
  bounds: BoundingBox;
  unitScale: number; // Real world mm per CAD drawing unit (default: 1)
  unitName: string; // e.g., 'mm', 'cm', 'm'
}
