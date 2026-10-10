// One bounded budget covers every inference endpoint, including legacy clients.
const clients = new Map();
const WINDOW_MS = 60_000;
let activeRequests = 0;
export const inferencePaths = new Set(['/ai/generate', '/ai/cloud-nlp', '/ai/donut/predict', '/analyze-prescription', '/generate-meal-plan', '/emotions/analyze-image']);

export function reserveClient(uid, now = Date.now()) {
  for (const [id, entry] of clients) {
    entry.requests = entry.requests.filter(time => now - time < WINDOW_MS);
    if (!entry.active && !entry.requests.length) clients.delete(id);
  }
  let entry = clients.get(uid);
  if (!entry) {
    if (clients.size >= 5000) return { status: 503, error: 'AI service is busy. Please retry shortly.' };
    entry = { requests: [], active: 0 };
    clients.set(uid, entry);
  }
  if (entry.active >= 3 || entry.requests.length >= 8) {
    return { status: 429, error: 'Please wait before requesting another AI analysis.' };
  }
  if (activeRequests >= 20) return { status: 503, error: 'AI service is busy. Please retry shortly.' };
  entry.requests.push(now); entry.active += 1; activeRequests += 1;
  let released = false;
  return { entry, release() {
    if (!released) { released = true; entry.active -= 1; activeRequests -= 1; }
  } };
}

export function inferenceLimitMiddleware(req, res, next) {
  if (req.method !== 'POST' || !inferencePaths.has(req.path.replace(/\/+$/, ''))) return next();
  if (!req.user?.uid || !req.user.profile) return res.status(403).json({ error: 'A registered account is required for AI analysis' });
  const reservation = reserveClient(req.user.uid);
  if (!reservation.entry) {
    if (reservation.status === 429) res.set('Retry-After', '60');
    return res.status(reservation.status).json({ error: reservation.error });
  }
  req.inferenceReservation = reservation;
  res.once('finish', reservation.release); res.once('close', reservation.release);
  return next();
}

export function validateImage(image) {
  if (typeof image !== 'string') return null;
  const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(image);
  const mimeType = match?.[1] || 'image/jpeg', data = match?.[2] || image;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType) || !data || data.length % 4 ||
      data.length > Math.ceil(10 * 1024 * 1024 / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) ||
      Buffer.byteLength(data, 'base64') > 10 * 1024 * 1024) return null;
  return { mimeType, data };
}
