// Canonical photo facts shared by the API, website and mobile app.
// These signals do not establish a person's feelings, pain or health.
export const FACE_LANGUAGES = Object.freeze([
  Object.freeze({ code: 'en', label: 'English' }),
  Object.freeze({ code: 'ta', label: 'தமிழ்' }),
  Object.freeze({ code: 'si', label: 'සිංහල' }),
]);
export const FACE_LIKELIHOODS = Object.freeze(['UNKNOWN', 'VERY_UNLIKELY', 'UNLIKELY', 'POSSIBLE', 'LIKELY', 'VERY_LIKELY']);
export const FACE_ISSUES = Object.freeze(['no_face', 'multiple_faces', 'low_confidence', 'blurred', 'dark', 'angled', 'small_face']);

function invalid(field) { throw new TypeError('Invalid face report: ' + field); }
function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
  return value;
}
function number(value, field, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid(field);
  return value;
}
function likelihood(value, field) {
  if (!FACE_LIKELIHOODS.includes(value)) invalid(field);
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string') invalid('analyzedAt');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) invalid('analyzedAt');
  const [, y, m, d, h, minute, second, , zone] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(h) > 23 || Number(minute) > 59 || Number(second) > 59) invalid('analyzedAt');
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) invalid('analyzedAt');
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) invalid('analyzedAt');
  const canonical = time.toISOString();
  if (!/^\d{4}-/.test(canonical)) invalid('analyzedAt');
  return canonical;
}

// Multiple faces is informational; other thresholds are photo-retake guidance.
// Neither the guidance nor its thresholds make clinical or accuracy claims.
export function deriveFaceReportIssues(faces, image) {
  const found = new Set();
  if (faces.length === 0) found.add('no_face');
  if (faces.length > 1) found.add('multiple_faces');
  for (const face of faces) {
    if (face.confidence < 0.8) found.add('low_confidence');
    if (['LIKELY', 'VERY_LIKELY'].includes(face.quality.blur)) found.add('blurred');
    if (['LIKELY', 'VERY_LIKELY'].includes(face.quality.underExposure)) found.add('dark');
    if (Object.values(face.pose).some(value => value !== null && Math.abs(value) > 35)) found.add('angled');
    if (face.box.width < 0.1 || face.box.height < 0.1 || face.box.width * image.width < 64 || face.box.height * image.height < 64) found.add('small_face');
  }
  return FACE_ISSUES.filter(issue => found.has(issue));
}

export function validateFaceReport(input) {
  object(input, 'report');
  if (input.version !== 'face-report-v1') invalid('version');
  if (input.provider !== 'google-cloud-vision') invalid('provider');
  const analyzedAt = timestamp(input.analyzedAt);
  object(input.image, 'image');
  const image = {
    width: number(input.image.width, 'image.width', 1, 32768),
    height: number(input.image.height, 'image.height', 1, 32768),
  };
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width * image.height > 32000000) invalid('image.dimensions');
  if (!Array.isArray(input.faces) || input.faces.length > 100) invalid('faces');
  if (!Number.isInteger(input.faceCount) || input.faceCount !== input.faces.length) invalid('faceCount');
  const faces = input.faces.map((raw, index) => {
    const field = 'faces[' + index + ']';
    object(raw, field);
    object(raw.box, field + '.box');
    const box = {
      x: number(raw.box.x, field + '.box.x', 0, 1),
      y: number(raw.box.y, field + '.box.y', 0, 1),
      width: number(raw.box.width, field + '.box.width', 0, 1),
      height: number(raw.box.height, field + '.box.height', 0, 1),
    };
    if (box.width === 0 || box.height === 0 || box.x + box.width > 1.000001 || box.y + box.height > 1.000001) invalid(field + '.box.bounds');
    // Preserve normalized evidence. The bounds tolerance permits only rounding
    // noise from provider coordinates, not a different or cropped face box.
    const confidence = number(raw.confidence, field + '.confidence', 0, 1);
    const landmarkConfidence = raw.landmarkConfidence === null ? null : number(raw.landmarkConfidence, field + '.landmarkConfidence', 0, 1);
    object(raw.pose, field + '.pose');
    const pose = {};
    for (const axis of ['roll', 'pan', 'tilt']) pose[axis] = raw.pose[axis] === null ? null : number(raw.pose[axis], field + '.pose.' + axis, -180, 180);
    object(raw.quality, field + '.quality');
    const quality = { blur: likelihood(raw.quality.blur, field + '.quality.blur'), underExposure: likelihood(raw.quality.underExposure, field + '.quality.underExposure') };
    object(raw.signals, field + '.signals');
    const signals = {};
    for (const signal of ['joy', 'sorrow', 'anger', 'surprise']) signals[signal] = likelihood(raw.signals[signal], field + '.signals.' + signal);
    return { box, confidence, landmarkConfidence, pose, quality, signals };
  });
  if (!Array.isArray(input.issues) || input.issues.some(issue => !FACE_ISSUES.includes(issue)) || new Set(input.issues).size !== input.issues.length) invalid('issues');
  const issues = deriveFaceReportIssues(faces, image);
  if (issues.length !== input.issues.length || issues.some(issue => !input.issues.includes(issue))) invalid('issues.consistency');
  const status = issues.some(issue => issue !== 'multiple_faces') ? 'retake' : 'ready';
  if (input.status !== status) invalid('status');
  // A fresh whitelist keeps patient identifiers, scores, notes and raw provider
  // payloads out of the canonical report and downloaded text.
  return { version: 'face-report-v1', provider: 'google-cloud-vision', analyzedAt, image, faceCount: faces.length, status, faces, issues };
}

