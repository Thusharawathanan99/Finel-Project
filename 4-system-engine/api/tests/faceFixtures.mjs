import { deflateSync } from 'node:zlib';
import { pngCRC } from '../routes/faceImage.js';
export function pngChunk(type, data = Buffer.alloc(0)) {
  const header = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE(pngCRC(Buffer.concat([header, data])));
  return Buffer.concat([length, header, data, checksum]);
}
export function testPNG(width = 512, height = 512) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND')]);
}
export const testJPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==', 'base64');
export function faceAnnotation(changes = {}) {
  return { boundingPoly: { vertices: [{ x: 128, y: 128 }, { x: 384, y: 128 }, { x: 384, y: 384 }, { x: 128, y: 384 }] },
    detectionConfidence: 0.934, landmarkingConfidence: 0.871, rollAngle: 0, panAngle: 0, tiltAngle: 0,
    blurredLikelihood: 'VERY_UNLIKELY', underExposedLikelihood: 'UNLIKELY', joyLikelihood: 'LIKELY', sorrowLikelihood: 'VERY_UNLIKELY',
    angerLikelihood: 'UNLIKELY', surpriseLikelihood: 'POSSIBLE', ...changes };
}
