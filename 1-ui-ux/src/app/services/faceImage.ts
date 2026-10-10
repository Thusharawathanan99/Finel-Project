import { getLiveFaceCopy } from '../../../../shared/liveFace';

export interface FacePhoto {
  dataUrl: string;
  width: number;
  height: number;
  capturedAt: string;
}

// Normalize orientation and dimensions before sending the very same bytes shown
// in the preview. Cloud face coordinates therefore match the displayed photo.
export function photoFromCanvas(source: CanvasImageSource, width: number, height: number): FacePhoto {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width * height > 32_000_000) {
    throw new Error('INVALID_IMAGE');
  }
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('INVALID_IMAGE');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.92), width: canvas.width, height: canvas.height, capturedAt: new Date().toISOString() };
}

export async function photoFromFile(file: File): Promise<FacePhoto> {
  if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 10 * 1024 * 1024 || file.size === 0) {
    throw new Error('INVALID_IMAGE');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return photoFromCanvas(image, image.naturalWidth, image.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const escapeHTML = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export function faceReportHTML(photo: FacePhoto, reportText: string, boxes: Array<{x:number;y:number;width:number;height:number}>, language: string): string {
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(photo.dataUrl) || !['en','ta','si'].includes(language)) throw new Error('INVALID_IMAGE');
  const overlays = boxes.map(box => {
    if (![box.x, box.y, box.width, box.height].every(v => Number.isFinite(v) && v >= 0 && v <= 1) || box.x + box.width > 1.000001 || box.y + box.height > 1.000001) throw new Error('INVALID_IMAGE');
    return `<div class="box" style="left:${box.x*100}%;top:${box.y*100}%;width:${box.width*100}%;height:${box.height*100}%"></div>`;
  }).join('');
  const t=getLiveFaceCopy(language);
  return `<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CareConnect · ${escapeHTML(t.report)}</title><style>*{box-sizing:border-box}body{font:15px/1.8 system-ui,sans-serif;color:#334155;background:#f1f5f9;margin:0;padding:32px 20px}.document{max-width:860px;margin:auto;background:white;border:1px solid #e2e8f0;border-radius:24px;overflow:hidden}header{background:#0f172a;color:white;padding:28px 36px}.brand{color:#6ee7b7;font-size:12px;letter-spacing:2px;font-weight:700}h1{font-size:26px;margin:8px 0}header p{color:#cbd5e1;margin:0;font-size:13px}main{padding:28px 36px}.photo{position:relative;margin:0 auto 28px;line-height:0;max-width:620px;border-radius:16px;overflow:hidden;background:#0f172a}.photo img{display:block;width:100%;height:auto}.box{position:absolute;border:2px solid #34d399;box-sizing:border-box;border-radius:8px}.report-text{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:0;padding:24px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px}footer{font-size:12px;color:#64748b;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:16px}@media(max-width:540px){body{padding:10px}header,main{padding:20px}.report-text{padding:14px}h1{font-size:21px}}@media print{body{padding:0;background:white}.document{border:0;border-radius:0}header{background:white;color:#0f172a;padding:0 0 16px}header p{color:#475569}main{padding:0}.photo{max-width:420px}.report-text{font-size:11px;padding:12px}footer{font-size:10px}}</style><body><article class="document"><header><div class="brand">CARECONNECT</div><h1>${escapeHTML(t.report)}</h1><p>${escapeHTML(t.expression)} · English / தமிழ் / සිංහල</p></header><main><div class="photo"><img alt="${escapeHTML(t.preview)}" src="${photo.dataUrl}">${overlays}</div><pre class="report-text">${escapeHTML(reportText)}</pre><footer>${escapeHTML(t.limitations)}</footer></main></article></body></html>`;
}