const copy = {
  en: {
    title: 'Face photo check', subtitle: 'Review your photo and its detection report.', language: 'Language',
    camera: 'Open camera', cameraHint: 'Face the camera in even light. Keep every face clearly visible; use one face for an individual check.', capture: 'Capture photo', upload: 'Choose a photo',
    analyze: 'Analyze this photo', analyzing: 'Analyzing your photo…', retake: 'Use another photo', close: 'Close', cancel: 'Cancel', back: 'Back',
    preview: 'Photo to be analyzed', report: 'Face detection report', download: 'Download report', share: 'Share report',
    consent: 'Pressing Analyze sends the selected photo through CareConnect to Google Cloud Vision for this analysis.',
    privacyNotice: 'Face photos are not saved in clinical history. A downloaded report may contain the photo you choose to include.',
    limitations: 'Visible face signals cannot establish your actual feelings, pain, health or identity, and cannot diagnose a condition.',
    confidenceHelp: 'Confidence is the model’s detection score, not a guarantee of accuracy.',
    signalsHelp: 'These are model estimates of visible expressions. They do not establish how you feel.',
    ready: 'Report ready', retakeNeeded: 'A clearer photo is recommended', faces: 'Faces detected', face: 'Face', confidence: 'Detection confidence', landmarkConfidence: 'Landmark confidence',
    qualityTitle: 'Photo quality signals', signalsTitle: 'Visible expression signals', poseTitle: 'Face orientation', issuesTitle: 'Photo guidance', likelihoodTitle: 'Likelihood',
    provider: 'Analysis provider', analyzedAt: 'Analyzed at', imageSize: 'Image dimensions', capturedAt: 'Photo prepared at', pixels: 'pixels', degrees: 'degrees',
    box: 'Face box', left: 'Left', top: 'Top', width: 'Width', height: 'Height', unknown: 'Unknown', none: 'None', noFaces: 'No face was detected.',
    unavailable: 'Face analysis is unavailable. Please try again later.',
    cameraPermission: 'Allow camera access to take a photo, or choose a photo from your device.', cameraDenied: 'Camera access was denied. Change the permission or choose a photo.',
    requestPermission: 'Allow camera access', cameraUnavailable: 'A camera is not available on this device.', loading: 'Loading…', noImage: 'Choose or capture a photo first.',
    fileInvalid: 'Choose a readable JPEG or PNG photo.', imageTooLarge: 'This photo is too large. Choose a smaller photo.',
    selfReportTitle: 'Optional wellness check-in', selfReportHelp: 'Tell your care team how you feel. Your answers are separate from the photo report.',
    feeling: 'How do you feel?', score: 'Your wellness score (0–100)', scoreLow: '0: feeling very unwell', scoreHigh: '100: feeling very well',
    scoreHint: 'Choose your own whole-number score from 0 to 100.', note: 'Note (optional)', notePlaceholder: 'Describe how you feel in your own words',
    medicine: 'Related medicine (optional)', noMedicine: 'No medicine selected', save: 'Save my check-in', saving: 'Saving your check-in…', saved: 'Your check-in was saved.',
    saveHelp: 'Only your self-reported feeling, score, note and optional medicine are saved. The face report does not set your score.', signIn: 'Please sign in again to continue.',
    feelings: { Happy: 'Happy', Sad: 'Sad', Angry: 'Angry', Anxious: 'Anxious', Neutral: 'Neutral' },
    quality: { blur: 'Blur', underExposure: 'Underexposure' }, pose: { roll: 'Roll', pan: 'Pan', tilt: 'Tilt' },
    signals: { joy: 'Joy signal', sorrow: 'Sorrow signal', anger: 'Anger signal', surprise: 'Surprise signal' },
    likelihood: { UNKNOWN: 'Unknown', VERY_UNLIKELY: 'Very unlikely', UNLIKELY: 'Unlikely', POSSIBLE: 'Possible', LIKELY: 'Likely', VERY_LIKELY: 'Very likely' },
    issues: {
      no_face: 'No face was detected. Use a clear photo with visible faces.', multiple_faces: 'Multiple faces detected. Each face is analyzed separately; choose one face for an individual check.',
      low_confidence: 'Detection confidence is low. Try a clearer photo.', blurred: 'The photo may be blurred. Hold the camera steady.',
      dark: 'The face may be too dark. Use even lighting.', angled: 'The face is strongly angled. Face the camera more directly.',
      small_face: 'The face is small in the photo. Move closer or choose a closer photo.',
    },
    errors: {
      FACE_NOT_CONFIGURED: 'Face analysis is not configured. Ask the project owner to enable Google Cloud Vision.',
      FACE_UNAVAILABLE: 'Face analysis is unavailable. Please try again later.', INVALID_IMAGE: 'The photo could not be read. Choose a clear JPEG or PNG photo.',
      INVALID_REPORT: 'The service returned an invalid photo report. Please try again.', IMAGE_TOO_LARGE: 'This photo is too large. Choose a smaller photo.',
      camera: 'The camera could not start. Check camera permission or choose a photo.', save: 'Your check-in could not be confirmed as saved. Please try again.',
      session: 'Please sign in again to continue.', share: 'The report could not be shared. Please try again.',
      timeout: 'Analysis took too long. Please try again.', rateLimit: 'Too many requests. Wait a moment and try again.',
      permission: 'You do not have permission for this action.', network: 'Check your connection and try again.', score: 'Choose a whole-number wellness score from 0 to 100.',
    },
  },
  ta: {
    title: 'முகப் புகைப்படச் சரிபார்ப்பு', subtitle: 'உங்கள் படத்தையும் முகக் கண்டறிதல் அறிக்கையையும் பாருங்கள்.', language: 'மொழி',
    camera: 'கேமராவைத் திற', cameraHint: 'சீரான ஒளியில் கேமராவை நோக்குங்கள். எல்லா முகங்களும் தெளிவாகத் தெரியட்டும்; தனிநபர் சோதனைக்கு ஒரு முகத்தை மட்டும் வைத்திருக்கவும்.', capture: 'புகைப்படம் எடு', upload: 'புகைப்படத்தைத் தேர்வு செய்',
    analyze: 'இந்தப் படத்தை ஆய்வு செய்', analyzing: 'படம் ஆய்வு செய்யப்படுகிறது…', retake: 'வேறொரு புகைப்படம் பயன்படுத்து', close: 'மூடு', cancel: 'ரத்து செய்', back: 'பின்செல்',
    preview: 'ஆய்வு செய்யப்படும் புகைப்படம்', report: 'முகக் கண்டறிதல் அறிக்கை', download: 'அறிக்கையைப் பதிவிறக்கு', share: 'அறிக்கையைப் பகிர்',
    consent: 'ஆய்வு பொத்தானை அழுத்தும்போது தேர்ந்தெடுத்த படம் இந்த ஆய்வுக்காக CareConnect வழியாக Google Cloud Vision-க்கு அனுப்பப்படும்.',
    privacyNotice: 'முகப் புகைப்படங்கள் மருத்துவப் பதிவில் சேமிக்கப்படாது. பதிவிறக்கிய அறிக்கையில் நீங்கள் சேர்க்கத் தேர்ந்தெடுக்கும் படம் இருக்கலாம்.',
    limitations: 'முகத்தில் தெரியும் அறிகுறிகளால் உங்கள் உண்மையான உணர்வு, வலி, உடல்நலம் அல்லது அடையாளத்தை அறியவோ நோயைக் கண்டறியவோ முடியாது.',
    confidenceHelp: 'நம்பிக்கை என்பது மாதிரியின் முகக் கண்டறிதல் மதிப்பெண்; துல்லியத்திற்கான உத்தரவாதம் அல்ல.',
    signalsHelp: 'இவை படத்தில் தெரியும் முகபாவனைகளின் மாதிரி மதிப்பீடுகள். நீங்கள் எப்படி உணர்கிறீர்கள் என்பதை இவை உறுதிப்படுத்தாது.',
    ready: 'அறிக்கை தயார்', retakeNeeded: 'இன்னும் தெளிவான படம் பரிந்துரைக்கப்படுகிறது', faces: 'கண்டறியப்பட்ட முகங்கள்', face: 'முகம்', confidence: 'முகக் கண்டறிதல் நம்பிக்கை', landmarkConfidence: 'முகக் குறியிடக் கண்டறிதல் நம்பிக்கை',
    qualityTitle: 'படத் தர அறிகுறிகள்', signalsTitle: 'தெரியும் முகபாவனை அறிகுறிகள்', poseTitle: 'முகத்தின் திசை', issuesTitle: 'புகைப்பட வழிகாட்டல்', likelihoodTitle: 'சாத்தியம்',
    provider: 'ஆய்வு சேவை', analyzedAt: 'ஆய்வு செய்த நேரம்', imageSize: 'படத்தின் அளவு', capturedAt: 'படம் தயாராக்கிய நேரம்', pixels: 'படப்புள்ளிகள்', degrees: 'பாகைகள்',
    box: 'முகக் கட்டம்', left: 'இடப்பக்கம்', top: 'மேற்பக்கம்', width: 'அகலம்', height: 'உயரம்', unknown: 'தெரியவில்லை', none: 'இல்லை', noFaces: 'முகம் கண்டறியப்படவில்லை.',
    unavailable: 'முக ஆய்வு தற்போது கிடைக்கவில்லை. பின்னர் மீண்டும் முயலுங்கள்.',
    cameraPermission: 'புகைப்படம் எடுக்க கேமரா அனுமதி கொடுங்கள் அல்லது உங்கள் சாதனத்திலிருந்து ஒரு படத்தைத் தேர்வு செய்யுங்கள்.', cameraDenied: 'கேமரா அனுமதி மறுக்கப்பட்டது. அனுமதியை மாற்றுங்கள் அல்லது ஒரு படத்தைத் தேர்வு செய்யுங்கள்.',
    requestPermission: 'கேமரா அனுமதி கொடு', cameraUnavailable: 'இந்தச் சாதனத்தில் கேமரா கிடைக்கவில்லை.', loading: 'ஏற்றப்படுகிறது…', noImage: 'முதலில் ஒரு படத்தைத் தேர்வு செய்யுங்கள் அல்லது எடுங்கள்.',
    fileInvalid: 'படிக்கக்கூடிய JPEG அல்லது PNG புகைப்படத்தைத் தேர்வு செய்யுங்கள்.', imageTooLarge: 'படம் மிகப் பெரியது. சிறிய படத்தைத் தேர்வு செய்யுங்கள்.',
    selfReportTitle: 'விருப்ப நலப் பதிவு', selfReportHelp: 'நீங்கள் எப்படி உணர்கிறீர்கள் என்பதை பராமரிப்புக் குழுவிடம் கூறுங்கள். இந்தப் பதில்கள் புகைப்பட அறிக்கையிலிருந்து தனியானவை.',
    feeling: 'நீங்கள் எப்படி உணர்கிறீர்கள்?', score: 'உங்கள் நல மதிப்பெண் (0–100)', scoreLow: '0: மிகவும் நலமின்றி உணர்கிறேன்', scoreHigh: '100: மிகவும் நலமாக உணர்கிறேன்',
    scoreHint: '0 முதல் 100 வரையிலான முழு எண் மதிப்பெண்ணை நீங்களே தேர்வு செய்யுங்கள்.', note: 'குறிப்பு (விருப்பம்)', notePlaceholder: 'உங்கள் உணர்வை உங்கள் சொற்களில் எழுதுங்கள்',
    medicine: 'தொடர்புடைய மருந்து (விருப்பம்)', noMedicine: 'மருந்து தேர்வு செய்யப்படவில்லை', save: 'என் நலப் பதிவைச் சேமி', saving: 'நலப் பதிவு சேமிக்கப்படுகிறது…', saved: 'உங்கள் நலப் பதிவு சேமிக்கப்பட்டது.',
    saveHelp: 'நீங்கள் கூறும் உணர்வு, மதிப்பெண், குறிப்பு மற்றும் விருப்ப மருந்து மட்டுமே சேமிக்கப்படும். முக அறிக்கை உங்கள் மதிப்பெண்ணை நிர்ணயிக்காது.', signIn: 'தொடர மீண்டும் உள்நுழையுங்கள்.',
    feelings: { Happy: 'மகிழ்ச்சி', Sad: 'சோகம்', Angry: 'கோபம்', Anxious: 'பதற்றம்', Neutral: 'இயல்பு' },
    quality: { blur: 'மங்கல்', underExposure: 'குறைந்த வெளிச்சம்' }, pose: { roll: 'பக்கவாட்டுச் சாய்வு', pan: 'பக்கவாட்டுத் திருப்பம்', tilt: 'மேல் கீழ் சாய்வு' },
    signals: { joy: 'மகிழ்ச்சி அறிகுறி', sorrow: 'சோக அறிகுறி', anger: 'கோப அறிகுறி', surprise: 'ஆச்சரிய அறிகுறி' },
    likelihood: { UNKNOWN: 'தெரியவில்லை', VERY_UNLIKELY: 'சாத்தியம் மிகவும் குறைவு', UNLIKELY: 'சாத்தியம் குறைவு', POSSIBLE: 'சாத்தியம் உள்ளது', LIKELY: 'சாத்தியம் அதிகம்', VERY_LIKELY: 'சாத்தியம் மிகவும் அதிகம்' },
    issues: {
      no_face: 'முகம் கண்டறியப்படவில்லை. முகங்கள் தெளிவாகத் தெரியும் படத்தைப் பயன்படுத்துங்கள்.', multiple_faces: 'பல முகங்கள் கண்டறியப்பட்டன. ஒவ்வொரு முகமும் தனித்தனியாக ஆய்வு செய்யப்படுகிறது; தனிநபர் சோதனைக்கு ஒரு முகத்தைத் தேர்ந்தெடுக்கவும்.',
      low_confidence: 'முகக் கண்டறிதல் நம்பிக்கை குறைவாக உள்ளது. தெளிவான படத்துடன் முயலுங்கள்.', blurred: 'படம் மங்கலாக இருக்கலாம். கேமராவை அசையாமல் பிடியுங்கள்.',
      dark: 'முகத்தில் வெளிச்சம் குறைவாக இருக்கலாம். சீரான வெளிச்சத்தைப் பயன்படுத்துங்கள்.', angled: 'முகம் அதிகமாகத் திரும்பியுள்ளது. கேமராவை நேராகப் பாருங்கள்.',
      small_face: 'படத்தில் முகம் சிறியதாக உள்ளது. அருகில் வாருங்கள் அல்லது அருகில் எடுத்த படத்தைத் தேர்வு செய்யுங்கள்.',
    },
    errors: {
      FACE_NOT_CONFIGURED: 'முக ஆய்வு அமைக்கப்படவில்லை. Google Cloud Vision-ஐ இயக்க திட்ட உரிமையாளரிடம் கூறுங்கள்.',
      FACE_UNAVAILABLE: 'முக ஆய்வு தற்போது கிடைக்கவில்லை. பின்னர் மீண்டும் முயலுங்கள்.', INVALID_IMAGE: 'படத்தைப் படிக்க முடியவில்லை. தெளிவான JPEG அல்லது PNG படத்தைத் தேர்வு செய்யுங்கள்.',
      INVALID_REPORT: 'சேவை தவறான புகைப்பட அறிக்கையை வழங்கியது. மீண்டும் முயலுங்கள்.', IMAGE_TOO_LARGE: 'படம் மிகப் பெரியது. சிறிய படத்தைத் தேர்வு செய்யுங்கள்.',
      camera: 'கேமராவைத் தொடங்க முடியவில்லை. அனுமதியைச் சரிபார்க்கவும் அல்லது ஒரு படத்தைத் தேர்வு செய்யவும்.', save: 'உங்கள் நலப் பதிவு சேமிக்கப்பட்டதை உறுதிப்படுத்த முடியவில்லை. மீண்டும் முயலுங்கள்.',
      session: 'தொடர மீண்டும் உள்நுழையுங்கள்.', share: 'அறிக்கையைப் பகிர முடியவில்லை. மீண்டும் முயலுங்கள்.',
      timeout: 'ஆய்வுக்கு அதிக நேரம் ஆனது. மீண்டும் முயலுங்கள்.', rateLimit: 'கோரிக்கைகள் அதிகமாக உள்ளன. சிறிது காத்திருந்து மீண்டும் முயலுங்கள்.',
      permission: 'இந்தச் செயலுக்கு உங்களுக்கு அனுமதி இல்லை.', network: 'இணைய இணைப்பைச் சரிபார்த்து மீண்டும் முயலுங்கள்.', score: '0 முதல் 100 வரையிலான முழு எண் நல மதிப்பெண்ணைத் தேர்வு செய்யுங்கள்.',
    },
  },
  si: {
    title: 'මුහුණේ ඡායාරූප පරීක්ෂාව', subtitle: 'ඔබේ ඡායාරූපය සහ මුහුණු හඳුනාගැනීමේ වාර්තාව බලන්න.', language: 'භාෂාව',
    camera: 'කැමරාව විවෘත කරන්න', cameraHint: 'සමාන ආලෝකයක කැමරාව දෙස බලන්න. සියලු මුහුණු පැහැදිලිව පෙනෙන ලෙස තබන්න; තනි පුද්ගල පරීක්ෂාවකට එක් මුහුණක් තෝරන්න.', capture: 'ඡායාරූපය ගන්න', upload: 'ඡායාරූපයක් තෝරන්න',
    analyze: 'මේ ඡායාරූපය විශ්ලේෂණය කරන්න', analyzing: 'ඡායාරූපය විශ්ලේෂණය කරමින්…', retake: 'වෙනත් ඡායාරූපයක් භාවිත කරන්න', close: 'වසන්න', cancel: 'අවලංගු කරන්න', back: 'ආපසු',
    preview: 'විශ්ලේෂණය කරන ඡායාරූපය', report: 'මුහුණු හඳුනාගැනීමේ වාර්තාව', download: 'වාර්තාව බාගන්න', share: 'වාර්තාව බෙදා ගන්න',
    consent: 'විශ්ලේෂණ බොත්තම එබූ විට තෝරාගත් ඡායාරූපය මේ විශ්ලේෂණය සඳහා CareConnect හරහා Google Cloud Vision වෙත යවනු ලැබේ.',
    privacyNotice: 'මුහුණු ඡායාරූප සායනික ඉතිහාසයේ සුරැකෙන්නේ නැත. බාගත් වාර්තාවක ඔබ ඇතුළත් කිරීමට තෝරාගත් ඡායාරූපය තිබිය හැක.',
    limitations: 'මුහුණේ පෙනෙන සංඥාවලින් ඔබේ සැබෑ හැඟීම්, වේදනාව, සෞඛ්‍යය හෝ අනන්‍යතාව තීරණය කිරීමට හෝ රෝගයක් හඳුනාගැනීමට නොහැක.',
    confidenceHelp: 'විශ්වාසය යනු ආකෘතියේ හඳුනාගැනීමේ අගයයි; නිරවද්‍යතාව පිළිබඳ සහතිකයක් නොවේ.',
    signalsHelp: 'මේවා පෙනෙන මුහුණු ඉරියව් පිළිබඳ ආකෘතියේ ඇස්තමේන්තු වේ. ඔබට දැනෙන ආකාරය ඒවායින් තහවුරු නොවේ.',
    ready: 'වාර්තාව සූදානම්', retakeNeeded: 'වඩා පැහැදිලි ඡායාරූපයක් නිර්දේශ කෙරේ', faces: 'හඳුනාගත් මුහුණු', face: 'මුහුණ', confidence: 'මුහුණු හඳුනාගැනීමේ විශ්වාසය', landmarkConfidence: 'මුහුණු ලක්ෂ්‍ය හඳුනාගැනීමේ විශ්වාසය',
    qualityTitle: 'ඡායාරූපයේ ගුණාත්මක සංඥා', signalsTitle: 'පෙනෙන මුහුණු ඉරියව් සංඥා', poseTitle: 'මුහුණේ දිශාව', issuesTitle: 'ඡායාරූප මඟපෙන්වීම', likelihoodTitle: 'ඇති ඉඩ',
    provider: 'විශ්ලේෂණ සේවාව', analyzedAt: 'විශ්ලේෂණ වේලාව', imageSize: 'රූපයේ ප්‍රමාණය', capturedAt: 'ඡායාරූපය සකස් කළ වේලාව', pixels: 'පික්සල', degrees: 'අංශක',
    box: 'මුහුණු කොටුව', left: 'වම', top: 'ඉහළ', width: 'පළල', height: 'උස', unknown: 'නොදනී', none: 'නැත', noFaces: 'මුහුණක් හඳුනා ගත්තේ නැත.',
    unavailable: 'මුහුණු විශ්ලේෂණය දැනට ලබා ගත නොහැක. පසුව නැවත උත්සාහ කරන්න.',
    cameraPermission: 'ඡායාරූපයක් ගැනීමට කැමරා අවසර දෙන්න, නැතහොත් ඔබේ උපාංගයෙන් ඡායාරූපයක් තෝරන්න.', cameraDenied: 'කැමරා අවසර ප්‍රතික්ෂේප විය. අවසර වෙනස් කරන්න හෝ ඡායාරූපයක් තෝරන්න.',
    requestPermission: 'කැමරා අවසර දෙන්න', cameraUnavailable: 'මේ උපාංගයේ කැමරාවක් ලබා ගත නොහැක.', loading: 'පූරණය වෙමින්…', noImage: 'පළමුව ඡායාරූපයක් තෝරන්න හෝ ගන්න.',
    fileInvalid: 'කියවිය හැකි JPEG හෝ PNG ඡායාරූපයක් තෝරන්න.', imageTooLarge: 'මේ ඡායාරූපය විශාල වැඩියි. කුඩා ඡායාරූපයක් තෝරන්න.',
    selfReportTitle: 'විකල්ප සුවතා සටහන', selfReportHelp: 'ඔබට දැනෙන ආකාරය සත්කාර කණ්ඩායමට කියන්න. ඔබේ පිළිතුරු ඡායාරූප වාර්තාවෙන් වෙනස් වේ.',
    feeling: 'ඔබට දැනෙන්නේ කෙසේද?', score: 'ඔබේ සුවතා අගය (0–100)', scoreLow: '0: ඉතා අසනීප බවක් දැනේ', scoreHigh: '100: ඉතා සුවෙන් බවක් දැනේ',
    scoreHint: '0 සිට 100 දක්වා පූර්ණ අංක අගයක් ඔබම තෝරන්න.', note: 'සටහන (විකල්ප)', notePlaceholder: 'ඔබට දැනෙන ආකාරය ඔබේ වචනවලින් ලියන්න',
    medicine: 'අදාළ ඖෂධය (විකල්ප)', noMedicine: 'ඖෂධයක් තෝරා නැත', save: 'මගේ සුවතා සටහන සුරකින්න', saving: 'සුවතා සටහන සුරකිමින්…', saved: 'ඔබේ සුවතා සටහන සුරැකිණි.',
    saveHelp: 'ඔබ පැවසූ හැඟීම, අගය, සටහන සහ විකල්ප ඖෂධය පමණක් සුරැකේ. මුහුණු වාර්තාවෙන් ඔබේ අගය නියම නොවේ.', signIn: 'ඉදිරියට යාමට නැවත පිවිසෙන්න.',
    feelings: { Happy: 'සතුටුයි', Sad: 'දුකයි', Angry: 'කෝපයි', Anxious: 'කනස්සල්ලෙන්', Neutral: 'සාමාන්‍යයි' },
    quality: { blur: 'බොඳ වීම', underExposure: 'ආලෝකය අඩු වීම' }, pose: { roll: 'පැත්තට ඇලවීම', pan: 'දෙපසට හැරීම', tilt: 'ඉහළ පහළ ඇලවීම' },
    signals: { joy: 'සතුටේ සංඥාව', sorrow: 'දුකේ සංඥාව', anger: 'කෝපයේ සංඥාව', surprise: 'විස්මයේ සංඥාව' },
    likelihood: { UNKNOWN: 'නොදනී', VERY_UNLIKELY: 'ඉතා අඩු ඉඩක් ඇත', UNLIKELY: 'අඩු ඉඩක් ඇත', POSSIBLE: 'ඉඩක් ඇත', LIKELY: 'වැඩි ඉඩක් ඇත', VERY_LIKELY: 'ඉතා වැඩි ඉඩක් ඇත' },
    issues: {
      no_face: 'මුහුණක් හඳුනා ගත්තේ නැත. මුහුණු පැහැදිලිව පෙනෙන ඡායාරූපයක් භාවිත කරන්න.', multiple_faces: 'මුහුණු කිහිපයක් හඳුනාගෙන ඇත. සෑම මුහුණක්ම වෙන වෙනම විශ්ලේෂණය කරයි; තනි පුද්ගල පරීක්ෂාවකට එක් මුහුණක් තෝරන්න.',
      low_confidence: 'හඳුනාගැනීමේ විශ්වාසය අඩුයි. වඩා පැහැදිලි ඡායාරූපයක් උත්සාහ කරන්න.', blurred: 'ඡායාරූපය බොඳ වී තිබිය හැක. කැමරාව නොසොල්වා තබන්න.',
      dark: 'මුහුණට ආලෝකය අඩු විය හැක. සමාන ආලෝකයක් භාවිත කරන්න.', angled: 'මුහුණ වැඩිපුර හැරී ඇත. කැමරාව දෙස වඩා කෙළින් බලන්න.',
      small_face: 'ඡායාරූපයේ මුහුණ කුඩායි. ළඟට එන්න හෝ ළඟින් ගත් ඡායාරූපයක් තෝරන්න.',
    },
    errors: {
      FACE_NOT_CONFIGURED: 'මුහුණු විශ්ලේෂණය සකසා නැත. Google Cloud Vision සක්‍රිය කිරීමට ව්‍යාපෘති හිමිකරුට කියන්න.',
      FACE_UNAVAILABLE: 'මුහුණු විශ්ලේෂණය දැනට ලබා ගත නොහැක. පසුව නැවත උත්සාහ කරන්න.', INVALID_IMAGE: 'ඡායාරූපය කියවිය නොහැකි විය. පැහැදිලි JPEG හෝ PNG ඡායාරූපයක් තෝරන්න.',
      INVALID_REPORT: 'සේවාව වලංගු නොවන ඡායාරූප වාර්තාවක් ලබා දුන්නේය. නැවත උත්සාහ කරන්න.', IMAGE_TOO_LARGE: 'මේ ඡායාරූපය විශාල වැඩියි. කුඩා ඡායාරූපයක් තෝරන්න.',
      camera: 'කැමරාව ආරම්භ කළ නොහැකි විය. අවසර පරීක්ෂා කරන්න හෝ ඡායාරූපයක් තෝරන්න.', save: 'ඔබේ සුවතා සටහන සුරැකුණු බව තහවුරු කළ නොහැක. නැවත උත්සාහ කරන්න.',
      session: 'ඉදිරියට යාමට නැවත පිවිසෙන්න.', share: 'වාර්තාව බෙදා ගැනීමට නොහැකි විය. නැවත උත්සාහ කරන්න.',
      timeout: 'විශ්ලේෂණයට වැඩි වේලාවක් ගත විය. නැවත උත්සාහ කරන්න.', rateLimit: 'ඉල්ලීම් වැඩියි. මඳක් රැඳී නැවත උත්සාහ කරන්න.',
      permission: 'මේ ක්‍රියාව සඳහා ඔබට අවසර නැත.', network: 'සම්බන්ධතාව පරීක්ෂා කර නැවත උත්සාහ කරන්න.', score: '0 සිට 100 දක්වා පූර්ණ අංක සුවතා අගයක් තෝරන්න.',
    },
  },
};

