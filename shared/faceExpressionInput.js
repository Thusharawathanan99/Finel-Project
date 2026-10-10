// MobileFaceNet preprocessing adapted from OpenCV Zoo's facial_fer_model.py.
// Upstream copyright (C) 2022, Shenzhen Institute of Artificial Intelligence and
// Robotics for Society. Upstream directory files are licensed under Apache-2.0:
// https://github.com/opencv/opencv_zoo/tree/main/models/facial_expression_recognition
// https://github.com/opencv/opencv_zoo/blob/main/LICENSE
// CareConnect modification: pure JavaScript RGBA sampling and 68-to-5 landmarks;
// no OpenCV dependency, no image upload, no inference or medical interpretation.

export const MOBILEFACENET_CLASSES = Object.freeze([
  'angry', 'disgusted', 'fearful', 'happy', 'neutral', 'sad', 'surprised',
]);

const SIZE = 112;
const TARGET = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
  [41.5493, 92.3655], [70.7299, 92.2041]];

// Canonical target -> original source. The official implementation fits this
// direction, then inverts it for warpAffine. Fitting source -> target first and
// inverting produces a different least-squares solution for noisy landmarks.
function samplingTransform(source) {
  let mx = 0, my = 0, mu = 0, mv = 0;
  for (let i = 0; i < 5; i++) {
    mx += TARGET[i][0] / 5; my += TARGET[i][1] / 5;
    mu += source[i][0] / 5; mv += source[i][1] / 5;
  }
  let denominator = 0, numeratorA = 0, numeratorB = 0;
  for (let i = 0; i < 5; i++) {
    const x = TARGET[i][0] - mx, y = TARGET[i][1] - my;
    const u = source[i][0] - mu, v = source[i][1] - mv;
    denominator += x * x + y * y;
    numeratorA += x * u + y * v;
    numeratorB += x * v - y * u;
  }
  const a = numeratorA / denominator, b = numeratorB / denominator;
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.hypot(a, b) < 1e-6) {
    throw new TypeError('Invalid face expression alignment');
  }
  return { a, b, tx: mu - a * mx + b * my, ty: mv - b * mx - a * my };
}

/** Return RGB float32 CHW values for the official 1×3×112×112 model input.
 * Landmarks are the existing face-api 68-point image coordinates normalized by
 * image width/height. Alpha is ignored. Outside-image bilinear samples are black.
 * Floating-point bilinear interpolation follows the official INTER_LINEAR
 * geometry; OpenCV may quantize interpolation weights to an internal table.
 */
export function prepareMobileFaceNetInput({ width, height, pixels, landmarks } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width * height > 4194304 ||
      !(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray) || pixels.length !== width * height * 4 ||
      !Array.isArray(landmarks) || landmarks.length !== 68 || landmarks.some(point => !point ||
        !['x', 'y'].every(key => typeof point[key] === 'number' && Number.isFinite(point[key]) && point[key] >= 0 && point[key] <= 1))) {
    throw new TypeError('Invalid face expression input');
  }
  const eye = start => {
    let x = 0, y = 0;
    for (let i = start; i < start + 6; i++) { x += landmarks[i].x * width / 6; y += landmarks[i].y * height / 6; }
    return [x, y];
  };
  const source = [eye(36), eye(42), ...[30, 48, 54].map(i => [landmarks[i].x * width, landmarks[i].y * height])];
  if (Math.hypot(source[1][0] - source[0][0], source[1][1] - source[0][1]) < 1e-6) {
    throw new TypeError('Invalid face expression eye landmarks');
  }
  const { a, b, tx, ty } = samplingTransform(source);
  const plane = SIZE * SIZE, output = new Float32Array(plane * 3);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const sx = a * x - b * y + tx, sy = b * x + a * y + ty;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), dx = sx - x0, dy = sy - y0;
    // Four offsets avoid allocating per-pixel sample arrays on mobile devices.
    const o00 = x0 >= 0 && x0 < width && y0 >= 0 && y0 < height ? (y0 * width + x0) * 4 : -1;
    const o10 = x0 + 1 >= 0 && x0 + 1 < width && y0 >= 0 && y0 < height ? (y0 * width + x0 + 1) * 4 : -1;
    const o01 = x0 >= 0 && x0 < width && y0 + 1 >= 0 && y0 + 1 < height ? ((y0 + 1) * width + x0) * 4 : -1;
    const o11 = x0 + 1 >= 0 && x0 + 1 < width && y0 + 1 >= 0 && y0 + 1 < height ? ((y0 + 1) * width + x0 + 1) * 4 : -1;
    const w00 = (1 - dx) * (1 - dy), w10 = dx * (1 - dy), w01 = (1 - dx) * dy, w11 = dx * dy;
    const destination = y * SIZE + x;
    for (let channel = 0; channel < 3; channel++) {
      const value = (o00 < 0 ? 0 : pixels[o00 + channel]) * w00 + (o10 < 0 ? 0 : pixels[o10 + channel]) * w10 +
        (o01 < 0 ? 0 : pixels[o01 + channel]) * w01 + (o11 < 0 ? 0 : pixels[o11 + channel]) * w11;
      output[channel * plane + destination] = value / 127.5 - 1;
    }
  }
  return output;
}
