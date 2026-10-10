import { getFaceCopy } from './faceReport.js';

// Local expression estimates describe visible patterns, never a person's feelings or health.
export const LIVE_EXPRESSIONS = Object.freeze(['angry', 'disgusted', 'fearful', 'happy', 'neutral', 'sad', 'surprised']);
export const LIVE_UNCERTAINTY_REASONS = Object.freeze(['small-face', 'low-face-confidence', 'weak-expression-score', 'close-leading-scores', 'history-disagreement', 'collecting-evidence']);
export const expressionEmoji = Object.freeze({ angry: '😠', disgusted: '🤢', fearful: '😨', happy: '🙂', neutral: '😐', sad: '😔', surprised: '😮', uncertain: '❔' });
export const EXPRESSION_LABELS = Object.freeze({
  en: Object.freeze({ angry: 'Angry expression', disgusted: 'Disgusted expression', fearful: 'Fearful expression', happy: 'Happy expression', neutral: 'Neutral expression', sad: 'Sad expression', surprised: 'Surprised expression', uncertain: 'Uncertain expression' }),
  ta: Object.freeze({ angry: 'கோப முகபாவனை', disgusted: 'அருவருப்பு முகபாவனை', fearful: 'பய முகபாவனை', happy: 'மகிழ்ச்சி முகபாவனை', neutral: 'நடுநிலை முகபாவனை', sad: 'சோக முகபாவனை', surprised: 'ஆச்சரிய முகபாவனை', uncertain: 'தெளிவற்ற முகபாவனை' }),
  si: Object.freeze({ angry: 'කෝප ඉරියව්ව', disgusted: 'පිළිකුල් ඉරියව්ව', fearful: 'බිය ඉරියව්ව', happy: 'සතුටු ඉරියව්ව', neutral: 'මධ්‍යස්ථ ඉරියව්ව', sad: 'දුක් ඉරියව්ව', surprised: 'විස්මිත ඉරියව්ව', uncertain: 'අවිනිශ්චිත ඉරියව්ව' }),
});
function invalid(field) { throw new TypeError('Invalid live face frame: ' + field); }
function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
  return value;
}
function number(value, field, min = 0, max = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid(field);
  return value;
}
function iso(value) {
  if (typeof value !== 'string') invalid('capturedAt');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) invalid('capturedAt');
  const [, year, month, day, hour, minute, second, , zone] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1] || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59))) invalid('capturedAt');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || !/^\d{4}-/.test(date.toISOString())) invalid('capturedAt');
  return date.toISOString();
}
function scores(value, field) {
  object(value, field);
  const keys = Object.keys(value);
  if (keys.length !== LIVE_EXPRESSIONS.length || keys.some(key => !LIVE_EXPRESSIONS.includes(key))) invalid(field + '.keys');
  const clean = {};
  for (const key of LIVE_EXPRESSIONS) clean[key] = number(value[key], field + '.' + key);
  // Rounded softmax output may differ slightly from one; unrelated confidence vectors may not.
  if (Math.abs(Object.values(clean).reduce((sum, score) => sum + score, 0) - 1) > 0.02) invalid(field + '.sum');
  return clean;
}
export function validateLiveFrame(input) {
  object(input, 'frame');
  if (input.version !== 'live-face-v1') invalid('version');
  if (input.provider !== 'face-api.js-local') invalid('provider');
  const width = number(input.width, 'width', 1, 32768), height = number(input.height, 'height', 1, 32768);
  if (!Number.isInteger(width) || !Number.isInteger(height)) invalid('dimensions');
  const capturedAt = iso(input.capturedAt);
  let completedAt;
  if (Object.prototype.hasOwnProperty.call(input, 'completedAt')) {
    try { completedAt = iso(input.completedAt); } catch { invalid('completedAt'); }
    number(Date.parse(completedAt) - Date.parse(capturedAt), 'completedAt.delay', 0, Number.MAX_SAFE_INTEGER);
  }
  const processingTimeMs = number(input.processingTimeMs, 'processingTimeMs', 0, Number.MAX_SAFE_INTEGER);
  if (!Array.isArray(input.faces) || input.faces.length > 100) invalid('faces');
  const faces = Array.from(input.faces, (raw, index) => {
    const field = 'faces[' + index + ']';
    object(raw, field); object(raw.box, field + '.box');
    const box = { x: number(raw.box.x, field + '.box.x'), y: number(raw.box.y, field + '.box.y'), width: number(raw.box.width, field + '.box.width'), height: number(raw.box.height, field + '.box.height') };
    if (!box.width || !box.height || box.x + box.width > 1.000001 || box.y + box.height > 1.000001) invalid(field + '.box.bounds');
    const detectionConfidence = number(raw.detectionConfidence, field + '.detectionConfidence');
    const cleanScores = scores(raw.scores, field + '.scores');
    if (!Array.isArray(raw.landmarks) || raw.landmarks.length !== 68) invalid(field + '.landmarks');
    const landmarks = Array.from(raw.landmarks, (point, pointIndex) => {
      object(point, field + '.landmarks[' + pointIndex + ']');
      return { x: number(point.x, field + '.landmarks[' + pointIndex + '].x'), y: number(point.y, field + '.landmarks[' + pointIndex + '].y') };
    });
    const face = { box, detectionConfidence, scores: cleanScores, landmarks };
    if (Object.prototype.hasOwnProperty.call(raw, 'imageQuality')) {
      const quality = object(raw.imageQuality, field + '.imageQuality');
      if (quality.version !== 'face-image-quality-v1') invalid(field + '.imageQuality.version');
      const sampleWidth = number(quality.sampleWidth, field + '.imageQuality.sampleWidth', 1, 96);
      const sampleHeight = number(quality.sampleHeight, field + '.imageQuality.sampleHeight', 1, 96);
      if (!Number.isInteger(sampleWidth) || !Number.isInteger(sampleHeight)) invalid(field + '.imageQuality.samples');
      face.imageQuality = { version: 'face-image-quality-v1', sampleWidth, sampleHeight,
        meanLuminance: number(quality.meanLuminance, field + '.imageQuality.meanLuminance', 0, 255),
        darkFraction: number(quality.darkFraction, field + '.imageQuality.darkFraction'),
        clippedFraction: number(quality.clippedFraction, field + '.imageQuality.clippedFraction'),
        laplacianVariance: number(quality.laplacianVariance, field + '.imageQuality.laplacianVariance', 0, 1040400),
        eyeTiltDegrees: quality.eyeTiltDegrees === null ? null : number(quality.eyeTiltDegrees, field + '.imageQuality.eyeTiltDegrees', -90, 90) };
      if (face.imageQuality.darkFraction + face.imageQuality.clippedFraction > 1.000001) invalid(field + '.imageQuality.fractions');
    }
    return face;
  });
  // Only fixed, canonical numeric facts survive; identifiers, images and notes do not.
  return { version: 'live-face-v1', provider: 'face-api.js-local', width, height, capturedAt, processingTimeMs, faces,
    ...(completedAt === undefined ? {} : { completedAt }) };
}
const center = box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
function iou(a, b) {
  const area = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return area / (a.width * a.height + b.width * b.height - area);
}
function matchCost(track, face, elapsed) {
  const predicted = { ...track.box, x: track.box.x + track.velocity.x * elapsed, y: track.box.y + track.velocity.y * elapsed };
  const a = center(predicted), b = center(face.box);
  const distance = Math.hypot((a.x - b.x) / Math.max(predicted.width, face.box.width), (a.y - b.y) / Math.max(predicted.height, face.box.height));
  const ratio = Math.min(predicted.width * predicted.height, face.box.width * face.box.height) / Math.max(predicted.width * predicted.height, face.box.width * face.box.height);
  const overlap = iou(predicted, face.box);
  if (ratio < 0.4 || distance > 1.3 || (overlap < 0.05 && distance > 0.7)) return null;
  return (1 - overlap) * 0.6 + distance * 0.4;
}
function pathsCross(oldA, newA, oldB, newB) {
  const a = center(oldA), b = center(newA), c = center(oldB), d = center(newB);
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
  if (Math.hypot(r.x, r.y) < 0.01 || Math.hypot(s.x, s.y) < 0.01) return false;
  const cross = (u, v) => u.x * v.y - u.y * v.x;
  const denominator = cross(r, s), offset = { x: c.x - a.x, y: c.y - a.y };
  if (Math.abs(denominator) > 0.000001) {
    const t = cross(offset, s) / denominator, u = cross(offset, r) / denominator;
    return t > 0 && t < 1 && u > 0 && u < 1;
  }
  if (Math.abs(cross(offset, r)) > 0.000001) return false;
  const axis = Math.abs(r.x) >= Math.abs(r.y) ? 'x' : 'y';
  return Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])) < Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]));
}
function nonce() {
  return typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
export function createLiveFaceTracker(options = {}) {
  object(options, 'options');
  const alpha = options.alpha ?? 0.35, minConfidence = options.minConfidence ?? 0.6, minMargin = options.minMargin ?? 0.15, stableFrames = options.stableFrames ?? 3;
  const minFacePixels = options.minFacePixels ?? 48, minFaceArea = options.minFaceArea ?? 0.02;
  const minEvidenceMs = options.minEvidenceMs ?? (stableFrames === 1 ? 0 : 400);
  number(alpha, 'options.alpha', Number.EPSILON, 1); number(minConfidence, 'options.minConfidence'); number(minMargin, 'options.minMargin');
  if (!Number.isInteger(stableFrames) || stableFrames < 1 || stableFrames > 120) invalid('options.stableFrames');
  number(minFacePixels, 'options.minFacePixels', 1, 32768); number(minFaceArea, 'options.minFaceArea');
  number(minEvidenceMs, 'options.minEvidenceMs', 0, 60000);
  const evidenceMode = stableFrames === 1 && minEvidenceMs === 0 ? 'single-frame' : 'temporal';
  let tracks = [], previous = null, session = nonce(), sequence = 0;
  function reset() { tracks = []; previous = null; session = nonce(); sequence = 0; }
  function update(input) {
    const frame = validateLiveFrame(input), now = Date.parse(frame.capturedAt);
    const elapsed = previous ? now - previous.time : 0;
    if (previous && (elapsed <= 0 || elapsed > 1500 || frame.width !== previous.width || frame.height !== previous.height)) tracks = [];
    const edges = [];
    for (let ti = 0; ti < tracks.length; ti++) for (let fi = 0; fi < frame.faces.length; fi++) {
      const cost = matchCost(tracks[ti], frame.faces[fi], elapsed);
      if (cost !== null && cost <= 0.95) edges.push({ ti, fi, cost });
    }
    edges.sort((a, b) => a.cost - b.cost);
    const blockedTracks = new Set(), blockedFaces = new Set();
    for (let ti = 0; ti < tracks.length; ti++) {
      const choices = edges.filter(edge => edge.ti === ti);
      if (choices.length > 1 && choices[1].cost - choices[0].cost < 0.15) {
        blockedTracks.add(ti); blockedFaces.add(choices[0].fi); blockedFaces.add(choices[1].fi);
      }
    }
    for (let fi = 0; fi < frame.faces.length; fi++) {
      const choices = edges.filter(edge => edge.fi === fi);
      if (choices.length > 1 && choices[1].cost - choices[0].cost < 0.15) {
        blockedFaces.add(fi); blockedTracks.add(choices[0].ti); blockedTracks.add(choices[1].ti);
      }
      for (let other = fi + 1; other < frame.faces.length; other++) if (iou(frame.faces[fi].box, frame.faces[other].box) > 0.45) {
        blockedFaces.add(fi); blockedFaces.add(other);
      }
    }
    const assignments = new Map();
    for (const edge of edges) {
      if (blockedTracks.has(edge.ti) || blockedFaces.has(edge.fi)) continue;
      // A reciprocal best match prevents a greedy assignment from forcing a second person onto an old track.
      if (edges.find(item => item.ti === edge.ti) !== edge || edges.find(item => item.fi === edge.fi) !== edge) continue;
      assignments.set(edge.fi, edge.ti);
    }
    const matched = [...assignments.entries()];
    for (let i = 0; i < matched.length; i++) for (let j = i + 1; j < matched.length; j++) {
      const [fi, ti] = matched[i], [otherFi, otherTi] = matched[j];
      if (pathsCross(tracks[ti].box, frame.faces[fi].box, tracks[otherTi].box, frame.faces[otherFi].box)) {
        assignments.delete(fi); assignments.delete(otherFi);
      }
    }
    const next = [];
    const faces = frame.faces.map((face, fi) => {
      const ti = assignments.get(fi), prior = ti === undefined ? null : tracks[ti];
      const smoothedScores = {};
      for (const key of LIVE_EXPRESSIONS) smoothedScores[key] = prior ? alpha * face.scores[key] + (1 - alpha) * prior.scores[key] : face.scores[key];
      const sum = Object.values(smoothedScores).reduce((total, value) => total + value, 0);
      for (const key of LIVE_EXPRESSIONS) smoothedScores[key] /= sum;
      const ranked = LIVE_EXPRESSIONS.map(key => [key, smoothedScores[key]]).sort((a, b) => b[1] - a[1]);
      const rawSum = Object.values(face.scores).reduce((total, value) => total + value, 0);
      const rawRanked = LIVE_EXPRESSIONS.map(key => [key, face.scores[key] / rawSum]).sort((a, b) => b[1] - a[1]);
      const expressionConfidence = ranked[0][1];
      // History can smooth jitter, but must never substitute for the current image.
      // Retain face tracking when an expression is unusable, and abstain immediately.
      const usableSize = face.box.width * frame.width >= minFacePixels && face.box.height * frame.height >= minFacePixels &&
        face.box.width * face.box.height >= minFaceArea - Number.EPSILON;
      const currentSupport = rawRanked[0][0] === ranked[0][0] && rawRanked[0][1] >= minConfidence && rawRanked[0][1] - rawRanked[1][1] >= minMargin;
      const candidate = usableSize && currentSupport && face.detectionConfidence >= minConfidence && expressionConfidence >= minConfidence &&
        expressionConfidence - ranked[1][1] >= minMargin ? ranked[0][0] : 'uncertain';
      const streak = candidate === 'uncertain' ? 0 : prior?.candidate === candidate ? prior.streak + 1 : 1;
      const evidenceStartedAt = candidate === 'uncertain' ? now : prior?.candidate === candidate ? prior.evidenceStartedAt : now;
      const evidenceDurationMs = candidate === 'uncertain' ? 0 : now - evidenceStartedAt;
      const stable = streak >= stableFrames && evidenceDurationMs >= minEvidenceMs;
      // Explain the gate that withheld the label without changing those gates.
      // Current-image evidence takes precedence over historical smoothing.
      let uncertaintyReason = null;
      if (!stable) {
        if (!usableSize) uncertaintyReason = 'small-face';
        else if (face.detectionConfidence < minConfidence) uncertaintyReason = 'low-face-confidence';
        else if (rawRanked[0][1] < minConfidence) uncertaintyReason = 'weak-expression-score';
        else if (rawRanked[0][1] - rawRanked[1][1] < minMargin) uncertaintyReason = 'close-leading-scores';
        else if (rawRanked[0][0] !== ranked[0][0]) uncertaintyReason = 'history-disagreement';
        else if (expressionConfidence < minConfidence) uncertaintyReason = 'weak-expression-score';
        else if (expressionConfidence - ranked[1][1] < minMargin) uncertaintyReason = 'close-leading-scores';
        else uncertaintyReason = 'collecting-evidence';
      }
      const id = prior?.id || 'face-' + session + '-' + (++sequence);
      const oldCenter = prior ? center(prior.box) : center(face.box), newCenter = center(face.box);
      const velocity = prior && elapsed > 0 ? { x: (newCenter.x - oldCenter.x) / elapsed, y: (newCenter.y - oldCenter.y) / elapsed } : { x: 0, y: 0 };
      next.push({ id, box: { ...face.box }, velocity, scores: { ...smoothedScores }, candidate, streak, evidenceStartedAt });
      return { ...face, id, smoothedScores, expression: stable ? candidate : 'uncertain', expressionConfidence, stable,
        evidenceMode, evidenceFrames: streak, evidenceDurationMs, uncertaintyReason };
    });
    // Replace every track immediately: a missing detection never leaves a stale face overlay.
    tracks = next; previous = { time: now, width: frame.width, height: frame.height };
    return { ...frame, faces };
  }
  return { update, reset };
}

const liveCopy = {
  en: {
    title: 'Live face expression check', studio: 'Face analysis studio', studioSubtitle: 'Live face tracking and clear, private reports', patientContext: 'Care context', signalProfile: 'Expression probability profile', liveTitle: 'Local live detection', localProcessing: 'Processed on this device', localPrivacy: 'Live frames stay on this device and are not saved.',
    startCamera: 'Start camera', stopCamera: 'Stop camera', modelLoading: 'Loading local face models…', noFaces: 'No faces detected', faces: 'Faces detected',
    fps: 'Frames per second', updateRate: 'Result updates per second', liveResults: 'Live results', updating: 'Updating', latestFrame: 'Latest frame', processingTime: 'Processing time', milliseconds: 'milliseconds', expression: 'Visible expression estimate', expressionConfidence: 'Local model probability',
    stable: 'Supported estimate', uncertain: 'Uncertain expression', rawScores: 'Current probabilities', smoothedScores: 'Smoothed probabilities', landmarks: 'Face landmarks',
    highestModelScore: 'Highest model score', notConfirmed: 'Not confirmed', rawModelScores: 'Current image model scores', uncertaintyReason: 'Why this estimate is uncertain', noModelScores: 'Valid model scores are unavailable.', noUniqueLeadingScore: 'No single expression has the highest model score.', unconfirmedExplanation: 'The available evidence does not support a confirmed expression.',
    uncertaintyReasons: {
      'small-face': 'The face is too small in this image for a supported expression estimate. Move closer to the camera.',
      'low-face-confidence': 'The face detection score is below the required threshold. Keep your face clearly visible.',
      'weak-expression-score': 'The current or recent expression evidence is below the required score threshold. The model cannot support one expression.',
      'close-leading-scores': 'The leading scores in the current or recent expression evidence are too close to support one expression.',
      'history-disagreement': 'This image differs from recent expression results. Waiting for consistent evidence of the change.',
      'collecting-evidence': 'The current image supports an expression, but more repeated evidence is needed before confirming the estimate.',
    },
    evidenceMode: 'Evidence mode', singleFrame: 'Single-photo estimate', temporalEvidence: 'Repeated live evidence', evidenceFrames: 'Supporting frames', evidenceDuration: 'Evidence duration',
    probabilityHelp: 'These seven-class model scores are not calibrated accuracy measurements. A high percentage can still be wrong and does not establish how someone feels. Other states can be recorded in the patient-reported check-in.',
    likelihoodHelp: 'Cloud likelihoods are categories, not percentage probabilities.', trackingHelp: 'Face numbers are anonymous and last only for this camera session. Unclear or crossing tracks are reset.',
    limitations: 'Visible expressions cannot establish actual feelings, pain, health or identity, and cannot diagnose a condition.',
    report: 'Local live face report', reportAt: 'Frame captured at', analysisCompletedAt: 'Analysis completed at', captureToResultDelay: 'Capture-to-result delay', downloadReport: 'Download live report', modelUnavailable: 'Local face models could not load. Please try again.',
    liveError: 'Local live detection stopped. Please restart the camera.', usePhoto: 'Analyze a photo', cloudPhoto: 'Cloud photo analysis',
    live: 'Live', paused: 'Paused', waitingFresh: 'Waiting for a fresh result', balanced: 'Balanced', enhanced: 'Detailed', detectorMode: 'Detection mode',
    cloudAssist: 'Optional cloud check', cloudConsent: 'When enabled, one camera photo is sent through CareConnect to Google Cloud Vision at most every 15 seconds. These photos are not saved.',
    cloudWaiting: 'Waiting for the next cloud check', cloudLastChecked: 'Last cloud check', showLandmarks: 'Show face landmarks',
    qualityHint: 'Use even light and keep faces visible, facing the camera. Multiple faces are supported.',
    sampledPreview: 'Photo sampled for the cloud check', localPhoto: 'Local photo report', cloudReport: 'Cloud photo report',
    cloudError: 'The cloud check is unavailable. Local live detection can continue.', stop: 'Stop', retry: 'Try again',
  },
  ta: {
    title: 'நேரடி முகபாவனைச் சரிபார்ப்பு', studio: 'முக ஆய்வு மையம்', studioSubtitle: 'நேரடி முகக் கண்காணிப்பும் தெளிவான தனிப்பட்ட அறிக்கைகளும்', patientContext: 'பராமரிப்பு விவரம்', signalProfile: 'முகபாவனை நிகழ்தகவு விவரம்', liveTitle: 'சாதனத்தில் நேரடி முகக் கண்டறிதல்', localProcessing: 'இந்தச் சாதனத்தில் செயலாக்கப்படுகிறது', localPrivacy: 'நேரடி படங்கள் இந்தச் சாதனத்திலேயே இருக்கும்; சேமிக்கப்படாது.',
    startCamera: 'கேமராவைத் தொடங்கு', stopCamera: 'கேமராவை நிறுத்து', modelLoading: 'சாதன முக மாதிரிகள் ஏற்றப்படுகின்றன…', noFaces: 'முகங்கள் கண்டறியப்படவில்லை', faces: 'கண்டறியப்பட்ட முகங்கள்',
    fps: 'வினாடிக்கு படங்கள்', updateRate: 'வினாடிக்கு முடிவு புதுப்பிப்புகள்', liveResults: 'நேரடி முடிவுகள்', updating: 'புதுப்பிக்கப்படுகிறது', latestFrame: 'சமீபத்திய படம்', processingTime: 'செயலாக்க நேரம்', milliseconds: 'மில்லிவினாடிகள்', expression: 'தெரியும் முகபாவனை மதிப்பீடு', expressionConfidence: 'சாதன மாதிரி நிகழ்தகவு',
    stable: 'தகவல் ஆதரவுள்ள மதிப்பீடு', uncertain: 'தெளிவற்ற முகபாவனை', rawScores: 'தற்போதைய நிகழ்தகவுகள்', smoothedScores: 'சீராக்கப்பட்ட நிகழ்தகவுகள்', landmarks: 'முகக் குறியிடங்கள்',
    highestModelScore: 'அதிக மாதிரி மதிப்பெண்', notConfirmed: 'உறுதிப்படுத்தப்படவில்லை', rawModelScores: 'தற்போதைய படத்தின் மாதிரி மதிப்பெண்கள்', uncertaintyReason: 'இந்த மதிப்பீடு தெளிவற்றதாக இருப்பதற்கான காரணம்', noModelScores: 'செல்லுபடியாகும் மாதிரி மதிப்பெண்கள் கிடைக்கவில்லை.', noUniqueLeadingScore: 'ஒரே முகபாவனை அதிக மாதிரி மதிப்பெண்ணைப் பெறவில்லை.', unconfirmedExplanation: 'கிடைக்கும் தகவல்களால் ஒரு முகபாவனையை உறுதிப்படுத்த முடியவில்லை.',
    uncertaintyReasons: {
      'small-face': 'இந்தப் படத்தில் முகம் மிகவும் சிறியதாக இருப்பதால் முகபாவனை மதிப்பீட்டை ஆதரிக்க முடியவில்லை. கேமராவுக்கு அருகில் வருங்கள்.',
      'low-face-confidence': 'முகக் கண்டறிதல் மதிப்பெண் தேவையான அளவுக்குக் கீழே உள்ளது. முகம் தெளிவாகத் தெரியும்படி இருங்கள்.',
      'weak-expression-score': 'தற்போதைய அல்லது சமீபத்திய முகபாவனைத் தகவலின் மதிப்பெண் தேவையான அளவுக்குக் கீழே உள்ளது. மாதிரியால் ஒரு முகபாவனையை ஆதரிக்க முடியவில்லை.',
      'close-leading-scores': 'தற்போதைய அல்லது சமீபத்திய முகபாவனைத் தகவலில் முன்னிலையிலுள்ள மதிப்பெண்கள் மிகவும் அருகில் இருப்பதால் ஒரு முகபாவனையை ஆதரிக்க முடியவில்லை.',
      'history-disagreement': 'இந்தப் படத்தின் முடிவு சமீபத்திய முகபாவனை முடிவுகளிலிருந்து மாறுகிறது. மாற்றத்திற்கான தொடர்ச்சியான தகவலுக்காகக் காத்திருக்கிறது.',
      'collecting-evidence': 'தற்போதைய படம் ஒரு முகபாவனையை ஆதரிக்கிறது; மதிப்பீட்டை உறுதிப்படுத்த மேலும் தொடர்ச்சியான படங்கள் தேவை.',
    },
    evidenceMode: 'தகவல் முறை', singleFrame: 'ஒரே புகைப்பட மதிப்பீடு', temporalEvidence: 'தொடர்ச்சியான நேரடி தகவல்', evidenceFrames: 'ஆதரவுள்ள படங்கள்', evidenceDuration: 'தகவல் கால அளவு',
    probabilityHelp: 'இந்த ஏழு வகைகளுக்கான மாதிரி மதிப்பெண்கள் சரிபார்க்கப்பட்ட துல்லிய அளவுகள் அல்ல. அதிக சதவீத முடிவும் தவறாக இருக்கலாம்; ஒருவர் எப்படி உணர்கிறார் என்பதை உறுதிப்படுத்தாது. மற்ற உணர்வுகளை நோயாளி தெரிவிக்கும் பதிவில் தேர்ந்தெடுக்கலாம்.',
    likelihoodHelp: 'மேக சேவை சாத்தியங்கள் வகைகள் மட்டுமே; சதவீத நிகழ்தகவுகள் அல்ல.', trackingHelp: 'முக எண்கள் பெயரில்லாதவை; இந்தக் கேமரா அமர்விற்கு மட்டுமே. தெளிவற்ற அல்லது குறுக்கிடும் தடங்கள் மீட்டமைக்கப்படும்.',
    limitations: 'தெரியும் முகபாவனைகளால் உண்மையான உணர்வு, வலி, உடல்நலம் அல்லது அடையாளத்தை அறியவோ நோயைக் கண்டறியவோ முடியாது.',
    report: 'சாதன நேரடி முக அறிக்கை', reportAt: 'படம் எடுத்த நேரம்', analysisCompletedAt: 'ஆய்வு முடிந்த நேரம்', captureToResultDelay: 'படம் எடுத்ததிலிருந்து முடிவு கிடைக்கும் தாமதம்', downloadReport: 'நேரடி அறிக்கையைப் பதிவிறக்கு', modelUnavailable: 'சாதன முக மாதிரிகளை ஏற்ற முடியவில்லை. மீண்டும் முயலுங்கள்.',
    liveError: 'சாதன நேரடி முகக் கண்டறிதல் நின்றுவிட்டது. கேமராவை மீண்டும் தொடங்குங்கள்.', usePhoto: 'ஒரு படத்தை ஆய்வு செய்', cloudPhoto: 'மேக சேவை புகைப்பட ஆய்வு',
    live: 'நேரடி', paused: 'இடைநிறுத்தப்பட்டது', waitingFresh: 'புதிய முடிவிற்காகக் காத்திருக்கிறது', balanced: 'சமநிலை', enhanced: 'விரிவான', detectorMode: 'முகக் கண்டறிதல் முறை',
    cloudAssist: 'விருப்ப மேக சேவைச் சரிபார்ப்பு', cloudConsent: 'இதை இயக்கினால், அதிகபட்சம் 15 வினாடிகளுக்கு ஒருமுறை ஒரு கேமரா படம் CareConnect வழியாக Google Cloud Vision-க்கு அனுப்பப்படும். இந்தப் படங்கள் சேமிக்கப்படாது.',
    cloudWaiting: 'அடுத்த மேக சேவைச் சரிபார்ப்புக்காகக் காத்திருக்கிறது', cloudLastChecked: 'கடைசி மேக சேவைச் சரிபார்ப்பு', showLandmarks: 'முகக் குறியிடங்களைக் காட்டு',
    qualityHint: 'சீரான வெளிச்சத்தில் முகங்கள் தெரியும்படி கேமராவை நேராகப் பாருங்கள். பல முகங்களைக் கண்டறியலாம்.',
    sampledPreview: 'மேக சேவைச் சரிபார்ப்புக்காக எடுத்த படம்', localPhoto: 'சாதன புகைப்பட அறிக்கை', cloudReport: 'மேக சேவை புகைப்பட அறிக்கை',
    cloudError: 'மேக சேவைச் சரிபார்ப்பு கிடைக்கவில்லை. சாதனத்தில் நேரடி முகக் கண்டறிதல் தொடரலாம்.', stop: 'நிறுத்து', retry: 'மீண்டும் முயல்',
  },
  si: {
    title: 'සජීවී මුහුණු ඉරියව් පරීක්ෂාව', studio: 'මුහුණු විශ්ලේෂණ මධ්‍යස්ථානය', studioSubtitle: 'සජීවී මුහුණු ලුහුබැඳීම සහ පැහැදිලි පෞද්ගලික වාර්තා', patientContext: 'සත්කාර තොරතුරු', signalProfile: 'ඉරියව් සම්භාවිතා විස්තර', liveTitle: 'උපාංගයේ සජීවී හඳුනාගැනීම', localProcessing: 'මේ උපාංගයේ සකසයි', localPrivacy: 'සජීවී රූප මේ උපාංගයේ පමණක් රැඳෙන අතර සුරැකෙන්නේ නැත.',
    startCamera: 'කැමරාව ආරම්භ කරන්න', stopCamera: 'කැමරාව නවත්වන්න', modelLoading: 'උපාංගයේ මුහුණු ආකෘති පූරණය වෙමින්…', noFaces: 'මුහුණු හඳුනාගත්තේ නැත', faces: 'හඳුනාගත් මුහුණු',
    fps: 'තත්පරයකට රූප', updateRate: 'තත්පරයකට ප්‍රතිඵල යාවත්කාලීන', liveResults: 'සජීවී ප්‍රතිඵල', updating: 'යාවත්කාලීන වෙමින්', latestFrame: 'නවතම රූපය', processingTime: 'සැකසීමට ගත වූ වේලාව', milliseconds: 'මිලි තත්පර', expression: 'පෙනෙන ඉරියව් ඇස්තමේන්තුව', expressionConfidence: 'උපාංග ආකෘතියේ සම්භාවිතාව',
    stable: 'සාක්ෂි සහිත ඇස්තමේන්තුව', uncertain: 'අවිනිශ්චිත ඉරියව්ව', rawScores: 'වත්මන් සම්භාවිතා', smoothedScores: 'සුමට කළ සම්භාවිතා', landmarks: 'මුහුණු ලක්ෂ්‍ය',
    highestModelScore: 'ඉහළම ආකෘති ලකුණ', notConfirmed: 'තහවුරු කර නැත', rawModelScores: 'වත්මන් රූපයේ ආකෘති ලකුණු', uncertaintyReason: 'මෙම ඇස්තමේන්තුව අවිනිශ්චිත වීමට හේතුව', noModelScores: 'වලංගු ආකෘති ලකුණු ලබා ගත නොහැක.', noUniqueLeadingScore: 'එක් ඉරියව්වක් පමණක් ඉහළම ආකෘති ලකුණ ලබා නැත.', unconfirmedExplanation: 'ලැබී ඇති සාක්ෂි එක් ඉරියව්වක් තහවුරු කිරීමට ප්‍රමාණවත් නොවේ.',
    uncertaintyReasons: {
      'small-face': 'මෙම රූපයේ මුහුණ ඉතා කුඩා බැවින් ඉරියව් ඇස්තමේන්තුවට සාක්ෂි ප්‍රමාණවත් නොවේ. කැමරාවට ළං වන්න.',
      'low-face-confidence': 'මුහුණු හඳුනාගැනීමේ ලකුණ අවශ්‍ය සීමාවට අඩුය. මුහුණ පැහැදිලිව පෙනෙන ලෙස තබන්න.',
      'weak-expression-score': 'වත්මන් හෝ මෑත ඉරියව් සාක්ෂිවල ලකුණ අවශ්‍ය සීමාවට අඩුය. ආකෘතියට එක් ඉරියව්වක් සඳහා ප්‍රමාණවත් සාක්ෂි නැත.',
      'close-leading-scores': 'වත්මන් හෝ මෑත ඉරියව් සාක්ෂිවල ප්‍රමුඛ ලකුණු එකිනෙකට ඉතා ආසන්න බැවින් එක් ඉරියව්වක් තෝරා ගැනීමට සාක්ෂි ප්‍රමාණවත් නොවේ.',
      'history-disagreement': 'මෙම රූපයේ ප්‍රතිඵලය මෑත ඉරියව් ප්‍රතිඵලවලට වෙනස්ය. වෙනස සඳහා අඛණ්ඩ සාක්ෂි ලැබෙන තෙක් රැඳී සිටී.',
      'collecting-evidence': 'වත්මන් රූපය එක් ඉරියව්වකට සාක්ෂි සපයයි; ඇස්තමේන්තුව තහවුරු කිරීමට තවත් අඛණ්ඩ රූප අවශ්‍යය.',
    },
    evidenceMode: 'සාක්ෂි ක්‍රමය', singleFrame: 'තනි ඡායාරූප ඇස්තමේන්තුව', temporalEvidence: 'නැවත ලැබෙන සජීවී සාක්ෂි', evidenceFrames: 'සහාය දෙන රූප', evidenceDuration: 'සාක්ෂි කාලය',
    probabilityHelp: 'මේ වර්ග හතේ ආකෘති ලකුණු තහවුරු කළ නිරවද්‍යතා මිනුම් නොවේ. ඉහළ ප්‍රතිශතයක් වුවත් වැරදි විය හැකි අතර පුද්ගලයාට දැනෙන ආකාරය තහවුරු නොකරයි. වෙනත් හැඟීම් රෝගියා විසින් වාර්තා කරන සටහනෙහි තෝරා ගත හැක.',
    likelihoodHelp: 'වලාකුළු සේවාවේ ඇති ඉඩ අගයන් කාණ්ඩ වේ; ප්‍රතිශත සම්භාවිතා නොවේ.', trackingHelp: 'මුහුණු අංක නිර්නාමික වන අතර මේ කැමරා සැසියට පමණි. අපැහැදිලි හෝ හරස්වන ලුහුබැඳීම් යළි සකසයි.',
    limitations: 'පෙනෙන ඉරියව්වලින් සැබෑ හැඟීම්, වේදනාව, සෞඛ්‍යය හෝ අනන්‍යතාව තීරණය කිරීමට හෝ රෝගයක් හඳුනාගැනීමට නොහැක.',
    report: 'උපාංගයේ සජීවී මුහුණු වාර්තාව', reportAt: 'රූපය ගත් වේලාව', analysisCompletedAt: 'විශ්ලේෂණය අවසන් වූ වේලාව', captureToResultDelay: 'රූපය ගැනීමේ සිට ප්‍රතිඵලයට ප්‍රමාදය', downloadReport: 'සජීවී වාර්තාව බාගන්න', modelUnavailable: 'උපාංගයේ මුහුණු ආකෘති පූරණය කළ නොහැකි විය. නැවත උත්සාහ කරන්න.',
    liveError: 'උපාංගයේ සජීවී හඳුනාගැනීම නැවතුණි. කැමරාව නැවත ආරම්භ කරන්න.', usePhoto: 'ඡායාරූපයක් විශ්ලේෂණය කරන්න', cloudPhoto: 'වලාකුළු ඡායාරූප විශ්ලේෂණය',
    live: 'සජීවී', paused: 'තාවකාලිකව නැවතී ඇත', waitingFresh: 'නැවුම් ප්‍රතිඵලයක් සඳහා රැඳී සිටී', balanced: 'සමබර', enhanced: 'විස්තරාත්මක', detectorMode: 'හඳුනාගැනීමේ ක්‍රමය',
    cloudAssist: 'විකල්ප වලාකුළු පරීක්ෂාව', cloudConsent: 'සක්‍රිය කළ විට, වැඩිම වශයෙන් තත්පර 15කට වරක් එක් කැමරා ඡායාරූපයක් CareConnect හරහා Google Cloud Vision වෙත යවනු ලැබේ. මේ ඡායාරූප සුරැකෙන්නේ නැත.',
    cloudWaiting: 'ඊළඟ වලාකුළු පරීක්ෂාව බලාපොරොත්තුවෙන්', cloudLastChecked: 'අවසන් වලාකුළු පරීක්ෂාව', showLandmarks: 'මුහුණු ලක්ෂ්‍ය පෙන්වන්න',
    qualityHint: 'සමාන ආලෝකයක් භාවිත කර මුහුණු පැහැදිලිව කැමරාව දෙසට තබන්න. මුහුණු කිහිපයක් හඳුනාගත හැක.',
    sampledPreview: 'වලාකුළු පරීක්ෂාව සඳහා ගත් ඡායාරූපය', localPhoto: 'උපාංග ඡායාරූප වාර්තාව', cloudReport: 'වලාකුළු ඡායාරූප වාර්තාව',
    cloudError: 'වලාකුළු පරීක්ෂාව ලබා ගත නොහැක. උපාංගයේ සජීවී හඳුනාගැනීම දිගටම ක්‍රියා කළ හැක.', stop: 'නවත්වන්න', retry: 'නැවත උත්සාහ කරන්න',
  },
};
for (const language of ['en', 'ta', 'si']) liveCopy[language] = Object.freeze({ ...getFaceCopy(language), ...liveCopy[language],
  uncertaintyReasons: Object.freeze(liveCopy[language].uncertaintyReasons), expressions: EXPRESSION_LABELS[language] });
Object.freeze(liveCopy);
function languageCode(language) {
  const code = typeof language === 'string' ? language.trim().toLowerCase().split('-')[0] : 'en';
  return Object.prototype.hasOwnProperty.call(liveCopy, code) ? code : 'en';
}
export function getLiveFaceCopy(language = 'en') { return liveCopy[languageCode(language)]; }
export function getExpressionDisplay(expression, value, language = 'en') {
  const copy = getLiveFaceCopy(language);
  const aliases = { joy: 'happy', sorrow: 'sad', anger: 'angry', surprise: 'surprised' };
  const key = Object.prototype.hasOwnProperty.call(aliases, expression) ? aliases[expression] : expression;
  const canonical = LIVE_EXPRESSIONS.includes(key) ? key : 'uncertain';
  const kind = typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? 'probability' : typeof value === 'string' && Object.prototype.hasOwnProperty.call(copy.likelihood, value) ? 'likelihood' : 'unknown';
  return { label: copy.expressions[canonical], emoji: expressionEmoji[canonical], kind,
    valueText: kind === 'probability' ? (value * 100).toFixed(1) + '%' : kind === 'likelihood' ? copy.likelihood[value] : copy.unknown };
}
export function getLiveExpressionSummary(face, language = 'en') {
  const copy = getLiveFaceCopy(language);
  const unavailable = { leading: null, scoreEntries: [], supported: null, uncertaintyReason: null, explanation: copy.noModelScores };
  let raw;
  try {
    object(face, 'summary.face');
    raw = scores(face.scores, 'summary.scores');
  } catch { return unavailable; }
  const scoreEntries = LIVE_EXPRESSIONS.map(expression => {
    const display = getExpressionDisplay(expression, raw[expression], language);
    return { expression, label: display.label, emoji: display.emoji, score: raw[expression], valueText: display.valueText };
  }).sort((a, b) => b.score - a.score);
  // A tied vector has no unique winner. Do not select a class by array order.
  const leading = scoreEntries[0].score > scoreEntries[1].score ? scoreEntries[0] : null;
  let supported = null;
  if (face.stable === true && LIVE_EXPRESSIONS.includes(face.expression) &&
      (face.uncertaintyReason === undefined || face.uncertaintyReason === null)) {
    try {
      const smoothed = scores(face.smoothedScores, 'summary.smoothedScores');
      const confidence = number(face.expressionConfidence, 'summary.expressionConfidence');
      if (leading?.expression === face.expression && Math.abs(smoothed[face.expression] - confidence) <= 0.000001 &&
          Math.abs(Math.max(...Object.values(smoothed)) - confidence) <= 0.000001 &&
          LIVE_EXPRESSIONS.every(expression => expression === face.expression || smoothed[expression] < smoothed[face.expression])) {
        const display = getExpressionDisplay(face.expression, confidence, language);
        supported = { expression: face.expression, label: display.label, emoji: display.emoji, score: confidence, valueText: display.valueText };
      }
    } catch { /* A malformed supported label never replaces the valid raw scores. */ }
  }
  const uncertaintyReason = supported ? null : LIVE_UNCERTAINTY_REASONS.includes(face.uncertaintyReason) ? face.uncertaintyReason : null;
  const explanation = supported ? null : uncertaintyReason ? copy.uncertaintyReasons[uncertaintyReason] :
    leading ? copy.unconfirmedExplanation : copy.noUniqueLeadingScore;
  return { leading, scoreEntries, supported, uncertaintyReason, explanation };
}
export function getCloudExpressionDisplay(signals, language = 'en') {
  const uncertain = () => getExpressionDisplay('uncertain', null, language);
  if (!signals || typeof signals !== 'object' || Array.isArray(signals)) return uncertain();
  const likelihoods = ['UNKNOWN', 'VERY_UNLIKELY', 'UNLIKELY', 'POSSIBLE', 'LIKELY', 'VERY_LIKELY'];
  const ranked = [];
  for (const signal of ['joy', 'sorrow', 'anger', 'surprise']) {
    if (!Object.prototype.hasOwnProperty.call(signals, signal) || typeof signals[signal] !== 'string') return uncertain();
    const rank = likelihoods.indexOf(signals[signal]);
    if (rank < 0) return uncertain();
    ranked.push({ signal, value: signals[signal], rank });
  }
  ranked.sort((a, b) => b.rank - a.rank);
  // Categorical evidence never becomes a probability. A tie or weak category
  // does not support selecting one expression for the face.
  if (ranked[0].rank < likelihoods.indexOf('LIKELY') || ranked[0].rank === ranked[1].rank) return uncertain();
  return getExpressionDisplay(ranked[0].signal, ranked[0].value, language);
}
export function buildLiveReportText(input, language = 'en') {
  const frame = validateLiveFrame(input), copy = getLiveFaceCopy(language);
  const lines = [copy.report, copy.localProcessing, copy.reportAt + ': ' + frame.capturedAt,
    copy.imageDimensions + ': ' + frame.width + ' × ' + frame.height + ' ' + copy.pixels,
    copy.processingTime + ': ' + frame.processingTimeMs.toFixed(1) + ' ' + copy.milliseconds, copy.faces + ': ' + frame.faces.length];
  if (frame.completedAt !== undefined) lines.splice(3, 0, copy.analysisCompletedAt + ': ' + frame.completedAt,
    copy.captureToResultDelay + ': ' + (Date.parse(frame.completedAt) - Date.parse(frame.capturedAt)) + ' ' + copy.milliseconds);
  for (let index = 0; index < frame.faces.length; index++) {
    const face = frame.faces[index], tracked = input.faces[index];
    if (typeof tracked.id !== 'string' || !tracked.id || tracked.id.length > 128 || typeof tracked.stable !== 'boolean') invalid('trackedFace');
    const smoothed = scores(tracked.smoothedScores, 'smoothedScores');
    const confidence = number(tracked.expressionConfidence, 'expressionConfidence');
    if ((!LIVE_EXPRESSIONS.includes(tracked.expression) && tracked.expression !== 'uncertain') || tracked.stable !== (tracked.expression !== 'uncertain')) invalid('expression');
    if (Math.abs(Math.max(...Object.values(smoothed)) - confidence) > 0.000001 || (tracked.stable && Math.abs(smoothed[tracked.expression] - confidence) > 0.000001)) invalid('expressionConfidence.consistency');
    if (!['single-frame', 'temporal'].includes(tracked.evidenceMode)) invalid('evidenceMode');
    const evidenceFrames = number(tracked.evidenceFrames, 'evidenceFrames', 0, Number.MAX_SAFE_INTEGER);
    const evidenceDurationMs = number(tracked.evidenceDurationMs, 'evidenceDurationMs', 0, Number.MAX_SAFE_INTEGER);
    if (!Number.isInteger(evidenceFrames) || (evidenceFrames <= 1 && evidenceDurationMs !== 0) ||
        (evidenceFrames > 1 && evidenceDurationMs === 0) || (tracked.stable && !evidenceFrames) ||
        (tracked.stable && tracked.evidenceMode === 'temporal' && evidenceFrames < 2)) invalid('evidence');
    if (Object.prototype.hasOwnProperty.call(tracked, 'uncertaintyReason') &&
        (tracked.uncertaintyReason !== null && !LIVE_UNCERTAINTY_REASONS.includes(tracked.uncertaintyReason) ||
         tracked.stable && tracked.uncertaintyReason !== null)) invalid('uncertaintyReason');
    const display = getExpressionDisplay(tracked.expression, tracked.expression === 'uncertain' ? null : confidence, language);
    lines.push('', copy.face + ' ' + (index + 1), copy.confidence + ': ' + getExpressionDisplay('uncertain', face.detectionConfidence, language).valueText,
      copy.expression + ': ' + display.emoji + ' ' + display.label, copy.expressionConfidence + ': ' + display.valueText,
      tracked.stable ? copy.stable : copy.uncertain);
    if (!tracked.stable) {
      const summary = getLiveExpressionSummary(tracked, language);
      lines.push(copy.highestModelScore + ': ' + (summary.leading ? summary.leading.emoji + ' ' + summary.leading.label + ' ' + summary.leading.valueText : copy.noUniqueLeadingScore) + ' (' + copy.notConfirmed + ')',
        copy.uncertaintyReason + ': ' + summary.explanation);
    }
    lines.push(
      copy.evidenceMode + ': ' + (tracked.evidenceMode === 'single-frame' ? copy.singleFrame : copy.temporalEvidence),
      copy.evidenceFrames + ': ' + evidenceFrames, copy.evidenceDuration + ': ' + evidenceDurationMs + ' ' + copy.milliseconds,
      copy.landmarks + ': ' + face.landmarks.length, copy.rawModelScores + ':');
    for (const key of LIVE_EXPRESSIONS) lines.push('  ' + copy.expressions[key] + ': ' + getExpressionDisplay(key, face.scores[key], language).valueText);
    lines.push(copy.smoothedScores + ':');
    for (const key of LIVE_EXPRESSIONS) lines.push('  ' + copy.expressions[key] + ': ' + getExpressionDisplay(key, smoothed[key], language).valueText);
  }
  if (!frame.faces.length) lines.push(copy.noFaces);
  lines.push('', copy.probabilityHelp, copy.likelihoodHelp, copy.trackingHelp, copy.limitations, copy.localPrivacy);
  return lines.join('\n');
}