function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}
for (const locale of Object.values(copy)) {
  Object.assign(locale.errors, {
    unavailable: locale.errors.FACE_UNAVAILABLE, invalidReport: locale.errors.INVALID_REPORT,
    tooLarge: locale.errors.IMAGE_TOO_LARGE, invalidImage: locale.errors.INVALID_IMAGE,
    cameraError: locale.errors.camera, authError: locale.errors.session, saveError: locale.errors.save, shareError: locale.errors.share,
  });
  // Stable aliases support both screen conventions without duplicating translations.
  Object.assign(locale, {
    faceCount: locale.faces, reportReady: locale.ready, reportRetake: locale.retakeNeeded,
    qualityLabel: locale.qualityTitle, qualityTitle: locale.qualityTitle, poseLabel: locale.poseTitle,
    signalsLabel: locale.signalsTitle, issuesLabel: locale.issuesTitle, likelihoodLabel: locale.likelihoodTitle,
    imageDimensions: locale.imageSize, confidenceNotice: locale.confidenceHelp,
    blur: locale.quality.blur, underExposure: locale.quality.underExposure,
    processing: locale.analyzing, cameraError: locale.errors.camera, uploadError: locale.errors.INVALID_IMAGE,
    invalidReport: locale.errors.INVALID_REPORT, analysisUnavailable: locale.unavailable,
    requestTimedOut: locale.errors.timeout, rateLimited: locale.errors.rateLimit,
    permissionDenied: locale.errors.permission, networkError: locale.errors.network, reportShareFailed: locale.errors.share,
    selfReport: locale.selfReportTitle, selfReportNotice: locale.selfReportHelp, feelingLabel: locale.feeling,
    scoreLabel: locale.score, noteLabel: locale.note, medicineLabel: locale.medicine, medicineOptional: locale.medicine,
    saveFailed: locale.errors.save, consentNotice: locale.consent,
  });
  freeze(locale);
}
freeze(copy);

