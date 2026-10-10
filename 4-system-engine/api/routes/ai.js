// Browser inference runs here so provider credentials never enter the web bundle.
import { Router } from 'express';
import admin from 'firebase-admin';
import { reserveClient, validateImage } from '../middleware/inferenceLimits.js';

const router = Router();
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function validateParts(contents) {
  if (!Array.isArray(contents) || !contents.length || contents.length > 32) return null;
  let textLength = 0, imageCount = 0;
  const parts = [];
  for (const part of contents) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) return null;
    if (typeof part.text === 'string' && Object.keys(part).length === 1) {
      textLength += part.text.length;
      if (textLength > 100_000) return null;
      parts.push({ text: part.text });
      continue;
    }
    const inline = part.inlineData;
    if (!inline || Object.keys(part).length !== 1 || typeof inline.data !== 'string' ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(inline.mimeType) || ++imageCount > 1) return null;
    if (!inline.data || inline.data.length % 4 !== 0 || inline.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(inline.data) ||
      Buffer.byteLength(inline.data, 'base64') > MAX_IMAGE_BYTES) return null;
    parts.push({ inlineData: { mimeType: inline.mimeType, data: inline.data } });
  }
  return textLength || imageCount ? parts : null;
}

router.post('/ai/generate', async (req, res) => {
  if (!req.user?.uid || (!req.user.profile && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'A registered account is required for AI analysis' });
  }
  const parts = validateParts(req.body?.contents);
  if (!parts) return res.status(400).json({ error: 'Provide up to 100,000 text characters and one PNG, JPEG or WebP image under 10 MB' });
  if (req.body.task !== undefined && !['prescription', 'meal-plan', 'emotion'].includes(req.body.task)) {
    return res.status(400).json({ error: 'Invalid analysis task' });
  }
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  if (!key || !/^[a-z0-9][a-z0-9.-]{1,79}$/i.test(model)) {
    return res.status(503).json({ error: 'AI analysis is not configured. Please contact your administrator.' });
  }
  const reservation = req.inferenceReservation || reserveClient(req.user.uid);
  if (!reservation.entry) {
    if (reservation.status === 429) res.set('Retry-After', '60');
    return res.status(reservation.status).json({ error: reservation.error });
  }
  const controller = new AbortController();
  const configuredTimeout = Number(process.env.AI_TIMEOUT_MS || 40_000);
  const timeout = Math.min(45_000, Math.max(1000, Number.isFinite(configuredTimeout) ? configuredTimeout : 40_000));
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2, maxOutputTokens: req.body.task === 'meal-plan' ? 16384 : 8192 } }),
        signal: controller.signal,
      });
      if (!result.ok) {
        // Do not forward provider messages, prompts or credential information.
        if (attempt === 0 && (result.status === 429 || result.status >= 500)) continue;
        return res.status(503).json({ error: 'AI analysis is temporarily unavailable. Please retry.' });
      }
      const data = await result.json();
      if (data.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
        return res.status(503).json({ error: 'AI analysis was incomplete. Please retry with a clearer image or shorter text.' });
      }
      const content = data.candidates?.[0]?.content?.parts;
      const output = Array.isArray(content) ? content.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('\n').trim() : '';
      if (!output) return res.status(503).json({ error: 'AI analysis returned no usable result. Please retry or enter the information manually.' });
      return res.json({ text: output });
    }
    return res.status(503).json({ error: 'AI analysis is temporarily unavailable. Please retry.' });
  } catch (error) {
    console.warn('[AI] Request failed:', error.name === 'AbortError' ? 'timeout' : 'provider unavailable');
    return res.status(503).json({ error: 'AI analysis is temporarily unavailable. Please retry.' });
  } finally {
    clearTimeout(timer);
    if (!req.inferenceReservation) reservation.release();
  }
});

router.post('/ai/cloud-nlp', async (req, res) => {
  if (!req.user?.uid || (!req.user.profile && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'A registered account is required for AI analysis' });
  }
  const text = req.body?.text;
  if (typeof text !== 'string' || !text.trim() || text.length > 100_000) {
    return res.status(400).json({ error: 'Provide prescription text under 100,000 characters' });
  }
  const project = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
  if (!project || !/^[a-z0-9][a-z0-9.-]{1,127}$/i.test(project) || !/^[a-z0-9-]{1,50}$/i.test(location) || !admin.apps.length) {
    return res.status(503).json({ error: 'Cloud NLP is not configured. Please contact your administrator.' });
  }
  const reservation = req.inferenceReservation || reserveClient(req.user.uid);
  if (!reservation.entry) {
    if (reservation.status === 429) res.set('Retry-After', '60');
    return res.status(reservation.status).json({ error: reservation.error });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    // Healthcare NLP requires OAuth. An API key alone cannot authorize access.
    const credential = admin.app().options.credential;
    const token = await Promise.race([
      credential.getAccessToken(),
      new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Timeout')), { once: true })),
    ]);
    if (!token?.access_token) return res.status(503).json({ error: 'Cloud NLP credentials are unavailable' });
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token.access_token}` };
    const key = process.env.GOOGLE_CLOUD_API_KEY;
    if (key) headers['x-goog-api-key'] = key;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await fetch(`https://healthcare.googleapis.com/v1/projects/${project}/locations/${location}/services/nlp:analyzeEntities`, {
        method: 'POST', headers, body: JSON.stringify({ documentContent: text }), signal: controller.signal,
      });
      if (!result.ok) {
        if (attempt === 0 && (result.status === 429 || result.status >= 500)) continue;
        return res.status(503).json({ error: 'Cloud NLP is temporarily unavailable. Please retry.' });
      }
      const data = await result.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return res.status(503).json({ error: 'Cloud NLP returned no usable result' });
      }
      return res.json(data);
    }
    return res.status(503).json({ error: 'Cloud NLP is temporarily unavailable. Please retry.' });
  } catch {
    return res.status(503).json({ error: 'Cloud NLP is temporarily unavailable. Verify the server service account permissions.' });
  } finally {
    clearTimeout(timer);
    if (!req.inferenceReservation) reservation.release();
  }
});

export default router;

async function relayDonut(req, res, prediction) {
  if (!req.user?.profile) return res.status(403).json({ error: 'A registered account is required' });
  const image = prediction && validateImage(req.body?.image);
  if (prediction && !image) return res.status(400).json({ error: 'Provide one PNG, JPEG or WebP image under 10 MB' });
  const base = process.env.DONUT_API_URL || 'http://localhost:8000';
  const token = process.env.DONUT_INTERNAL_TOKEN;
  if (process.env.NODE_ENV === 'production' && !token) return res.status(503).json({ error: 'Prescription reader is not configured' });
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), prediction ? 45_000 : 3000);
  try {
    const result = await fetch(`${base.replace(/\/$/, '')}/${prediction ? 'api/predict-base64' : 'health'}`, {
      method: prediction ? 'POST' : 'GET', headers: { ...(token ? { 'X-Donut-Token': token } : {}), ...(prediction ? { 'Content-Type': 'application/json' } : {}) },
      ...(prediction ? { body: JSON.stringify({ image: image.data }) } : {}), signal: controller.signal,
    });
    if (!result.ok) return res.status(503).json({ error: 'Prescription reader is temporarily unavailable', status: 'offline' });
    const data = await result.json();
    return res.json(data);
  } catch { return res.status(503).json({ error: 'Prescription reader is temporarily unavailable', status: 'offline' }); }
  finally { clearTimeout(timer); }
}
router.get('/ai/donut/health', (req, res) => relayDonut(req, res, false));
router.post('/ai/donut/predict', (req, res) => relayDonut(req, res, true));
