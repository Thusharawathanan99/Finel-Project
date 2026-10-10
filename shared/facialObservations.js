import { validateLiveFrame } from './liveFace.js';

// Research geometry only. These rules are not trained Action Units, a pain model,
// a validated health assessment, or proof of continuous movement between samples.
export const FACIAL_OBSERVATION_LIMITS = Object.freeze({ historySamples: 60, windowMs: 30000,
  repeatedSamples: 4, repeatedSpanMs: 2000, baselineSamples: 8, baselineSpanMs: 4000,
  sparseGapMs: 2500, maximumGapMs: 30000 });
const metricKeys = Object.freeze(['leftEyeOpeningRatio', 'rightEyeOpeningRatio', 'mouthOpeningRatio',
  'mouthCornerAsymmetryRatio', 'eyeLineRollDegrees']);
const reasonKeys = Object.freeze(['waiting', 'invalid-frame', 'timestamp-order', 'no-face', 'multiple-faces',
  'missing-track', 'quality-unavailable', 'small-face', 'low-confidence', 'dim-pixels', 'clipped-pixels',
  'low-detail', 'tilted-view', 'oblique-geometry', 'invalid-landmarks', 'view-changed', 'sampled-only']);
const reasonText = {
  en: ['No completed frame yet', 'Frame measurements could not be verified', 'Capture timestamps are duplicated or out of order',
    'No face detected', 'A single visible face is required for movement comparisons', 'Anonymous tracking information is unavailable',
    'Image quality measurements are unavailable', 'Face is too small for these geometric comparisons', 'Face detection confidence is low',
    'Sampled face pixels are too dim', 'Sampled face pixels contain excessive bright clipping', 'Sampled face has low edge detail',
    'Eye line is tilted beyond the comparison limit', 'Landmarks suggest an oblique view; actual 3-D head pose is not measured',
    'Landmark geometry is missing or degenerate', 'Camera view changed relative to calibration; comparisons are withheld',
    'This is an isolated analyzed sample. Tracking continuity and calibration are unavailable'],
  ta: ['முடிந்த படம் இன்னும் இல்லை', 'பட அளவுகளைச் சரிபார்க்க முடியவில்லை', 'படம் எடுத்த நேரம் மீண்டும் வருகிறது அல்லது வரிசை தவறியுள்ளது',
    'முகம் கண்டறியப்படவில்லை', 'முக அசைவுகளை ஒப்பிட ஒரே முகம் தெளிவாகத் தெரிய வேண்டும்', 'தற்காலிக முகத் தொடர்தல் தகவல் கிடைக்கவில்லை',
    'படத் தர அளவுகள் கிடைக்கவில்லை', 'இந்த வடிவியல் ஒப்பீட்டிற்கு முகம் மிகச் சிறியது', 'முகத்தைக் கண்டறியும் நம்பகத்தன்மை குறைவு',
    'முகப் படப் புள்ளிகள் மிகவும் இருண்டுள்ளன', 'முகப் படத்தில் அதிக வெளிச்சம் விவரங்களை மறைக்கிறது', 'முகப் படத்தில் விளிம்பு விவரம் குறைவு',
    'கண் கோடு ஒப்பீட்டு வரம்பிற்கு மேல் சாய்ந்துள்ளது', 'முகப் புள்ளிகள் சாய்வான காட்சியைக் காட்டுகின்றன; முப்பரிமாண தலை நிலை அளவிடப்படவில்லை',
    'முகப் புள்ளிகளின் வடிவியல் கிடைக்கவில்லை அல்லது பொருந்தவில்லை', 'அளவுத்திருத்தத்திலிருந்து கேமரா கோணம் மாறியுள்ளது; ஒப்பீடு நிறுத்தப்பட்டுள்ளது',
    'இது தனித்த பகுப்பாய்வுப் படம். தொடர்ச்சியான முகத் தொடர்தலும் அளவுத்திருத்தமும் கிடைக்கவில்லை'],
  si: ['තවම සම්පූර්ණ වූ රූපයක් නැත', 'රූපයේ මිනුම් තහවුරු කළ නොහැක', 'රූප ගත් වේලාව නැවත පැමිණේ හෝ අනුපිළිවෙළ වැරදිය',
    'මුහුණක් හඳුනාගෙන නැත', 'චලන සැසඳීමට එක් පැහැදිලි මුහුණක් අවශ්‍යයි', 'තාවකාලික මුහුණු ලුහුබැඳීම් තොරතුරු නොමැත',
    'රූපයේ ගුණාත්මක මිනුම් නොමැත', 'මෙම ජ්‍යාමිතික සැසඳීම් සඳහා මුහුණ ඉතා කුඩාය', 'මුහුණ හඳුනාගැනීමේ විශ්වාසය අඩුය',
    'මුහුණු පික්සල ඉතා අඳුරුය', 'මුහුණු රූපයේ ඉතා දීප්තිමත් පික්සල වැඩිය', 'මුහුණු රූපයේ දාර විස්තර අඩුය',
    'ඇස් රේඛාව සැසඳීමේ සීමාවට වඩා ඇල වී ඇත', 'ලක්ෂ්‍යවලින් ආනත දර්ශනයක් පෙනේ; සැබෑ ත්‍රිමාන හිස පිහිටීම මනින්නේ නැත',
    'මුහුණු ලක්ෂ්‍ය ජ්‍යාමිතිය නොමැත හෝ වලංගු නැත', 'ක්‍රමාංකනයේ දර්ශනය වෙනස් වී ඇත; සැසඳීම් නවතා ඇත',
    'මෙය තනි විශ්ලේෂණය කළ නියැදියකි. ලුහුබැඳීමේ අඛණ්ඩතාව සහ ක්‍රමාංකනය නොමැත'],
};
const translations = {
  en: {
    title: 'Facial movement observations',
    states: { unavailable: 'Facial analysis unavailable', observing: 'Collecting sampled observations',
      'no-significant-change': 'No significant measured change', 'repeated-change': 'Repeated observed change · Check-in suggested' },
    metrics: { leftEyeOpeningRatio: 'Left eye opening ratio', rightEyeOpeningRatio: 'Right eye opening ratio',
      mouthOpeningRatio: 'Mouth opening ratio', mouthCornerAsymmetryRatio: 'Roll-corrected mouth-corner difference', eyeLineRollDegrees: '2-D eye-line tilt' },
    baselineStatuses: { off: 'Calibration off', collecting: 'Collecting calibration samples', ready: 'Session calibration ready' },
    notice: 'Experimental landmark geometry with unvalidated comparison rules. Brow action, nose wrinkling, lip tension, jaw motion, pain and health conditions are not measured by this engine.',
    notHealth: 'No measured change does not mean healthy. These observations cannot confirm or exclude an emergency.',
    sampledNotice: 'Measurements describe captured samples only. Movement or eye closure between samples is unknown.',
    sparseNotice: 'Samples are widely spaced. Continuous eye closure or continuous discomfort cannot be inferred.',
    privacy: 'Only anonymous numeric measurements are kept in this session. No face photos, embeddings or calibration records are saved or sent.',
    baselineConsent: 'I agree to temporary, session-only calibration from one visible face. The reference is not a medical normal range and is deleted when tracking or the session ends.',
    baselineStart: 'Agree and calibrate', baselineReset: 'Delete calibration', report: 'Facial observation report', share: 'Share report',
    timeline: 'Sampled observation timeline', clearSession: 'Clear observations', downloadReport: 'Download report', downloadFailed: 'Report export failed. Try again.',
    baselineProgress: 'Calibration samples', ratioUnit: 'ratio', degreesUnit: 'degrees', status: 'Observation', captureTime: 'Frame captured',
    completionTime: 'Analysis completed', samples: 'Eligible samples', samplingGap: 'Gap between captures', baseline: 'Calibration', unknown: 'Not available',
    checkInSuggested: 'Consider asking how the patient feels and whether assistance is needed. Facial movements can have many causes.',
    changedExplanation: 'A geometric difference was observed repeatedly in sampled frames. This is a check-in suggestion, not a medical warning or diagnosis.',
    noChangeExplanation: 'No configured comparison rule was repeatedly met in the eligible samples. This does not assess symptoms or health.',
    observingExplanation: 'More eligible samples over time are needed. A single image cannot establish repeated movement.',
    noBaseline: 'Without calibration, only experimental geometric comparison rules are used.',
    baselineResetReason: 'Calibration was cleared because single-face tracking continuity was lost.',
    baselineUnstable: 'Calibration samples vary too much. Keep a comfortable, steady view and try again.',
    baselineComparison: 'Compared with consented session calibration', geometryComparison: 'Experimental sample geometry',
  },
  ta: {
    title: 'முக அசைவு அளவீடுகள்',
    states: { unavailable: 'முக அளவீடு கிடைக்கவில்லை', observing: 'மாதிரிப் படங்களின் அளவுகள் சேகரிக்கப்படுகின்றன',
      'no-significant-change': 'குறிப்பிடத்தக்க அளவீட்டு மாற்றம் இல்லை', 'repeated-change': 'மீண்டும் காணப்பட்ட மாற்றம் · நலம் விசாரிக்கலாம்' },
    metrics: { leftEyeOpeningRatio: 'இடது கண் திறப்பு விகிதம்', rightEyeOpeningRatio: 'வலது கண் திறப்பு விகிதம்',
      mouthOpeningRatio: 'வாய் திறப்பு விகிதம்', mouthCornerAsymmetryRatio: 'சாய்வு திருத்தப்பட்ட வாய்முனை வேறுபாடு', eyeLineRollDegrees: 'இருபரிமாண கண் கோட்டுச் சாய்வு' },
    baselineStatuses: { off: 'அளவுத்திருத்தம் இல்லை', collecting: 'அளவுத்திருத்த மாதிரிகள் சேகரிக்கப்படுகின்றன', ready: 'இந்த அமர்வின் அளவுத்திருத்தம் தயார்' },
    notice: 'இது சரிபார்க்கப்படாத ஒப்பீட்டு விதிகளுடன் கூடிய பரிசோதனை முகப் புள்ளி அளவீடு. புருவச் செயல், மூக்குச் சுருக்கம், உதட்டு இறுக்கம், தாடை அசைவு, வலி அல்லது உடல்நிலை இதில் அளவிடப்படவில்லை.',
    notHealth: 'அளவீட்டு மாற்றம் இல்லாததால் ஆரோக்கியமாக இருப்பதாகக் கூற முடியாது. இந்த அளவுகள் அவசர நிலையை உறுதிப்படுத்தவோ நிராகரிக்கவோ முடியாது.',
    sampledNotice: 'அளவுகள் எடுக்கப்பட்ட படங்களை மட்டும் விவரிக்கின்றன. படங்களுக்கு இடையிலான அசைவு அல்லது கண் மூடல் தெரியாது.',
    sparseNotice: 'படங்கள் அதிக இடைவெளியில் எடுக்கப்பட்டுள்ளன. தொடர்ந்த கண் மூடலையோ தொடர்ந்த அசௌகரியத்தையோ ஊகிக்க முடியாது.',
    privacy: 'பெயரில்லாத எண் அளவுகள் இந்த அமர்வில் மட்டும் இருக்கும். முகப் புகைப்படங்கள், முக அடையாளத் தரவு அல்லது அளவுத்திருத்தப் பதிவுகள் சேமிக்கப்படவோ அனுப்பப்படவோ மாட்டாது.',
    baselineConsent: 'ஒரே தெரியும் முகத்திலிருந்து இந்த அமர்வுக்கு மட்டும் தற்காலிக அளவுத்திருத்தம் செய்ய ஒப்புக்கொள்கிறேன். இது மருத்துவ இயல்பு வரம்பு அல்ல; முகத் தொடர்தல் அல்லது அமர்வு முடிந்தால் அழிக்கப்படும்.',
    baselineStart: 'ஒப்புக்கொண்டு அளவுத்திருத்து', baselineReset: 'அளவுத்திருத்தத்தை அழி', report: 'முக அளவீட்டு அறிக்கை', share: 'அறிக்கையைப் பகிர்',
    timeline: 'மாதிரிப் பட அளவீட்டுக் காலவரிசை', clearSession: 'அளவீடுகளை அழி', downloadReport: 'அறிக்கையைப் பதிவிறக்கு', downloadFailed: 'அறிக்கையை ஏற்றுமதி செய்ய முடியவில்லை. மீண்டும் முயலவும்.',
    baselineProgress: 'அளவுத்திருத்த மாதிரிகள்', ratioUnit: 'விகிதம்', degreesUnit: 'பாகைகள்', status: 'அளவீடு', captureTime: 'படம் எடுத்த நேரம்',
    completionTime: 'பகுப்பாய்வு முடிந்த நேரம்', samples: 'தகுதியான மாதிரிகள்', samplingGap: 'படங்களுக்கு இடையிலான இடைவெளி', baseline: 'அளவுத்திருத்தம்', unknown: 'கிடைக்கவில்லை',
    checkInSuggested: 'நோயாளி எப்படி உணர்கிறார், உதவி தேவையா என்று கேட்கலாம். முக அசைவுகளுக்குப் பல காரணங்கள் இருக்கலாம்.',
    changedExplanation: 'மாதிரிப் படங்களில் வடிவியல் வேறுபாடு மீண்டும் காணப்பட்டது. இது நலம் விசாரிக்கும் பரிந்துரை; மருத்துவ எச்சரிக்கையோ நோயறிதலோ அல்ல.',
    noChangeExplanation: 'தகுதியான படங்களில் அமைக்கப்பட்ட ஒப்பீட்டு விதி மீண்டும் நிறைவேறவில்லை. இது அறிகுறிகளையோ உடல்நிலையையோ மதிப்பிடாது.',
    observingExplanation: 'கால இடைவெளியில் மேலும் தகுதியான படங்கள் தேவை. ஒரே படம் மீண்டும் நிகழும் அசைவை உறுதிப்படுத்தாது.',
    noBaseline: 'அளவுத்திருத்தம் இல்லாமல் பரிசோதனை வடிவியல் ஒப்பீட்டு விதிகள் மட்டும் பயன்படுத்தப்படுகின்றன.',
    baselineResetReason: 'ஒரே முகத்தின் தொடர்தல் இழந்ததால் அளவுத்திருத்தம் அழிக்கப்பட்டது.',
    baselineUnstable: 'அளவுத்திருத்த மாதிரிகள் அதிகமாக மாறுகின்றன. வசதியான நிலையான காட்சியில் மீண்டும் முயலவும்.',
    baselineComparison: 'ஒப்புதல் அளித்த அமர்வு அளவுத்திருத்தத்துடன் ஒப்பிடப்பட்டது', geometryComparison: 'பரிசோதனைப் பட வடிவியல்',
  },
  si: {
    title: 'මුහුණු චලන නිරීක්ෂණ',
    states: { unavailable: 'මුහුණු විශ්ලේෂණය නොමැත', observing: 'නියැදි නිරීක්ෂණ රැස් කරයි',
      'no-significant-change': 'සැලකිය යුතු මිනුම් වෙනසක් නැත', 'repeated-change': 'නැවත පෙනුණු වෙනසක් · සුවදුක් විමසන්න' },
    metrics: { leftEyeOpeningRatio: 'වම් ඇස විවෘත අනුපාතය', rightEyeOpeningRatio: 'දකුණු ඇස විවෘත අනුපාතය',
      mouthOpeningRatio: 'කට විවෘත අනුපාතය', mouthCornerAsymmetryRatio: 'ඇලවීම නිවැරදි කළ කට කොන වෙනස', eyeLineRollDegrees: 'ද්විමාන ඇස් රේඛාවේ ඇලවීම' },
    baselineStatuses: { off: 'ක්‍රමාංකනය අක්‍රියයි', collecting: 'ක්‍රමාංකන නියැදි රැස් කරයි', ready: 'සැසියේ ක්‍රමාංකනය සූදානම්' },
    notice: 'මෙය තහවුරු නොකළ සැසඳීම් සහිත පර්යේෂණාත්මක මුහුණු ලක්ෂ්‍ය ජ්‍යාමිතියකි. ඇහිබැම ක්‍රියා, නාසය රැලි වීම, තොල් තද වීම, හකු චලනය, වේදනාව හෝ සෞඛ්‍ය තත්ත්ව මෙයින් මනින්නේ නැත.',
    notHealth: 'මිනුම් වෙනසක් නැති බව සෞඛ්‍ය සම්පන්න බව නොවේ. මෙම නිරීක්ෂණවලින් හදිසි අවස්ථාවක් තහවුරු කිරීමට හෝ බැහැර කිරීමට නොහැක.',
    sampledNotice: 'මිනුම් විස්තර කරන්නේ රූප ගත් නියැදි පමණි. නියැදි අතර චලනය හෝ ඇස් වසා තිබීම නොදනී.',
    sparseNotice: 'නියැදි අතර කාල පරතරය වැඩිය. අඛණ්ඩ ඇස් වැසීමක් හෝ අඛණ්ඩ අපහසුතාවක් අනුමාන කළ නොහැක.',
    privacy: 'නිර්නාමික සංඛ්‍යාත්මක මිනුම් මෙම සැසියේ පමණක් තබාගනී. මුහුණු ඡායාරූප, හඳුනාගැනීමේ දත්ත හෝ ක්‍රමාංකන වාර්තා සුරැකීම හෝ යැවීම සිදු නොවේ.',
    baselineConsent: 'එක් පෙනෙන මුහුණකින් මෙම සැසියට පමණක් තාවකාලික ක්‍රමාංකනයට එකඟ වෙමි. මෙය වෛද්‍ය සාමාන්‍ය පරාසයක් නොවේ; ලුහුබැඳීම හෝ සැසිය අවසන් වූ විට මකා දමයි.',
    baselineStart: 'එකඟ වී ක්‍රමාංකනය කරන්න', baselineReset: 'ක්‍රමාංකනය මකන්න', report: 'මුහුණු නිරීක්ෂණ වාර්තාව', share: 'වාර්තාව බෙදාගන්න',
    timeline: 'නියැදි නිරීක්ෂණ කාලරේඛාව', clearSession: 'නිරීක්ෂණ මකන්න', downloadReport: 'වාර්තාව බාගන්න', downloadFailed: 'වාර්තාව අපනයනය අසාර්ථකයි. නැවත උත්සාහ කරන්න.',
    baselineProgress: 'ක්‍රමාංකන නියැදි', ratioUnit: 'අනුපාතය', degreesUnit: 'අංශක', status: 'නිරීක්ෂණය', captureTime: 'රූප ගත් වේලාව',
    completionTime: 'විශ්ලේෂණය අවසන් වූ වේලාව', samples: 'සුදුසු නියැදි', samplingGap: 'රූප අතර කාල පරතරය', baseline: 'ක්‍රමාංකනය', unknown: 'නොමැත',
    checkInSuggested: 'රෝගියාට දැනෙන ආකාරය සහ උදව් අවශ්‍යදැයි විමසන්න. මුහුණු චලනවලට බොහෝ හේතු තිබිය හැක.',
    changedExplanation: 'නියැදි රූපවල ජ්‍යාමිතික වෙනසක් නැවත පෙනුණි. මෙය සුවදුක් විමසීමේ යෝජනාවකි; වෛද්‍ය අනතුරු ඇඟවීමක් හෝ රෝග විනිශ්චයක් නොවේ.',
    noChangeExplanation: 'සුදුසු නියැදිවල සැකසූ සැසඳීම් නීතිය නැවත සපුරා නැත. මෙය රෝග ලක්ෂණ හෝ සෞඛ්‍යය තක්සේරු නොකරයි.',
    observingExplanation: 'කාලය පුරා තවත් සුදුසු නියැදි අවශ්‍යයි. තනි රූපයකින් නැවත ඇතිවන චලනය තහවුරු නොවේ.',
    noBaseline: 'ක්‍රමාංකනය නැති විට පර්යේෂණාත්මක ජ්‍යාමිතික සැසඳීම් පමණක් භාවිත වේ.',
    baselineResetReason: 'එක් මුහුණක ලුහුබැඳීම අහිමි වූ නිසා ක්‍රමාංකනය මකා ඇත.',
    baselineUnstable: 'ක්‍රමාංකන නියැදි බොහෝ වෙනස් වේ. පහසු ස්ථාවර දර්ශනයක නැවත උත්සාහ කරන්න.',
    baselineComparison: 'එකඟ වූ සැසියේ ක්‍රමාංකනය සමඟ සැසඳේ', geometryComparison: 'පර්යේෂණාත්මක නියැදි ජ්‍යාමිතිය',
  },
};
for (const [language, copy] of Object.entries(translations)) {
  copy.reasons = Object.freeze(Object.fromEntries(reasonKeys.map((key, index) => [key, reasonText[language][index]])));
  Object.freeze(copy.states); Object.freeze(copy.metrics); Object.freeze(copy.baselineStatuses);
  copy.metricLabels = copy.metrics; copy.baselineStates = copy.baselineStatuses; copy.researchNotice = copy.notice;
  copy.startBaseline = copy.baselineStart; copy.resetBaseline = copy.baselineReset; copy.unavailable = copy.states.unavailable;
  copy.changeLabels = copy.metrics;
  Object.freeze(copy);
}
Object.freeze(translations);
export function getFacialObservationCopy(language = 'en') {
  const key = typeof language === 'string' ? language.trim().toLowerCase().split(/[-_]/)[0] : 'en';
  return translations[key === 'ta' || key === 'si' ? key : 'en'];
}
const median = values => {
  const sorted = values.slice().sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const cloneMetrics = metrics => metrics ? Object.fromEntries(metricKeys.map(key => [key, metrics[key]])) : null;
const emptyBaseline = reason => ({ status: 'off', samples: [], reference: null, reason: reason || null });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function measurements(face, width, height) {
  if (!Array.isArray(face.landmarks) || face.landmarks.length !== 68) return null;
  // Convert normalized x/y independently into pixels before measuring lengths;
  // using normalized distances directly distorts ratios on non-square frames.
  const points = face.landmarks.map(point => ({ x: point.x * width, y: point.y * height }));
  const mean = start => ({ x: points.slice(start, start + 6).reduce((sum, p) => sum + p.x, 0) / 6,
    y: points.slice(start, start + 6).reduce((sum, p) => sum + p.y, 0) / 6 });
  const left = mean(36), right = mean(42), eyeDistance = distance(left, right);
  const leftWidth = distance(points[36], points[39]), rightWidth = distance(points[42], points[45]);
  const mouthWidth = distance(points[60], points[64]);
  if (eyeDistance < 10 || leftWidth < 6 || rightWidth < 6 || mouthWidth < 8 || right.x <= left.x) return null;
  const axis = { x: (right.x - left.x) / eyeDistance, y: (right.y - left.y) / eyeDistance };
  const vertical = { x: -axis.y, y: axis.x }, mouthDelta = { x: points[54].x - points[48].x, y: points[54].y - points[48].y };
  const midpoint = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  const noseOffset = ((points[30].x - midpoint.x) * axis.x + (points[30].y - midpoint.y) * axis.y) / eyeDistance;
  const metrics = {
    leftEyeOpeningRatio: (distance(points[37], points[41]) + distance(points[38], points[40])) / (2 * leftWidth),
    rightEyeOpeningRatio: (distance(points[43], points[47]) + distance(points[44], points[46])) / (2 * rightWidth),
    mouthOpeningRatio: (distance(points[61], points[67]) + distance(points[62], points[66]) + distance(points[63], points[65])) / (3 * mouthWidth),
    mouthCornerAsymmetryRatio: Math.abs(mouthDelta.x * vertical.x + mouthDelta.y * vertical.y) / eyeDistance,
    eyeLineRollDegrees: Math.atan2(axis.y, axis.x) * 180 / Math.PI,
  };
  if (Object.values(metrics).some(value => !Number.isFinite(value)) || metrics.leftEyeOpeningRatio > 1 ||
      metrics.rightEyeOpeningRatio > 1 || metrics.mouthOpeningRatio > 2 || metrics.mouthCornerAsymmetryRatio > 1) return null;
  return { metrics, noseOffset, eyeDistance, center: { x: face.box.x + face.box.width / 2, y: face.box.y + face.box.height / 2 } };
}
function captureReasons(frame, face, measured) {
  const reasons = [];
  if (face.detectionConfidence < 0.7) reasons.push('low-confidence');
  if (face.box.width * frame.width < 64 || face.box.height * frame.height < 64 || face.box.width * face.box.height < 0.025) reasons.push('small-face');
  const quality = face.imageQuality;
  if (!quality || quality.sampleWidth < 8 || quality.sampleHeight < 8) reasons.push('quality-unavailable');
  else {
    if (quality.meanLuminance < 45 || quality.darkFraction > 0.55) reasons.push('dim-pixels');
    if (quality.meanLuminance > 225 || quality.clippedFraction > 0.2) reasons.push('clipped-pixels');
    if (quality.laplacianVariance < 20) reasons.push('low-detail');
  }
  if (!measured) reasons.push('invalid-landmarks');
  else {
    if (Math.abs(measured.metrics.eyeLineRollDegrees) > 20) reasons.push('tilted-view');
    if (Math.abs(measured.noseOffset) > 0.3) reasons.push('oblique-geometry');
  }
  return reasons;
}
function changed(metrics, reference) {
  if (reference) return metricKeys.filter(key => key !== 'eyeLineRollDegrees' &&
    Math.abs(metrics[key] - reference.metrics[key]) >= (key.includes('Eye') ? Math.max(0.07, reference.metrics[key] * 0.35) :
      key === 'mouthOpeningRatio' ? Math.max(0.12, reference.metrics[key] * 0.6) : 0.045));
  // Explicitly uncalibrated geometric rules; never clinical labels or severity.
  return metricKeys.filter(key => key === 'leftEyeOpeningRatio' || key === 'rightEyeOpeningRatio' ? metrics[key] < 0.12 :
    key === 'mouthOpeningRatio' ? metrics[key] > 0.45 : key === 'mouthCornerAsymmetryRatio' ? metrics[key] > 0.1 : false);
}

/** No clock, networking, disk, face embeddings or photos. Caller controls display recency. */
export function createFacialObservationSession() {
  let history = [], baseline = emptyBaseline(), previous = null, track = null;
  let current = { state: 'unavailable', capturedAt: null, completedAt: null, metrics: null,
    qualityReasons: ['waiting'], changedMetrics: [], samplingGapMs: null, temporalContinuity: 'reset' };
  function snapshot() {
    return { version: 'facial-observation-v1', ...current, metrics: cloneMetrics(current.metrics),
      qualityReasons: current.qualityReasons.slice(), changedMetrics: current.changedMetrics.slice(),
      sampleCount: history.length, windowDurationMs: history.length > 1 ? history[history.length - 1].time - history[0].time : 0,
      comparison: baseline.status === 'ready' ? 'session-baseline' : 'sampled-geometry',
      baseline: { status: baseline.status, sampleCount: baseline.samples.length, requiredSamples: FACIAL_OBSERVATION_LIMITS.baselineSamples,
        minimumDurationMs: FACIAL_OBSERVATION_LIMITS.baselineSpanMs, reason: baseline.reason },
      history: history.map(entry => ({ capturedAt: entry.capturedAt, metrics: cloneMetrics(entry.metrics),
        state: entry.state, changedMetrics: entry.changedMetrics.slice() })) };
  }
  function breakContinuity(clearBaseline = true) {
    history = []; previous = null; track = null;
    if (clearBaseline && baseline.status !== 'off') baseline = emptyBaseline('tracking-reset');
    else if (baseline.status === 'collecting') baseline.samples = [];
  }
  function unavailable(reason, frame = null, preserveBaseline = false) {
    breakContinuity(!preserveBaseline);
    current = { state: 'unavailable', capturedAt: frame?.capturedAt ?? null, completedAt: frame?.completedAt ?? null,
      metrics: null, qualityReasons: Array.isArray(reason) ? reason : [reason], changedMetrics: [], samplingGapMs: null, temporalContinuity: 'reset' };
    return snapshot();
  }
  function update(input) {
    if (input === null || input === undefined) return unavailable('waiting');
    let frame;
    try { frame = validateLiveFrame(input); } catch { return unavailable('invalid-frame'); }
    const time = Date.parse(frame.capturedAt);
    if (previous && time <= previous.time) return unavailable('timestamp-order', frame);
    if (frame.faces.length !== 1) return unavailable(frame.faces.length ? 'multiple-faces' : 'no-face', frame);
    const id = input.faces[0].id;
    if (typeof id !== 'string' || !id.length || id.length > 200 ||
        !['single-frame', 'temporal'].includes(input.faces[0].evidenceMode)) return unavailable('missing-track', frame);
    const isolated = input.sampledAnalysis === true || input.faces[0].evidenceMode === 'single-frame';
    const gap = previous ? time - previous.time : null;
    const gapLimit = Math.min(FACIAL_OBSERVATION_LIMITS.maximumGapMs, Math.max(8000,
      Math.max(previous?.processingTimeMs || 0, frame.processingTimeMs) * 2.5 + 2000));
    const discontinuous = isolated || (track !== null && (id !== track || frame.width !== previous?.width ||
      frame.height !== previous?.height || gap > gapLimit));
    if (discontinuous) breakContinuity();
    const face = frame.faces[0], measured = measurements(face, frame.width, frame.height);
    const reasons = captureReasons(frame, face, measured);
    if (baseline.status === 'ready' && measured &&
        (Math.abs(measured.metrics.eyeLineRollDegrees - baseline.reference.metrics.eyeLineRollDegrees) > 12 ||
         Math.abs(measured.noseOffset - baseline.reference.noseOffset) > 0.12 ||
         measured.eyeDistance / baseline.reference.eyeDistance < 0.65 || measured.eyeDistance / baseline.reference.eyeDistance > 1.55 ||
         distance(measured.center, baseline.reference.center) > 0.2)) reasons.push('view-changed');
    if (reasons.length) {
      // Poor capture must not become an observation. A temporary quality failure
      // retains an already established reference only for the same known track.
      const retain = baseline.status === 'ready' && !discontinuous && (track === null || id === track);
      const result = unavailable(reasons, frame, retain);
      if (retain) { track = id; previous = { time, width: frame.width, height: frame.height, processingTimeMs: frame.processingTimeMs }; }
      return result;
    }
    track = id;
    previous = { time, width: frame.width, height: frame.height, processingTimeMs: frame.processingTimeMs };
    const continuity = discontinuous || gap === null ? 'reset' : gap > FACIAL_OBSERVATION_LIMITS.sparseGapMs ? 'sparse' : 'sampled';
    let flags = changed(measured.metrics, baseline.reference);
    let state = 'observing';
    history.push({ time, capturedAt: frame.capturedAt, metrics: measured.metrics, changedMetrics: flags, state, gap: discontinuous ? null : gap });
    history = history.filter(entry => time - entry.time <= FACIAL_OBSERVATION_LIMITS.windowMs).slice(-FACIAL_OBSERVATION_LIMITS.historySamples);
    if (baseline.status === 'collecting') {
      baseline.samples.push({ time, metrics: cloneMetrics(measured.metrics), noseOffset: measured.noseOffset,
        eyeDistance: measured.eyeDistance, center: { ...measured.center } });
      baseline.samples = baseline.samples.filter(sample => time - sample.time <= FACIAL_OBSERVATION_LIMITS.windowMs)
        .slice(-FACIAL_OBSERVATION_LIMITS.historySamples);
      if (baseline.samples.length >= FACIAL_OBSERVATION_LIMITS.baselineSamples &&
          time - baseline.samples[0].time >= FACIAL_OBSERVATION_LIMITS.baselineSpanMs) {
        const medians = Object.fromEntries(metricKeys.map(key => [key, median(baseline.samples.map(sample => sample.metrics[key]))]));
        const reference = { metrics: medians, noseOffset: median(baseline.samples.map(sample => sample.noseOffset)),
          eyeDistance: median(baseline.samples.map(sample => sample.eyeDistance)), center: {
            x: median(baseline.samples.map(sample => sample.center.x)), y: median(baseline.samples.map(sample => sample.center.y)) } };
        const unstable = baseline.samples.some(sample => ['leftEyeOpeningRatio', 'rightEyeOpeningRatio', 'mouthOpeningRatio', 'mouthCornerAsymmetryRatio'].some(key =>
          Math.abs(sample.metrics[key] - medians[key]) > (key === 'mouthCornerAsymmetryRatio' ? 0.04 : key === 'mouthOpeningRatio' ? 0.1 : 0.05)) ||
          Math.abs(sample.metrics.eyeLineRollDegrees - medians.eyeLineRollDegrees) > 6 || Math.abs(sample.noseOffset - reference.noseOffset) > 0.08 ||
          Math.abs(sample.eyeDistance / reference.eyeDistance - 1) > 0.2 || distance(sample.center, reference.center) > 0.1);
        if (unstable) { baseline.samples = []; baseline.reason = 'unstable-samples'; }
        else {
          baseline.status = 'ready'; baseline.reason = null;
          baseline.reference = reference;
          history = [history[history.length - 1]];
          flags = []; history[0].changedMetrics = [];
        }
      }
    }
    const recent = history.slice(-FACIAL_OBSERVATION_LIMITS.repeatedSamples);
    const sufficient = recent.length === FACIAL_OBSERVATION_LIMITS.repeatedSamples &&
      time - history[0].time >= FACIAL_OBSERVATION_LIMITS.repeatedSpanMs;
    const repeated = sufficient ? flags.filter(key => recent.filter(entry => entry.changedMetrics.includes(key)).length >= 3) : [];
    if (baseline.status !== 'collecting' && sufficient) state = repeated.length ? 'repeated-change' : 'no-significant-change';
    history[history.length - 1].state = state;
    current = { state, capturedAt: frame.capturedAt, completedAt: frame.completedAt ?? null, metrics: measured.metrics,
      qualityReasons: isolated ? ['sampled-only'] : [], changedMetrics: repeated, samplingGapMs: discontinuous ? null : gap,
      temporalContinuity: history.some(entry => entry.gap > FACIAL_OBSERVATION_LIMITS.sparseGapMs) ? 'sparse' : continuity };
    return snapshot();
  }
  function startBaseline(options) {
    if (!options || options.consent !== true) throw new TypeError('Explicit session calibration consent is required.');
    baseline = { status: 'collecting', samples: [], reference: null, reason: null };
    history = []; current = { ...current, state: current.metrics ? 'observing' : 'unavailable', changedMetrics: [] };
    return snapshot();
  }
  function resetBaseline() {
    baseline = emptyBaseline(); history = [];
    current = { ...current, state: current.metrics ? 'observing' : 'unavailable', changedMetrics: [] };
    return snapshot();
  }
  function reset() {
    history = []; baseline = emptyBaseline(); previous = null; track = null;
    current = { state: 'unavailable', capturedAt: null, completedAt: null, metrics: null, qualityReasons: ['waiting'],
      changedMetrics: [], samplingGapMs: null, temporalContinuity: 'reset' };
    return snapshot();
  }
  return { update, startBaseline, resetBaseline, reset };
}

/** Whitelists exported measurements; does not copy names, images, free text or injected diagnoses. */
export function buildFacialObservationReport(snapshot, language = 'en') {
  const copy = getFacialObservationCopy(language);
  const valid = snapshot && snapshot.version === 'facial-observation-v1' && Object.hasOwn(copy.states, snapshot.state);
  const lines = [copy.report, copy.notice, copy.notHealth, copy.privacy];
  if (!valid) return [...lines, copy.states.unavailable].join('\n');
  lines.push(copy.states[snapshot.state]);
  const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19) ? new Date(value).toISOString() : copy.unknown;
  lines.push(copy.captureTime + ': ' + timestamp(snapshot.capturedAt), copy.completionTime + ': ' + timestamp(snapshot.completedAt));
  lines.push(snapshot.temporalContinuity === 'sparse' ? copy.sparseNotice : copy.sampledNotice);
  if (Number.isInteger(snapshot.sampleCount) && snapshot.sampleCount >= 0 && snapshot.sampleCount <= FACIAL_OBSERVATION_LIMITS.historySamples) lines.push(copy.samples + ': ' + snapshot.sampleCount);
  if (typeof snapshot.samplingGapMs === 'number' && Number.isFinite(snapshot.samplingGapMs) && snapshot.samplingGapMs >= 0) lines.push(copy.samplingGap + ': ' + snapshot.samplingGapMs.toFixed(0) + ' ms');
  const baselineStatus = snapshot.baseline?.status;
  lines.push(copy.baseline + ': ' + (Object.hasOwn(copy.baselineStatuses, baselineStatus || '') ? copy.baselineStatuses[baselineStatus] : copy.unknown));
  if (baselineStatus === 'ready') lines.push(copy.baselineComparison);
  else lines.push(copy.noBaseline);
  if (snapshot.baseline?.reason === 'tracking-reset') lines.push(copy.baselineResetReason);
  if (snapshot.baseline?.reason === 'unstable-samples') lines.push(copy.baselineUnstable);
  for (const key of metricKeys) {
    const value = snapshot.state === 'unavailable' ? null : snapshot.metrics?.[key];
    lines.push(copy.metrics[key] + ': ' + (typeof value === 'number' && Number.isFinite(value) &&
      (key === 'eyeLineRollDegrees' ? Math.abs(value) <= 90 : value >= 0 && value <= (key === 'mouthOpeningRatio' ? 2 : 1)) ? value.toFixed(3) + ' ' +
      (key === 'eyeLineRollDegrees' ? copy.degreesUnit : copy.ratioUnit) : copy.unknown));
  }
  for (const reason of Array.isArray(snapshot.qualityReasons) ? snapshot.qualityReasons : []) if (reasonKeys.includes(reason)) lines.push(copy.reasons[reason]);
  if (snapshot.state === 'repeated-change') {
    lines.push(copy.changedExplanation, copy.checkInSuggested);
    for (const key of Array.isArray(snapshot.changedMetrics) ? snapshot.changedMetrics : []) if (metricKeys.includes(key)) lines.push(copy.metrics[key]);
  } else if (snapshot.state === 'no-significant-change') lines.push(copy.noChangeExplanation);
  else if (snapshot.state === 'observing') lines.push(copy.observingExplanation);
  return lines.join('\n');
}
