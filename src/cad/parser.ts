import DxfParser from 'dxf-parser';
import { init, convertDwgToDxf, CDN_WASM_BASE } from 'dwgdxf';
import {
  CADDocument,
  CADEntity,
  LayerInfo,
  BoundingBox,
  LineEntity,
  PolylineEntity,
  CircleEntity,
  ArcEntity,
  EllipseEntity,
  TextEntity,
  Point2D
} from './types';

// AutoCAD Color Index (ACI) standard colors mapping to hex string
export const ACI_COLOR_MAP: Record<number, string> = {
  1: '#ff0000', // Red
  2: '#ffff00', // Yellow
  3: '#00ff00', // Green
  4: '#00ffff', // Cyan
  5: '#0000ff', // Blue
  6: '#ff00ff', // Magenta
  7: '#ffffff', // White/Black
  8: '#808080', // Dark Gray
  9: '#c0c0c0', // Light Gray
};

export function getAciColor(colorIndex?: number, defaultHex: string = '#38bdf8'): string {
  if (colorIndex !== undefined && ACI_COLOR_MAP[colorIndex]) {
    return ACI_COLOR_MAP[colorIndex];
  }
  return defaultHex;
}

// Helper function to decode DXF byte arrays using detected code page or encoding fallbacks
export function decodeDxfBytes(dxfBytes: Uint8Array): string {
  const headSample = new TextDecoder('latin1').decode(dxfBytes.subarray(0, 8192));

  let primaryEncoding = 'utf-8';
  if (headSample.includes('ANSI_950') || headSample.includes('Big5') || headSample.includes('BIG5')) {
    primaryEncoding = 'big5';
  } else if (headSample.includes('ANSI_936') || headSample.includes('GBK') || headSample.includes('GB2312')) {
    primaryEncoding = 'gbk';
  } else if (headSample.includes('ANSI_932') || headSample.includes('Shift_JIS')) {
    primaryEncoding = 'shift-jis';
  }

  // Try primary encoding
  try {
    const text = new TextDecoder(primaryEncoding).decode(dxfBytes);
    if (!text.includes('\uFFFD')) {
      return text;
    }
  } catch (e) {
    // ignore decoding errors
  }

  // Fallback try Big5
  try {
    const textBig5 = new TextDecoder('big5').decode(dxfBytes);
    if (!textBig5.includes('\uFFFD')) {
      return textBig5;
    }
  } catch (e) {
    // ignore
  }

  // Fallback try GBK
  try {
    const textGbk = new TextDecoder('gbk').decode(dxfBytes);
    if (!textGbk.includes('\uFFFD')) {
      return textGbk;
    }
  } catch (e) {
    // ignore
  }

  // Default UTF-8 fallback
  const decodedUtf8 = new TextDecoder('utf-8').decode(dxfBytes);
  if (!decodedUtf8.includes('\uFFFD')) {
    return decodedUtf8;
  }

  // Fallback to latin1 so individual tokens/strings can be reconstructed by fixMojibake
  return new TextDecoder('latin1').decode(dxfBytes);
}

// CP1252 to byte mapping for smart quotes, dashes, bullet points, etc.
const CP1252_TO_BYTE: Record<number, number> = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91,
  0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98,
  0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F
};

// Helper to fix mojibake (e.g. Big5/GBK bytes mis-decoded as latin-1 or Windows-1252 string)
export function fixMojibake(str: string): string {
  if (!str) return '';

  let needsFix = false;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0x80) {
      needsFix = true;
      break;
    }
  }

  if (!needsFix) return str;

  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x7F) {
      bytes[i] = code;
    } else if (code >= 0xA0 && code <= 0xFF) {
      bytes[i] = code;
    } else if (CP1252_TO_BYTE[code] !== undefined) {
      bytes[i] = CP1252_TO_BYTE[code];
    } else {
      bytes[i] = code & 0xFF;
    }
  }

  try {
    const textBig5 = new TextDecoder('big5').decode(bytes);
    if (!textBig5.includes('\uFFFD')) return textBig5;
  } catch (e) {}

  try {
    const textGbk = new TextDecoder('gbk').decode(bytes);
    if (!textGbk.includes('\uFFFD')) return textGbk;
  } catch (e) {}

  return str;
}

