import { validateLiveFrame } from './liveFace.js';
import { summarizeLiveFaceQuality } from './liveFaceQuality.js';

// A conservative, nonclinical reminder. No patient identification, diagnosis,
// backend writes or emergency classification occurs here.
export function createExpressionCheckInMonitor() {
  let started = null, previous = null, track = null, expression = null, samples = 0, lastSound = null;
  const resetEvidence = () => { started = previous = track = expression = null; samples = 0; };
  const reset = () => { resetEvidence(); lastSound = null; };
  function update(input, now = Date.now()) {
    let frame;
    try { frame = validateLiveFrame(input); } catch { resetEvidence(); return null; }
    const captured = Date.parse(frame.capturedAt), completed = Date.parse(input.completedAt);
    if (!Number.isFinite(now) || !Number.isFinite(completed) || captured > completed || completed > now ||
        now - captured > 1500 || now - completed > 1500 || frame.faces.length !== 1) { resetEvidence(); return null; }
    const source = input.faces[0], face = frame.faces[0];
    const quality = summarizeLiveFaceQuality(input, { mode: 'live', frameAgeMs: now - captured });
    const unusable = ['lowConfidence', 'smallFace', 'uncertainExpression', 'dimPixels', 'clippedPixels', 'lowImageDetail', 'eyeLineTilt'];
    const scores = Object.values(face.scores).sort((a, b) => b - a);
    if (quality.state === 'unavailable' || quality.issues.some(issue => unusable.includes(issue)) || source.stable !== true || source.evidenceMode !== 'temporal' ||
        !Number.isInteger(source.evidenceFrames) || source.evidenceFrames < 3 || !Number.isFinite(source.evidenceDurationMs) ||
        source.evidenceDurationMs < 400 || typeof source.id !== 'string' || !source.id ||
        !['angry', 'sad', 'fearful', 'disgusted'].includes(source.expression) || face.detectionConfidence < 0.8 ||
        face.scores[source.expression] < 0.8 || scores[0] - scores[1] < 0.2) { resetEvidence(); return null; }
    // Replaying a completed image cannot accumulate support or fire a sound.
    if (previous !== null && captured === previous) return null;
    if (previous === null || captured < previous || captured - previous > 1500 || track !== source.id || expression !== source.expression) {
      started = captured; samples = 0;
    }
    previous = captured; track = source.id; expression = source.expression; samples += 1;
    if (captured - started < 8000 || samples < 5 || (lastSound !== null && now - lastSound < 60000)) return null;
    lastSound = now;
    return Object.freeze({ type: 'expression-check-in', expression, observedAt: new Date(now).toISOString(), supportingSamples: samples,
      durationMs: captured - started, clinicalAssessment: false, caregiverRequestSent: false });
  }
  return { update, reset };
}

const copy = {
  en: {
    title: 'Expression check-in sound', enable: 'Enable check-in sound', disable: 'Turn sound off', test: 'Test sound',
    notice: 'An optional sound asks you to check on the person after a sustained, clear expression pattern. It cannot detect pain, illness or emergencies, and does not send a caregiver alert. Keep device volume audible.',
    prompted: 'Please check on the person', explanation: 'A repeated facial expression pattern was observed. Ask how they feel; this is not a medical finding.',
    unavailable: 'Sound could not play. Check device audio and try Test sound.',
  },
  ta: {
    title: 'முகபாவனை கவனிப்பு ஒலி', enable: 'கவனிப்பு ஒலியை இயக்கு', disable: 'ஒலியை நிறுத்து', test: 'ஒலியைச் சோதிக்கவும்',
    notice: 'தெளிவான முகபாவனை தொடர்ந்து காணப்பட்டால், விருப்ப ஒலி அந்த நபரைக் கவனிக்கச் சொல்கிறது. வலி, நோய் அல்லது அவசரநிலையை இது கண்டறியாது; பராமரிப்பாளருக்கு எச்சரிக்கையும் அனுப்பாது. சாதன ஒலியளவைச் சரிபார்க்கவும்.',
    prompted: 'அந்த நபரை நேரில் கவனிக்கவும்', explanation: 'ஒரு முகபாவனை தொடர்ந்து காணப்பட்டது. அவர் எப்படி உணர்கிறார் என்று கேளுங்கள்; இது மருத்துவ முடிவு அல்ல.',
    unavailable: 'ஒலியை இயக்க முடியவில்லை. சாதன ஒலியைச் சரிபார்த்து, ஒலிச் சோதனையை முயற்சிக்கவும்.',
  },
  si: {
    title: 'මුහුණේ ඉරියව් පරීක්ෂා කිරීමේ හඬ', enable: 'පරීක්ෂා කිරීමේ හඬ සක්‍රිය කරන්න', disable: 'හඬ නවත්වන්න', test: 'හඬ පරීක්ෂා කරන්න',
    notice: 'පැහැදිලි ඉරියව් රටාවක් දිගටම පෙනෙන විට, විකල්ප හඬ එම පුද්ගලයා ගැන විමසීමට මතක් කරයි. වේදනාව, රෝග හෝ හදිසි අවස්ථා හඳුනාගැනීමට එයට නොහැකි අතර රැකබලාගන්නාට දැනුම්දීමක් යවන්නේ නැත. උපාංගයේ හඬ ඇසෙන ලෙස තබන්න.',
    prompted: 'කරුණාකර එම පුද්ගලයා ගැන විමසන්න', explanation: 'නැවත නැවත මුහුණේ ඉරියව් රටාවක් පෙනුණි. ඔවුන්ට දැනෙන ආකාරය විමසන්න; මෙය වෛද්‍ය නිගමනයක් නොවේ.',
    unavailable: 'හඬ වාදනය කළ නොහැකි විය. උපාංගයේ හඬ පරීක්ෂා කර නැවත උත්සාහ කරන්න.',
  },
};
export const getExpressionCheckInCopy = language => copy[language] || copy.en;
