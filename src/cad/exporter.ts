// @ts-ignore
import Drawing from 'dxf-writer';
import { CADDocument } from './types';

export function exportDocumentToDxf(doc: CADDocument): string {
  const d = new Drawing();
  d.setUnits('Millimeters');

  // Register layers
  doc.layers.forEach((layer) => {
    d.addLayer(layer.name, Drawing.ACI.WHITE, 'CONTINUOUS');
  });

  for (const ent of doc.entities) {
    d.setActiveLayer(ent.layer || '0');

    switch (ent.type) {
      case 'LINE':
        d.drawLine(ent.start.x, ent.start.y, ent.end.x, ent.end.y);
        break;

      case 'CIRCLE':
        d.drawCircle(ent.center.x, ent.center.y, ent.radius);
        break;

      case 'ARC': {
        const startDeg = (ent.startAngle * 180) / Math.PI;
        const endDeg = (ent.endAngle * 180) / Math.PI;
        d.drawArc(ent.center.x, ent.center.y, ent.radius, startDeg, endDeg);
        break;
      }

      case 'LWPOLYLINE':
      case 'POLYLINE': {
        if (ent.vertices && ent.vertices.length >= 2) {
          const poly: any = d.drawPolyline(ent.vertices as any, !!ent.closed);
          if (ent.closed && poly && typeof poly.close === 'function') {
            poly.close();
          }
        }
        break;
      }

      case 'TEXT':
      case 'MTEXT': {
        d.drawText(ent.position.x, ent.position.y, ent.height || 10, 0, ent.text || '');
        break;
      }
    }
  }

  return d.toDxfString();
}

export function downloadDxfFile(doc: CADDocument) {
  const dxfContent = exportDocumentToDxf(doc);
  const blob = new Blob([dxfContent], { type: 'application/dxf;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  const fileName = doc.name ? `${doc.name.replace(/\.[^/.]+$/, '')}_edited.dxf` : 'drawing_export.dxf';
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