// Helper to decode AutoCAD unicode escape sequences (e.g. \U+6客 or \U+623F) and MTEXT formatting codes
export function decodeCadText(rawText: string): string {
  if (!rawText) return '';

  let text = rawText;

  // 1. Decode \U+XXXX unicode escapes (e.g. \U+623F -> 房)
  text = text.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });

  // 2. Clean AutoCAD MTEXT formatting controls like {\fMingLiU|b0|i0|c136|p34;文字} or \P, \A1;, \C7;
  text = text.replace(/\{?\\f[^;]+;/g, '');
  text = text.replace(/\\P/g, ' '); // newline to space
  text = text.replace(/\\[A-Za-z][0-9]*;/g, '');
  text = text.replace(/[\{\}]/g, '');

  // 3. Fix mojibake characters if parsed as latin1
  text = fixMojibake(text);

  return text.trim();
}

let dwgdxfInited = false;

async function ensureDwgDxfInit() {
  if (!dwgdxfInited) {
    try {
      await init({ wasmBase: CDN_WASM_BASE });
      dwgdxfInited = true;
    } catch (err) {
      console.warn('WASM initialization failed, attempting fallback local init', err);
      await init();
      dwgdxfInited = true;
    }
  }
}

export async function parseCadFile(file: File): Promise<CADDocument> {
  const fileName = file.name;
  const extension = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();

  let dxfText = '';

  if (extension === '.dwg') {
    await ensureDwgDxfInit();
    const arrayBuffer = await file.arrayBuffer();
    const dwgBytes = new Uint8Array(arrayBuffer);
    const dxfBytes = await convertDwgToDxf(dwgBytes);
    dxfText = decodeDxfBytes(dxfBytes);
  } else if (extension === '.dxf') {
    const arrayBuffer = await file.arrayBuffer();
    dxfText = decodeDxfBytes(new Uint8Array(arrayBuffer));
  } else {
    throw new Error('不支援的檔案格式。請上傳 .dwg 或 .dxf 檔案。');
  }

  return parseDxfString(dxfText, fileName);
}

