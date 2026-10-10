import { LIVE_EXPRESSIONS, validateLiveFrame } from './liveFace.js';

// Visibility/performance heuristics, not a clinical score or a calibrated accuracy guarantee.
export const LIVE_FACE_QUALITY_THRESHOLDS = Object.freeze({
  minDetectionConfidence: 0.6, minFaceArea: 0.02, minFacePixels: 48, staleAfterMs: 1500, slowProcessingAfterMs: 1500, minUpdateRateHz: 1,
  minMeanLuminance: 45, maxMeanLuminance: 225, maxDarkFraction: 0.55, maxClippedFraction: 0.2,
  minLaplacianVariance: 20, maxEyeTiltDegrees: 20,
});
const issueKeys = Object.freeze(['waiting', 'invalidFrame', 'invalidMetrics', 'noFace', 'multipleFaces',
  'lowConfidence', 'smallFace', 'uncertainExpression', 'staleFrame', 'slowProcessing', 'slowUpdates', 'cpuBackend',
  'dimPixels', 'clippedPixels', 'lowImageDetail', 'eyeLineTilt']);
const copy = {
  en: {
    title: 'Camera evidence and update quality', faces: 'Faces detected', stable: 'Supported expression estimates',
    uncertain: 'Uncertain estimates', updateRate: 'Completed updates / second', processingTime: 'Processing time',
    status: 'Camera evidence', unknown: 'Not available',
    evidenceNotice: 'Supported estimates describe visible expression patterns, not a person’s feelings or health. Repeated live evidence and a single photo provide different evidence.',
    singleFrameNotice: 'This estimate uses a single photo. It does not establish consistency across time, feelings or health.',
    notHealth: 'These camera metrics cannot confirm or rule out an emergency.',
    states: { waiting: 'Waiting for a completed frame', unavailable: 'Camera evidence unavailable', noFace: 'No face detected in this frame', observed: 'Expression evidence available', limited: 'Expression evidence is limited', stale: 'Showing an older frame' },
    issues: { waiting: 'No completed frame yet', invalidFrame: 'Frame evidence could not be verified', invalidMetrics: 'Some timing information is unavailable', noFace: 'No face detected', multipleFaces: 'Multiple faces detected', lowConfidence: 'Low face detection confidence', smallFace: 'A face occupies a small part of the frame', uncertainExpression: 'Some expression estimates are uncertain', staleFrame: 'The latest frame is over 1.5 seconds old', slowProcessing: 'Processing takes over 1.5 seconds', slowUpdates: 'Fewer than one completed update per second', cpuBackend: 'CPU processing is in use' },
    tips: { waiting: 'Start the camera and wait for a completed update.', invalidFrame: 'Restart detection to obtain fresh, verifiable camera evidence.', invalidMetrics: 'Wait for another update to measure timing. No speed estimate is being assumed.', noFace: 'Keep your face visible and facing the camera. Consider even lighting; lighting has not been measured.', multipleFaces: 'Each estimate follows a visible face during this session; it does not identify a person.', lowConfidence: 'Face detection is less certain. Keep the whole face visible and face the camera.', smallFace: 'Move closer if comfortable so your face occupies more of the frame.', uncertainExpression: 'Wait for a few fresh frames. A clear expression estimate still does not reveal how someone feels.', staleFrame: 'Wait for a fresh update. This older result does not describe the current scene.', slowProcessing: 'Results may lag. Consider a device with supported graphics acceleration.', slowUpdates: 'The displayed rate counts completed results. Wait for fresh evidence before comparing expressions.', cpuBackend: 'This device is using CPU processing and may update slowly. No speed or accuracy guarantee is implied.' },
  },
  ta: {
    title: 'கேமரா தகவலும் புதுப்பிப்புத் தரமும்', faces: 'கண்டறியப்பட்ட முகங்கள்', stable: 'தகவல் ஆதரவுள்ள முகபாவனை மதிப்பீடுகள்',
    uncertain: 'தெளிவற்ற மதிப்பீடுகள்', updateRate: 'வினாடிக்கு முடிந்த புதுப்பிப்புகள்', processingTime: 'செயலாக்க நேரம்',
    status: 'கேமரா தகவல்', unknown: 'கிடைக்கவில்லை',
    evidenceNotice: 'ஆதரவுள்ள மதிப்பீடுகள் தெரியும் முகபாவனையைக் குறிக்கும்; ஒருவரின் உணர்வையோ உடல்நிலையையோ அல்ல. தொடர்ச்சியான நேரடி படங்களும் ஒரே புகைப்படமும் வெவ்வேறு தகவல்களைத் தருகின்றன.',
    singleFrameNotice: 'இந்த மதிப்பீடு ஒரே புகைப்படத்தைப் பயன்படுத்துகிறது. காலம் முழுவதும் ஒரே முடிவு கிடைப்பதையோ உணர்வையோ உடல்நிலையையோ உறுதிப்படுத்தாது.',
    notHealth: 'இந்த கேமரா அளவுகள் அவசர நிலையை உறுதிப்படுத்தவோ நிராகரிக்கவோ முடியாது.',
    states: { waiting: 'முடிந்த படத்திற்காகக் காத்திருக்கிறது', unavailable: 'கேமரா தகவல் கிடைக்கவில்லை', noFace: 'இந்தப் படத்தில் முகம் கண்டறியப்படவில்லை', observed: 'முகபாவனைத் தகவல் கிடைக்கிறது', limited: 'முகபாவனைத் தகவல் வரையறுக்கப்பட்டுள்ளது', stale: 'பழைய படம் காட்டப்படுகிறது' },
    issues: { waiting: 'இன்னும் முடிந்த படம் இல்லை', invalidFrame: 'படத் தகவலைச் சரிபார்க்க முடியவில்லை', invalidMetrics: 'சில நேரத் தகவல்கள் கிடைக்கவில்லை', noFace: 'முகம் கண்டறியப்படவில்லை', multipleFaces: 'பல முகங்கள் கண்டறியப்பட்டன', lowConfidence: 'முகத்தைக் கண்டறிவதில் குறைந்த நம்பகத்தன்மை', smallFace: 'படத்தில் முகம் சிறிய இடத்தை மட்டுமே பிடிக்கிறது', uncertainExpression: 'சில முகபாவனை மதிப்பீடுகள் தெளிவற்றவை', staleFrame: 'கடைசி படம் 1.5 வினாடிகளுக்கு மேல் பழையது', slowProcessing: 'செயலாக்கம் 1.5 வினாடிகளுக்கு மேல் எடுக்கிறது', slowUpdates: 'வினாடிக்கு ஒன்றுக்கும் குறைவான புதுப்பிப்புகள் முடிகின்றன', cpuBackend: 'மையச் செயலி மூலம் செயலாக்கப்படுகிறது' },
    tips: { waiting: 'கேமராவைத் தொடங்கி ஒரு புதுப்பிப்பு முடியும் வரை காத்திருக்கவும்.', invalidFrame: 'புதிய, சரிபார்க்கக்கூடிய தகவலைப் பெற கண்டறிதலை மீண்டும் தொடங்கவும்.', invalidMetrics: 'நேரத்தை அளவிட அடுத்த புதுப்பிப்புக்காகக் காத்திருக்கவும். வேகம் ஊகிக்கப்படவில்லை.', noFace: 'முகம் முழுவதும் தெரியும்படி கேமராவை நோக்கவும். சீரான வெளிச்சத்தை முயற்சிக்கலாம்; வெளிச்சம் அளவிடப்படவில்லை.', multipleFaces: 'ஒவ்வொரு மதிப்பீடும் இந்த அமர்வில் தெரியும் முகத்தைப் பின்தொடரும்; நபரை அடையாளம் காணாது.', lowConfidence: 'முகத்தைக் கண்டறிதல் தெளிவாக இல்லை. முழு முகமும் தெரியும்படி கேமராவை நோக்கவும்.', smallFace: 'வசதியாக இருந்தால் கேமராவுக்கு அருகில் வரவும்; முகம் படத்தில் அதிக இடத்தைப் பிடிக்கட்டும்.', uncertainExpression: 'சில புதிய படங்களுக்காகக் காத்திருக்கவும். தெளிவான முகபாவனையும் ஒருவர் எப்படி உணர்கிறார் என்பதைச் சொல்லாது.', staleFrame: 'புதிய புதுப்பிப்புக்காகக் காத்திருக்கவும். இந்தப் பழைய முடிவு தற்போதைய காட்சியை விவரிக்காது.', slowProcessing: 'முடிவுகள் தாமதமாகலாம். ஆதரிக்கப்படும் வரைகலை வேகப்படுத்தல் உள்ள சாதனத்தைப் பயன்படுத்தலாம்.', slowUpdates: 'காட்டப்படும் வேகம் முடிந்த முடிவுகளை மட்டுமே கணக்கிடுகிறது. முகபாவனைகளை ஒப்பிடும் முன் புதிய தகவலுக்காகக் காத்திருக்கவும்.', cpuBackend: 'இந்தச் சாதனம் மையச் செயலியைப் பயன்படுத்துவதால் மெதுவாகப் புதுப்பிக்கலாம். வேகம் அல்லது துல்லியத்திற்கு உத்தரவாதம் இல்லை.' },
  },
  si: {
    title: 'කැමරා සාක්ෂි සහ යාවත්කාලීන ගුණාත්මකභාවය', faces: 'හඳුනාගත් මුහුණු', stable: 'සාක්ෂි සහිත ඉරියව් ඇස්තමේන්තු',
    uncertain: 'අවිනිශ්චිත ඇස්තමේන්තු', updateRate: 'තත්පරයකට සම්පූර්ණ වූ යාවත්කාලීන', processingTime: 'සැකසුම් කාලය',
    status: 'කැමරා සාක්ෂි', unknown: 'නොමැත',
    evidenceNotice: 'සාක්ෂි සහිත ඇස්තමේන්තු පෙනෙන ඉරියව් රටා ගැනයි; පුද්ගලයෙකුගේ හැඟීම් හෝ සෞඛ්‍යය ගැන නොවේ. නැවත ලැබෙන සජීවී රූප සහ තනි ඡායාරූපයක් වෙනස් සාක්ෂි සපයයි.',
    singleFrameNotice: 'මෙම ඇස්තමේන්තුව තනි ඡායාරූපයකින් ලබා ගනී. කාලය පුරා එකඟතාව, හැඟීම් හෝ සෞඛ්‍යය එයින් තහවුරු නොවේ.',
    notHealth: 'මෙම කැමරා මිනුම්වලින් හදිසි අවස්ථාවක් තහවුරු කිරීමට හෝ බැහැර කිරීමට නොහැක.',
    states: { waiting: 'සම්පූර්ණ වූ රූපයක් සඳහා රැඳී සිටී', unavailable: 'කැමරා සාක්ෂි නොමැත', noFace: 'මෙම රූපයේ මුහුණක් හඳුනාගෙන නැත', observed: 'ඉරියව් සාක්ෂි ඇත', limited: 'ඉරියව් සාක්ෂි සීමිතය', stale: 'පැරණි රූපයක් පෙන්වයි' },
    issues: { waiting: 'තවම සම්පූර්ණ වූ රූපයක් නැත', invalidFrame: 'රූපයේ සාක්ෂි තහවුරු කළ නොහැකි විය', invalidMetrics: 'සමහර කාල තොරතුරු නොමැත', noFace: 'මුහුණක් හඳුනාගෙන නැත', multipleFaces: 'මුහුණු කිහිපයක් හඳුනාගෙන ඇත', lowConfidence: 'මුහුණ හඳුනාගැනීමේ විශ්වාසය අඩුය', smallFace: 'මුහුණ රූපයේ කුඩා කොටසක් පමණක් ගනී', uncertainExpression: 'සමහර ඉරියව් ඇස්තමේන්තු අවිනිශ්චිතය', staleFrame: 'අවසන් රූපය තත්පර 1.5කට වඩා පැරණිය', slowProcessing: 'සැකසීමට තත්පර 1.5කට වඩා ගත වේ', slowUpdates: 'තත්පරයකට යාවත්කාලීනයකටත් අඩු ගණනක් සම්පූර්ණ වේ', cpuBackend: 'මධ්‍යම සැකසුම් ඒකකය භාවිත වේ' },
    tips: { waiting: 'කැමරාව අරඹා යාවත්කාලීනයක් සම්පූර්ණ වන තුරු රැඳී සිටින්න.', invalidFrame: 'නැවුම්, තහවුරු කළ හැකි සාක්ෂි ලබාගැනීමට හඳුනාගැනීම නැවත අරඹන්න.', invalidMetrics: 'කාලය මැනීමට ඊළඟ යාවත්කාලීනය තෙක් රැඳී සිටින්න. වේගය උපකල්පනය කර නැත.', noFace: 'මුළු මුහුණම පෙනෙන සේ කැමරාව දෙස බලන්න. ඒකාකාර ආලෝකය උත්සාහ කළ හැක; ආලෝකය මැන නැත.', multipleFaces: 'එක් එක් ඇස්තමේන්තුව මෙම සැසියේ පෙනෙන මුහුණක් අනුගමනය කරයි; පුද්ගලයෙකු හඳුනා නොගනී.', lowConfidence: 'මුහුණ හඳුනාගැනීම අඩු විශ්වාසදායකය. මුළු මුහුණම පෙනෙන සේ කැමරාව දෙස බලන්න.', smallFace: 'පහසු නම් මඳක් ළං වන්න; මුහුණ රූපයේ වැඩි කොටසක් ගන්නා සේ සිටින්න.', uncertainExpression: 'නැවුම් රූප කිහිපයක් තෙක් රැඳී සිටින්න. පැහැදිලි ඉරියව්වක් වුවත් පුද්ගලයෙකුගේ හැඟීම් නොකියයි.', staleFrame: 'නැවුම් යාවත්කාලීනයක් තෙක් රැඳී සිටින්න. මෙම පැරණි ප්‍රතිඵලය වත්මන් දර්ශනය විස්තර නොකරයි.', slowProcessing: 'ප්‍රතිඵල ප්‍රමාද විය හැක. සහාය දක්වන රූප සැකසුම් ත්වරණය ඇති උපකරණයක් සලකා බලන්න.', slowUpdates: 'පෙන්වන වේගය ගණන් කරන්නේ සම්පූර්ණ වූ ප්‍රතිඵලයි. ඉරියව් සැසඳීමට පෙර නැවුම් සාක්ෂි තෙක් රැඳී සිටින්න.', cpuBackend: 'මෙම උපකරණය මධ්‍යම සැකසුම් ඒකකය භාවිත කරන නිසා යාවත්කාලීන මන්දගාමී විය හැක. වේගය හෝ නිරවද්‍යතාව සහතික නොවේ.' },
  },
};
const measuredCopy = {
  en: {
    issues: { dimPixels: 'Low brightness in sampled face pixels', clippedPixels: 'Very bright face pixels', lowImageDetail: 'Low image detail in the face sample', eyeLineTilt: 'Tilted eye line in this image' },
    tips: {
      dimPixels: 'Face pixels are dim. Try even light. This pixel heuristic has not been validated for recognition accuracy.',
      clippedPixels: 'Many face pixels are very bright. Reduce glare or direct light. This pixel heuristic is unvalidated.',
      lowImageDetail: 'The sampled face has little edge detail. Hold still and check focus. This unvalidated heuristic cannot confirm blur.',
      eyeLineTilt: 'The detected eye line tilts over 20° in the image. Face the camera comfortably. This 2-D measurement does not measure head turning or occlusion.',
    },
  },
  ta: {
    issues: { dimPixels: 'முகப் படப் புள்ளிகளில் குறைந்த ஒளிர்வு', clippedPixels: 'மிகவும் பிரகாசமான முகப் படப் புள்ளிகள்', lowImageDetail: 'முகப் படத்தில் குறைந்த விளிம்பு விவரம்', eyeLineTilt: 'இந்தப் படத்தில் சாய்ந்த கண் கோடு' },
    tips: {
      dimPixels: 'முகப் படப் புள்ளிகள் இருண்டுள்ளன. சீரான வெளிச்சத்தை முயற்சிக்கவும். இந்தப் பட விதி கண்டறிதல் துல்லியத்திற்காகச் சரிபார்க்கப்படவில்லை.',
      clippedPixels: 'பல முகப் படப் புள்ளிகள் மிகப் பிரகாசமாக உள்ளன. பிரதிபலிப்பையோ நேரடி வெளிச்சத்தையோ குறைக்கவும். இந்தப் பட விதி சரிபார்க்கப்படவில்லை.',
      lowImageDetail: 'முகப் படத்தில் விளிம்பு விவரம் குறைவு. அசையாமல் இருந்து கேமரா தெளிவைப் பார்க்கவும். சரிபார்க்கப்படாத இந்த விதி மங்கலை உறுதிப்படுத்தாது.',
      eyeLineTilt: 'படத்தில் கண்டறியப்பட்ட கண் கோடு 20°க்கு மேல் சாய்ந்துள்ளது. வசதியாகக் கேமராவை நோக்கவும். இந்த இருபரிமாண அளவு தலைத் திருப்பத்தையோ மறைப்பையோ அளவிடாது.',
    },
  },
  si: {
    issues: { dimPixels: 'මුහුණේ රූප පික්සලවල අඩු දීප්තිය', clippedPixels: 'ඉතා දීප්තිමත් මුහුණු පික්සල', lowImageDetail: 'මුහුණු රූපයේ අඩු දාර විස්තර', eyeLineTilt: 'මෙම රූපයේ ඇස් රේඛාව ඇල වී ඇත' },
    tips: {
      dimPixels: 'මුහුණු පික්සල අඳුරුය. සමාන ආලෝකයක් උත්සාහ කරන්න. මෙම රූප නීතිය හඳුනාගැනීමේ නිරවද්‍යතාව සඳහා තහවුරු කර නැත.',
      clippedPixels: 'බොහෝ මුහුණු පික්සල ඉතා දීප්තිමත්ය. දිලිසීම හෝ සෘජු ආලෝකය අඩු කරන්න. මෙම රූප නීතිය තහවුරු කර නැත.',
      lowImageDetail: 'මුහුණු රූපයේ දාර විස්තර අඩුය. නිශ්චලව සිට කැමරාවේ පැහැදිලිතාව බලන්න. තහවුරු නොකළ මෙම නීතියෙන් බොඳ බව තහවුරු කළ නොහැක.',
      eyeLineTilt: 'හඳුනාගත් ඇස් රේඛාව රූපයේ 20°කට වඩා ඇල වී ඇත. පහසු ලෙස කැමරාව දෙස බලන්න. මෙම ද්විමාන මිනුමෙන් හිස හැරීම හෝ ආවරණය මනින්නේ නැත.',
    },
  },
};
for (const [language, value] of Object.entries(copy)) {
  Object.assign(value.issues, measuredCopy[language].issues); Object.assign(value.tips, measuredCopy[language].tips);
  Object.freeze(value.states); Object.freeze(value.issues); Object.freeze(value.tips); Object.freeze(value);
}
Object.freeze(copy);
export function getLiveFaceQualityCopy(language = 'en') {
  const key = typeof language === 'string' ? language.trim().toLowerCase().split(/[-_]/)[0] : 'en';
  return copy[key === 'ta' || key === 'si' ? key : 'en'];
}
function validNumber(value, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
}
function verifiedStability(face) {
  if (!face || typeof face.stable !== 'boolean' || !validNumber(face.expressionConfidence, 1) ||
      (face.expression !== 'uncertain' && !LIVE_EXPRESSIONS.includes(face.expression)) ||
      face.stable !== (face.expression !== 'uncertain')) throw new TypeError('Unverified tracked expression.');
  const scores = face.smoothedScores;
  if (!scores || typeof scores !== 'object' || Array.isArray(scores) || Object.keys(scores).length !== LIVE_EXPRESSIONS.length ||
      Object.keys(scores).some(key => !LIVE_EXPRESSIONS.includes(key)) ||
      LIVE_EXPRESSIONS.some(key => !validNumber(scores[key], 1))) throw new TypeError('Unverified tracked probabilities.');
  const values = LIVE_EXPRESSIONS.map(key => scores[key]);
  if (Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 0.02 ||
      Math.abs(Math.max(...values) - face.expressionConfidence) > 0.000001 ||
      (face.stable && Math.abs(scores[face.expression] - face.expressionConfidence) > 0.000001)) {
    throw new TypeError('Inconsistent tracked expression.');
  }
  if (!['single-frame', 'temporal'].includes(face.evidenceMode) || !Number.isInteger(face.evidenceFrames) ||
      !validNumber(face.evidenceFrames) || !validNumber(face.evidenceDurationMs) ||
      (face.evidenceFrames <= 1 && face.evidenceDurationMs !== 0) || (face.evidenceFrames > 1 && face.evidenceDurationMs === 0) ||
      (face.stable && !face.evidenceFrames) || (face.stable && face.evidenceMode === 'temporal' && face.evidenceFrames < 2)) {
    throw new TypeError('Unverified expression evidence.');
  }
  return face.stable;
}
function result(state, issues, facts = {}) {
  const codes = Object.freeze(issueKeys.filter(key => issues.includes(key)));
  return Object.freeze({ state, issues: codes, reasonCodes: codes, faceCount: null, stableCount: null, uncertainCount: null,
    lowConfidenceCount: null, smallFaceCount: null, processingTimeMs: null, completedRateHz: null,
    frameAgeMs: null, backend: null, evidenceMode: null, ...facts });
}