export function getFaceCopy(language = 'en') {
  const code = typeof language === 'string' ? language.trim().toLowerCase().split('-')[0] : 'en';
  return Object.prototype.hasOwnProperty.call(copy, code) ? copy[code] : copy.en;
}

export function buildFaceReportText(input, language = 'en') {
  const report = validateFaceReport(input);
  const labels = getFaceCopy(language);
  const percent = value => (value * 100).toFixed(1) + '%';
  const angle = value => value === null ? labels.unknown : value.toFixed(1) + '°';
  const lines = [labels.report, report.status === 'ready' ? labels.ready : labels.retakeNeeded,
    labels.provider + ': Google Cloud Vision', labels.analyzedAt + ': ' + report.analyzedAt,
    labels.imageSize + ': ' + report.image.width + ' × ' + report.image.height + ' ' + labels.pixels,
    labels.faces + ': ' + report.faceCount];
  for (const [index, face] of report.faces.entries()) {
    lines.push('', labels.face + ' ' + (index + 1), labels.confidence + ': ' + percent(face.confidence),
      labels.landmarkConfidence + ': ' + (face.landmarkConfidence === null ? labels.unknown : percent(face.landmarkConfidence)),
      labels.box + ': ' + [labels.left + ' ' + percent(face.box.x), labels.top + ' ' + percent(face.box.y), labels.width + ' ' + percent(face.box.width), labels.height + ' ' + percent(face.box.height)].join(', '),
      labels.poseTitle + ': ' + Object.entries(face.pose).map(([key, value]) => labels.pose[key] + ' ' + angle(value)).join(', '),
      labels.qualityTitle + ':');
    for (const [key, value] of Object.entries(face.quality)) lines.push('  ' + labels.quality[key] + ': ' + labels.likelihood[value]);
    lines.push(labels.signalsTitle + ':');
    for (const [key, value] of Object.entries(face.signals)) lines.push('  ' + labels.signals[key] + ': ' + labels.likelihood[value]);
  }
  if (!report.faces.length) lines.push('', labels.noFaces);
  lines.push('', labels.issuesTitle + ':');
  if (report.issues.length) for (const issue of report.issues) lines.push('• ' + labels.issues[issue]);
  else lines.push(labels.none);
  lines.push('', labels.confidenceHelp, labels.signalsHelp, labels.limitations, labels.privacyNotice);
  return lines.join('\n');
}
