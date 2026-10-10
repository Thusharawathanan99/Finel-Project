// Experimental engineering scores. Never a diagnosis or probability of wellbeing.
export const EXPRESSION_WEIGHTS = Object.freeze({ happy: 95, surprised: 70, neutral: 60, sad: 25, fearful: 20, disgusted: 15, angry: 10 });
export const ASSESSMENT_VERSION = 'experimental-expression-audio-v1';
const clamp = value => Math.max(0, Math.min(100, value));
export function assessExpressionFrame(frame) {
  if (!frame || !Array.isArray(frame.faces) || frame.faces.length !== 1) return null;
  const face = frame.faces[0], scores = face.smoothedScores || face.scores;
  if (!scores || face.detectionConfidence < 0.6 || face.expression === 'uncertain' || face.stable === false) return null;
  const entries = Object.keys(EXPRESSION_WEIGHTS).map(key => [key, scores[key]]);
  if (entries.some(([, value]) => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) return null;
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const ranked = entries.slice().sort((a, b) => b[1] - a[1]);
  if (Math.abs(total - 1) > 0.02 || ranked[0][1] < 0.45 || ranked[0][1] - ranked[1][1] < 0.1) return null;
  if (!Number.isFinite(Date.parse(frame.capturedAt))) return null;
  return { version: ASSESSMENT_VERSION, facialScore: Math.round(entries.reduce((sum, [key, value]) => sum + value * EXPRESSION_WEIGHTS[key], 0) / total),
    dominantExpression: ranked[0][0], capturedAt: frame.capturedAt, reviewRequired: true };
}
export function combineExperimentalAssessment(face, vocal = null) {
  if (!face || !Number.isInteger(face.facialScore) || face.facialScore < 0 || face.facialScore > 100) return null;
  const usableVoice = vocal && [vocal.wellnessScore, vocal.stabilityScore, vocal.distressScore].every(value => Number.isFinite(value) && value >= 0 && value <= 100);
  return { ...face, version: ASSESSMENT_VERSION, stateScore: Math.round(usableVoice ? (face.facialScore + vocal.wellnessScore) / 2 : face.facialScore),
    vocalScore: usableVoice ? Math.round(vocal.wellnessScore) : null,
    vocalStabilityScore: usableVoice ? Math.round(vocal.stabilityScore) : null,
    vocalDistressScore: usableVoice ? Math.round(vocal.distressScore) : null,
    modalities: usableVoice ? ['facial', 'vocal'] : ['facial'], reviewRequired: true, clinicalDiagnosis: false };
}
export function experimentalObservation(assessment, note = '', relatedMedicine = null) {
  if (!assessment || !Number.isInteger(assessment.stateScore)) throw new Error('Capture a supported expression before saving.');
  return { stateScore: assessment.stateScore, emotionLabel: 'Expression: ' + assessment.dominantExpression,
    category: assessment.stateScore > 50 ? 'positive' : assessment.stateScore < 50 ? 'negative' : 'neutral',
    relatedMedicine: relatedMedicine || null, note: note.trim(), source: 'experimental-assessment', reviewed: true,
    assessment: { version: ASSESSMENT_VERSION, capturedAt: assessment.capturedAt, facialScore: assessment.facialScore,
      vocalScore: assessment.vocalScore, vocalStabilityScore: assessment.vocalStabilityScore,
      vocalDistressScore: assessment.vocalDistressScore, dominantExpression: assessment.dominantExpression } };
}
function pitch(frame, rate) {
  const mean = frame.reduce((a, b) => a + b, 0) / frame.length;
  const min = Math.floor(rate / 500), max = Math.min(frame.length / 2, Math.ceil(rate / 60));
  const correlations = [];
  for (let lag = min; lag <= max; lag++) {
    let xy = 0, xx = 0, yy = 0;
    for (let i = 0; i < frame.length - lag; i++) { const x = frame[i] - mean, y = frame[i + lag] - mean; xy += x * y; xx += x * x; yy += y * y; }
    correlations[lag] = xy / (Math.sqrt(xx * yy) || 1);
  }
  for (let lag = min + 1; lag < max; lag++) if (correlations[lag] >= 0.65 && correlations[lag] >= correlations[lag - 1] && correlations[lag] > correlations[lag + 1]) return rate / lag;
  return 0;
}
export function analyzeAcousticSamples(input, sampleRate) {
  if (!input || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || input.length < sampleRate / 2 || input.length > sampleRate * 30) throw new Error('Record between 0.5 and 30 seconds of audible speech.');
  const step = Math.max(1, Math.floor(sampleRate / 16000)), rate = sampleRate / step;
  if (input.some(value => !Number.isFinite(value))) throw new Error('Invalid audio samples.');
  const samples = Float32Array.from(input.filter((_, i) => i % step === 0));
  const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
  if (rms < 0.003) throw new Error('No audible speech detected. Record again.');
  const pitches = [], amplitudes = [], size = 1024, hop = Math.max(256, Math.floor(samples.length / 120));
  for (let offset = 0; offset + size <= samples.length; offset += hop) {
    const frame = samples.slice(offset, offset + size), energy = Math.sqrt(frame.reduce((sum, value) => sum + value * value, 0) / size);
    if (energy < 0.003) continue;
    const value = pitch(frame, rate);
    if (value) { pitches.push(value); amplitudes.push(energy); }
  }
  if (pitches.length < 3) throw new Error('No reliable voiced speech detected. Record again.');
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const variation = values => values.slice(1).reduce((sum, value, i) => sum + Math.abs(value - values[i]), 0) / (values.length - 1) / mean(values);
  const periods = pitches.map(value => 1 / value), jitter = variation(periods), shimmer = variation(amplitudes), pitchMean = mean(pitches);
  let spectralEnergy = 0, spectralWeighted = 0;
  const n = 256;
  for (let k = 1; k < n / 2; k++) { let real = 0, imaginary = 0;
    for (let i = 0; i < n; i++) { const angle = 2 * Math.PI * k * i / n, windowed = samples[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1))); real += windowed * Math.cos(angle); imaginary -= windowed * Math.sin(angle); }
    const power = (real * real + imaginary * imaginary) / (n * n); spectralEnergy += power; spectralWeighted += power * k * rate / n;
  }
  const clippingFraction = samples.filter(value => Math.abs(value) >= 0.98).length / samples.length;
  if (clippingFraction > 0.1) throw new Error('Audio is clipped. Move the microphone farther away and record again.');
  const stabilityScore = Math.round(clamp(100 * (1 - Math.min(1, jitter * 4 + shimmer * 1.5 + clippingFraction * 5))));
  const zeroCrossingRate = samples.slice(1).reduce((sum, value, i) => sum + Number(value * samples[i] < 0), 0) / samples.length;
  const amplitudeMean = mean(amplitudes);
  const speechRate = amplitudes.slice(1, -1).reduce((sum, value, i) => sum + Number(value > amplitudes[i] && value > amplitudes[i + 2] && value > amplitudeMean * 1.5), 0) / (samples.length / rate);
  return { wellnessScore: stabilityScore, stabilityScore, distressScore: 100 - stabilityScore,
    analysisKind: 'acoustic-heuristic', needsReview: true,
    features: { pitchMean, pitchVariance: mean(pitches.map(value => (value - pitchMean) ** 2)), jitter, shimmer,
      spectralEnergy, spectralCentroid: spectralEnergy ? spectralWeighted / spectralEnergy : 0,
      rmsVolume: rms, energy: rms, clippingFraction, voicedFrames: pitches.length, zeroCrossingRate, speechRate },
    measurementNotice: 'Jitter and shimmer are frame variation proxies. Stability/distress scores are experimental acoustic measures, not emotional or medical diagnoses.' };
}