export function parseDxfString(dxfText: string, docName: string = 'Drawing'): CADDocument {
  const parser = new DxfParser();
  let parsedDxf: any;
  try {
    parsedDxf = parser.parseSync(dxfText);
  } catch (err: any) {
    console.error('DXF Parse Error:', err);
    throw new Error('解析 DXF 內容時發生錯誤: ' + (err.message || '未知錯誤'));
  }

  const entities: CADEntity[] = [];
  const layers = new Map<string, LayerInfo>();

  // Ensure default layer 0
  layers.set('0', { name: '0', visible: true, color: '#ffffff' });

  // Extract layers from DXF tables if present
  if (parsedDxf.tables && parsedDxf.tables.layer && parsedDxf.tables.layer.layers) {
    const rawLayers = parsedDxf.tables.layer.layers;
    for (const key in rawLayers) {
      const l = rawLayers[key];
      const name = decodeCadText(l.name || key);
      const colorHex = getAciColor(l.colorNumber, '#ffffff');
      layers.set(name, {
        name,
        visible: true,
        color: colorHex
      });
    }
  }

  let idCounter = 1;

  if (parsedDxf.entities && Array.isArray(parsedDxf.entities)) {
    for (const raw of parsedDxf.entities) {
      const layerName = decodeCadText(raw.layer || '0');
      if (!layers.has(layerName)) {
        layers.set(layerName, {
          name: layerName,
          visible: true,
          color: getAciColor(raw.colorNumber, '#38bdf8')
        });
      }

      const entityColor = raw.colorNumber !== undefined ? getAciColor(raw.colorNumber) : undefined;
      const id = `ent_${idCounter++}`;

      switch (raw.type) {
        case 'LINE': {
          if (raw.vertices && raw.vertices.length >= 2) {
            entities.push({
              id,
              type: 'LINE',
              layer: layerName,
              color: entityColor,
              colorNumber: raw.colorNumber,
              start: { x: raw.vertices[0].x, y: raw.vertices[0].y },
              end: { x: raw.vertices[1].x, y: raw.vertices[1].y }
            } as LineEntity);
          }
          break;
        }

        case 'LWPOLYLINE':
        case 'POLYLINE': {
          if (raw.vertices && raw.vertices.length > 0) {
            const vertices = raw.vertices.map((v: any) => ({
              x: v.x,
              y: v.y,
              bulge: v.bulge || 0
            }));
            entities.push({
              id,
              type: raw.type as any,
              layer: layerName,
              color: entityColor,
              colorNumber: raw.colorNumber,
              vertices,
              closed: !!raw.shape || !!raw.closed
            } as PolylineEntity);
          }
          break;
        }

        case 'CIRCLE': {
          if (raw.center && typeof raw.radius === 'number') {
            entities.push({
              id,
              type: 'CIRCLE',
              layer: layerName,
              color: entityColor,
              colorNumber: raw.colorNumber,
              center: { x: raw.center.x, y: raw.center.y },
              radius: raw.radius
            } as CircleEntity);
          }
          break;
        }

        case 'ARC': {
          if (raw.center && typeof raw.radius === 'number') {
            // DXF angles are in degrees or radians
            let startDeg = raw.startAngle || 0;
            let endDeg = raw.endAngle || 0;
            if (raw.angleLength) {
              endDeg = startDeg + raw.angleLength;
            }
            entities.push({
              id,
              type: 'ARC',
              layer: layerName,
              color: entityColor,
              colorNumber: raw.colorNumber,
              center: { x: raw.center.x, y: raw.center.y },
              radius: raw.radius,
              startAngle: (startDeg * Math.PI) / 180,
              endAngle: (endDeg * Math.PI) / 180
            } as ArcEntity);
          }
          break;
        }

        case 'TEXT':
        case 'MTEXT': {
          if (raw.position || raw.startPoint) {
            const pos = raw.position || raw.startPoint;
            const cleanedText = decodeCadText(raw.text || '');
            entities.push({
              id,
              type: raw.type as any,
              layer: layerName,
              color: entityColor,
              colorNumber: raw.colorNumber,
              position: { x: pos.x, y: pos.y },
              text: cleanedText,
              height: raw.height || 10,
              rotation: raw.rotation ? (raw.rotation * Math.PI) / 180 : 0
            } as TextEntity);
          }
          break;
        }
      }
    }
  }

  const bounds = calculateBoundingBox(entities);

  return {
    name: docName,
    entities,
    layers,
    bounds,
    unitScale: 1.0,
    unitName: 'mm'
  };
}

export function calculateBoundingBox(entities: CADEntity[]): BoundingBox {
  if (entities.length === 0) {
    return { minX: -100, minY: -100, maxX: 100, maxY: 100 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const includePoint = (p: Point2D) => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  };

  for (const ent of entities) {
    switch (ent.type) {
      case 'LINE':
        includePoint(ent.start);
        includePoint(ent.end);
        break;
      case 'LWPOLYLINE':
      case 'POLYLINE':
        ent.vertices.forEach(includePoint);
        break;
      case 'CIRCLE':
        includePoint({ x: ent.center.x - ent.radius, y: ent.center.y - ent.radius });
        includePoint({ x: ent.center.x + ent.radius, y: ent.center.y + ent.radius });
        break;
      case 'ARC':
        includePoint({ x: ent.center.x - ent.radius, y: ent.center.y - ent.radius });
        includePoint({ x: ent.center.x + ent.radius, y: ent.center.y + ent.radius });
        break;
      case 'TEXT':
      case 'MTEXT':
        includePoint(ent.position);
        break;
    }
  }

  if (minX === Infinity) {
    return { minX: 0, minY: 0, maxX: 500, maxY: 500 };
  }

  return { minX, minY, maxX, maxY };
}