/** Pure visibility/evidence summary. Explicit timing only; no clock, pixels, identity or clinical data. */
export function summarizeLiveFaceQuality(input, options = {}) {
  if (input === null || input === undefined) return result('waiting', ['waiting']);
  let frame, stableCount;
  try {
    frame = validateLiveFrame(input);
    stableCount = input.faces.reduce((sum, face) => sum + (verifiedStability(face) ? 1 : 0), 0);
  } catch { return result('unavailable', ['invalidFrame']); }
  const issues = [];
  const config = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  if (config !== options) issues.push('invalidMetrics');
  if (config.mode !== undefined && !['live', 'photo'].includes(config.mode)) issues.push('invalidMetrics');
  const photo = config.mode === 'photo';
  let completedRateHz = null, frameAgeMs = null, backend = null;
  const rate = config.completedRateHz ?? config.fps;
  if (!photo && rate !== undefined) {
    if (validNumber(rate, 1000)) completedRateHz = rate;
    else issues.push('invalidMetrics');
  }
  if (!photo && config.completedRateHz !== undefined && config.fps !== undefined && config.completedRateHz !== config.fps) {
    completedRateHz = null; issues.push('invalidMetrics');
  }
  if (!photo && config.frameAgeMs !== undefined) {
    if (validNumber(config.frameAgeMs)) frameAgeMs = config.frameAgeMs;
    else issues.push('invalidMetrics');
  } else if (!photo && config.now !== undefined) {
    const age = validNumber(config.now) ? config.now - Date.parse(frame.capturedAt) : NaN;
    if (validNumber(age)) frameAgeMs = age;
    else issues.push('invalidMetrics');
  }
  if (config.backend !== undefined && config.backend !== null) {
    if (['cpu', 'wasm', 'webgl', 'webgl2'].includes(config.backend)) backend = config.backend;
    else issues.push('invalidMetrics');
  }
  const faceCount = frame.faces.length;
  const modes = new Set(input.faces.map(face => face.evidenceMode));
  const evidenceMode = modes.size === 1 ? modes.values().next().value : modes.size > 1 ? null :
    config.mode === 'photo' ? 'single-frame' : config.mode === 'live' ? 'temporal' : null;
  const uncertainCount = faceCount - stableCount;
  const lowConfidenceCount = frame.faces.filter(face => face.detectionConfidence < LIVE_FACE_QUALITY_THRESHOLDS.minDetectionConfidence).length;
  const smallFaceCount = frame.faces.filter(face => face.box.width * face.box.height < LIVE_FACE_QUALITY_THRESHOLDS.minFaceArea - Number.EPSILON ||
    face.box.width * frame.width < LIVE_FACE_QUALITY_THRESHOLDS.minFacePixels || face.box.height * frame.height < LIVE_FACE_QUALITY_THRESHOLDS.minFacePixels).length;
  if (!faceCount) issues.push('noFace');
  if (faceCount > 1) issues.push('multipleFaces');
  if (lowConfidenceCount) issues.push('lowConfidence');
  if (smallFaceCount) issues.push('smallFace');
  if (uncertainCount) issues.push('uncertainExpression');
  // Per-face measurements travel with their own box/landmarks, never by track index.
  // These thresholds guide capture conditions; they do not alter expression scores.
  for (const face of frame.faces) {
    const metrics = face.imageQuality;
    if (!metrics) continue;
    if (metrics.meanLuminance < LIVE_FACE_QUALITY_THRESHOLDS.minMeanLuminance || metrics.darkFraction > LIVE_FACE_QUALITY_THRESHOLDS.maxDarkFraction) issues.push('dimPixels');
    if (metrics.meanLuminance > LIVE_FACE_QUALITY_THRESHOLDS.maxMeanLuminance || metrics.clippedFraction > LIVE_FACE_QUALITY_THRESHOLDS.maxClippedFraction) issues.push('clippedPixels');
    if (metrics.sampleWidth >= 8 && metrics.sampleHeight >= 8 && metrics.laplacianVariance < LIVE_FACE_QUALITY_THRESHOLDS.minLaplacianVariance) issues.push('lowImageDetail');
    if (metrics.eyeTiltDegrees !== null && Math.abs(metrics.eyeTiltDegrees) > LIVE_FACE_QUALITY_THRESHOLDS.maxEyeTiltDegrees) issues.push('eyeLineTilt');
  }
  if (frameAgeMs !== null && frameAgeMs > LIVE_FACE_QUALITY_THRESHOLDS.staleAfterMs) issues.push('staleFrame');
  if (frame.processingTimeMs > LIVE_FACE_QUALITY_THRESHOLDS.slowProcessingAfterMs) issues.push('slowProcessing');
  if (completedRateHz !== null && completedRateHz < LIVE_FACE_QUALITY_THRESHOLDS.minUpdateRateHz) issues.push('slowUpdates');
  if (backend === 'cpu') issues.push('cpuBackend');
  const state = issues.includes('staleFrame') ? 'stale' : !faceCount ? 'noFace' :
    issues.some(key => key !== 'multipleFaces') ? 'limited' : 'observed';
  return result(state, issues, { faceCount, stableCount, uncertainCount, lowConfidenceCount, smallFaceCount,
    processingTimeMs: frame.processingTimeMs, completedRateHz, frameAgeMs, backend, evidenceMode });
}
