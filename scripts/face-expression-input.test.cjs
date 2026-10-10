const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path'), { pathToFileURL } = require('node:url');
const helper = import(pathToFileURL(path.resolve(__dirname, '../shared/faceExpressionInput.js')));
const TARGET = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
  [41.5493, 92.3655], [70.7299, 92.2041]];
const PLANE = 112 * 112;
function image(width = 200, height = 200, color = (x, y) => [x, y, 100]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set([...color(x, y), 17], (y * width + x) * 4);
  return { width, height, pixels };
}
function landmarks(width, height, points = TARGET) {
  const result = Array.from({ length: 68 }, () => ({ x: 0.5, y: 0.5 }));
  for (const [index, group] of [[0, [36, 37, 38, 39, 40, 41]], [1, [42, 43, 44, 45, 46, 47]],
    [2, [30]], [3, [48]], [4, [54]]]) {
    for (const point of group) result[point] = { x: points[index][0] / width, y: points[index][1] / height };
  }
  return result;
}
function close(actual, expected, message) { assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} vs ${expected}`); }

test('official identity alignment preserves integer pixel coordinates and RGB CHW normalization', async () => {
  const { prepareMobileFaceNetInput, MOBILEFACENET_CLASSES } = await helper;
  const fixture = image(112, 112), input = prepareMobileFaceNetInput({ ...fixture, landmarks: landmarks(112, 112) });
  assert.equal(input.constructor, Float32Array); assert.equal(input.length, 1 * 3 * 112 * 112);
  assert.deepEqual(MOBILEFACENET_CLASSES, ['angry', 'disgusted', 'fearful', 'happy', 'neutral', 'sad', 'surprised']);
  assert.equal(Object.isFrozen(MOBILEFACENET_CLASSES), true);
  for (const [x, y] of [[0, 0], [17, 29], [111, 111]]) {
    close(input[y * 112 + x], x / 127.5 - 1, 'R');
    close(input[PLANE + y * 112 + x], y / 127.5 - 1, 'G');
    close(input[2 * PLANE + y * 112 + x], 100 / 127.5 - 1, 'B');
  }
});

test('known rotation, scale and translation sample the corresponding original image coordinates', async () => {
  const { prepareMobileFaceNetInput } = await helper;
  const a = 0.8 * Math.cos(0.17), b = 0.8 * Math.sin(0.17), tx = 45, ty = 18;
  const points = TARGET.map(([x, y]) => [a * x - b * y + tx, b * x + a * y + ty]);
  const fixture = image(), input = prepareMobileFaceNetInput({ ...fixture, landmarks: landmarks(200, 200, points) });
  for (const [x, y] of [[0, 0], [40, 38], [111, 111]]) {
    const sx = a * x - b * y + tx, sy = b * x + a * y + ty;
    close(input[y * 112 + x], sx / 127.5 - 1, 'rotated R');
    close(input[PLANE + y * 112 + x], sy / 127.5 - 1, 'rotated G');
  }
});

test('landmark eye centers use all six points and canonical-to-source OLS survives nonrigid noise', async () => {
  const { prepareMobileFaceNetInput } = await helper;
  const points = TARGET.map(([x, y], i) => [x + 30 + (i === 2 ? 7 : 0), y + 20 + (i === 4 ? -5 : 0)]);
  const fixture = image(), face = landmarks(200, 200, points);
  for (const start of [36, 42]) { face[start].x += 0.01; face[start + 1].x -= 0.01; }
  const input = prepareMobileFaceNetInput({ ...fixture, landmarks: face });
  // Independent full 10x4 least-squares normal equations, as in the official
  // cv2 alignment code, rather than copying the production centered formula.
  const rows = [], values = [];
  for (let i = 0; i < 5; i++) { const [x, y] = TARGET[i]; rows.push([x, y, 1, 0]); values.push(points[i][0]); }
  for (let i = 0; i < 5; i++) { const [x, y] = TARGET[i]; rows.push([y, -x, 0, 1]); values.push(points[i][1]); }
  const matrix = Array.from({ length: 4 }, (_, i) => [...Array.from({ length: 4 }, (_, j) => rows.reduce((sum, row) => sum + row[i] * row[j], 0)), rows.reduce((sum, row, j) => sum + row[i] * values[j], 0)]);
  for (let i = 0; i < 4; i++) {
    const divisor = matrix[i][i]; for (let j = i; j < 5; j++) matrix[i][j] /= divisor;
    for (let k = 0; k < 4; k++) if (k !== i) { const factor = matrix[k][i]; for (let j = i; j < 5; j++) matrix[k][j] -= factor * matrix[i][j]; }
  }
  const [sc, ss, tx, ty] = matrix.map(row => row[4]);
  for (const [x, y] of [[10, 30], [70, 50], [100, 90]]) {
    close(input[y * 112 + x], (sc * x + ss * y + tx) / 127.5 - 1, 'noisy OLS R');
    close(input[PLANE + y * 112 + x], (sc * y - ss * x + ty) / 127.5 - 1, 'noisy OLS G');
  }
});

test('fractional edge samples blend with constant black and fully outside pixels normalize to minus one', async () => {
  const { prepareMobileFaceNetInput } = await helper;
  const fixture = image(112, 112, () => [255, 128, 0]);
  const points = TARGET.map(([x, y]) => [x - 0.5, y - 0.5]);
  const input = prepareMobileFaceNetInput({ ...fixture, landmarks: landmarks(112, 112, points) });
  close(input[0], 255 * 0.25 / 127.5 - 1, 'quarter red at corner');
  close(input[PLANE], 128 * 0.25 / 127.5 - 1, 'quarter green at corner');
  close(input[2 * PLANE], -1, 'zero blue');
  close(input[112 + 1], 1, 'interior red');
  const shifted = TARGET.map(([x, y]) => [x - 20, y - 20]);
  const outside = prepareMobileFaceNetInput({ ...fixture, landmarks: landmarks(112, 112, shifted) });
  assert.equal(outside[0], -1); assert.equal(outside[PLANE], -1); assert.equal(outside[2 * PLANE], -1);
});

test('invalid pixel shapes and invalid or collapsed landmarks are rejected before allocation', async () => {
  const { prepareMobileFaceNetInput } = await helper;
  const fixture = image(112, 112);
  for (const change of [f => { f.width = 0; }, f => { f.height = 1.2; }, f => { f.width = Infinity; },
    f => { f.pixels = new Float32Array(f.pixels.length); }, f => { f.pixels = f.pixels.subarray(4); },
    f => { f.landmarks.pop(); }, f => { f.landmarks[0] = { x: NaN, y: 0.2 }; },
    f => { f.landmarks[12].x = -0.01; }, f => { f.landmarks[12].y = 1.01; },
    f => { for (let i = 42; i <= 47; i++) f.landmarks[i] = { ...f.landmarks[36] }; },
    f => { f.landmarks = Array.from({ length: 68 }, () => ({ x: 0.5, y: 0.5 })); }]) {
    const input = { ...fixture, landmarks: landmarks(112, 112) }; change(input);
    assert.throws(() => prepareMobileFaceNetInput(input), TypeError);
  }
  assert.throws(() => prepareMobileFaceNetInput(), TypeError);
});
