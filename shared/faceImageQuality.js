// Pixel measurements, not calibrated blur/lighting/pose or clinical predictions.
// Work is bounded to 96 x 96 samples per detected face, with no image retention.
export function measureFaceImageQuality({ width, height, pixels, box, landmarks }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      !(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray) || pixels.length !== width * height * 4 ||
      !box || !['x', 'y', 'width', 'height'].every(key => typeof box[key] === 'number' && Number.isFinite(box[key])) ||
      box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 || box.x + box.width > 1.000001 || box.y + box.height > 1.000001) {
    throw new TypeError('Invalid face quality input');
  }
  const left = Math.min(width - 1, Math.floor(box.x * width));
  const top = Math.min(height - 1, Math.floor(box.y * height));
  const right = Math.min(width, Math.ceil((box.x + box.width) * width));
  const bottom = Math.min(height, Math.ceil((box.y + box.height) * height));
  const roiWidth = Math.max(1, right - left), roiHeight = Math.max(1, bottom - top);
  const sampleWidth = Math.min(96, roiWidth), sampleHeight = Math.min(96, roiHeight);
  const luminance = new Float64Array(sampleWidth * sampleHeight);
  let sum = 0, dark = 0, clipped = 0;
  for (let y = 0; y < sampleHeight; y++) for (let x = 0; x < sampleWidth; x++) {
    const px = Math.min(right - 1, left + Math.floor((x + 0.5) * roiWidth / sampleWidth));
    const py = Math.min(bottom - 1, top + Math.floor((y + 0.5) * roiHeight / sampleHeight));
    const offset = (py * width + px) * 4;
    const value = (0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2]);
    luminance[y * sampleWidth + x] = value;
    sum += value; if (value < 35) dark++; if (value > 245) clipped++;
  }
  let edgeSum = 0, edgeSquared = 0, edgeCount = 0;
  for (let y = 1; y < sampleHeight - 1; y++) for (let x = 1; x < sampleWidth - 1; x++) {
    const index = y * sampleWidth + x;
    const edge = luminance[index - 1] + luminance[index + 1] + luminance[index - sampleWidth] +
      luminance[index + sampleWidth] - 4 * luminance[index];
    edgeSum += edge; edgeSquared += edge * edge; edgeCount++;
  }
  // Only the 2-D eye line is measured. This is not a yaw/pitch/occlusion estimate.
  let eyeTiltDegrees = null;
  if (Array.isArray(landmarks) && landmarks.length === 68) {
    const eye = start => {
      const points = landmarks.slice(start, start + 6);
      if (points.some(point => !point || !['x', 'y'].every(key => typeof point[key] === 'number' && Number.isFinite(point[key]) && point[key] >= 0 && point[key] <= 1))) return null;
      return { x: points.reduce((value, point) => value + point.x * width, 0) / 6,
        y: points.reduce((value, point) => value + point.y * height, 0) / 6 };
    };
    const a = eye(36), b = eye(42);
    if (a && b && Math.hypot(b.x - a.x, b.y - a.y) >= 1) {
      const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      eyeTiltDegrees = ((angle + 270) % 180) - 90;
    }
  }
  const count = luminance.length;
  return { version: 'face-image-quality-v1', sampleWidth, sampleHeight,
    meanLuminance: Math.min(255, Math.max(0, sum / count)), darkFraction: dark / count, clippedFraction: clipped / count,
    laplacianVariance: edgeCount ? Math.min(1040400, Math.max(0, edgeSquared / edgeCount - (edgeSum / edgeCount) ** 2)) : 0,
    eyeTiltDegrees };
}
