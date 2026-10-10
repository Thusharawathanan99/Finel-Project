// Explicit patient/observer reports only; camera/model output cannot select symptoms.
// Guidance checked 2026-10-08: AHA, ASA, NHS and Sri Lanka's 1990 service.
import { URGENT_HELP_NOTE_MAX_LENGTH, URGENT_HELP_MESSAGE_MAX_LENGTH } from './faceCare.js';

export const PATIENT_SYMPTOM_SOURCES = Object.freeze([
  'https://www.heart.org/en/health-topics/heart-attack/warning-signs-of-a-heart-attack',
  'https://www.stroke.org/en/about-stroke/stroke-symptoms',
  'https://www.nhs.uk/conditions/heart-attack/',
  'https://www.nhs.uk/conditions/stroke/symptoms/',
  'https://www.1990.lk/faq/',
]);
const rows = [
  ['chestPain', 'heart-outline', 'Chest pain or pressure', 'மார்பு வலி அல்லது அழுத்தம்', 'පපුවේ වේදනාව හෝ තදවීම'],
  ['breathingDifficulty', 'lungs', 'Difficulty breathing', 'மூச்சு விடுவதில் சிரமம்', 'හුස්ම ගැනීමට අපහසුතාව'],
  ['coldSweat', 'water-outline', 'Sudden cold sweating', 'திடீரெனக் குளிர்ந்த வியர்வை', 'හදිසියේ සීතල දහඩිය දැමීම'],
  ['dizziness', 'head-sync-outline', 'Sudden dizziness or loss of balance', 'திடீர் தலைசுற்றல் அல்லது சமநிலை இழப்பு', 'හදිසි කරකැවිල්ල හෝ සමබරතාව නැතිවීම'],
  ['fainting', 'account-alert-outline', 'Fainting or nearly fainting', 'மயக்கம் அல்லது மயங்கி விழுவது போன்ற உணர்வு', 'සිහි නැතිවීම හෝ ඒ ආසන්න හැඟීම'],
  ['unusualWeakness', 'human-handsdown', 'Sudden unusual weakness', 'திடீரென வழக்கத்திற்கு மாறான பலவீனம்', 'හදිසි අසාමාන්‍ය දුර්වලතාව'],
  ['radiatingPain', 'human', 'Pain spreading to the arm, back, neck or jaw', 'கை, முதுகு, கழுத்து அல்லது தாடைக்குப் பரவும் வலி', 'අතට, පිටට, බෙල්ලට හෝ හනුවට පැතිරෙන වේදනාව'],
  ['severeDiscomfort', 'alert-circle-outline', 'Sudden severe discomfort', 'திடீரெனக் கடுமையான அசௌகரியம்', 'හදිසි දැඩි අපහසුතාව'],
  ['faceDrooping', 'face-man-outline', 'Sudden drooping on one side of the face', 'முகத்தின் ஒரு பக்கம் திடீரெனத் தொங்குதல்', 'මුහුණේ එක් පැත්තක් හදිසියේ එල්ලා වැටීම'],
  ['armWeakness', 'arm-flex-outline', 'Sudden arm weakness or numbness', 'திடீர் கை பலவீனம் அல்லது உணர்வின்மை', 'අතක හදිසි දුර්වලතාව හෝ හිරිවැටීම'],
  ['speechDifficulty', 'account-voice', 'Sudden trouble speaking or understanding speech', 'திடீரெனப் பேசுவதில் அல்லது பேச்சைப் புரிந்துகொள்வதில் சிரமம்', 'හදිසියේ කතා කිරීමට හෝ කථාව තේරුම් ගැනීමට අපහසුතාව'],
  ['visionChanges', 'eye-outline', 'Sudden vision changes', 'திடீர் பார்வை மாற்றங்கள்', 'හදිසි පෙනීමේ වෙනස්කම්'],
  ['severeHeadache', 'head-alert-outline', 'Sudden severe unexplained headache', 'காரணம் தெரியாத திடீர் கடுமையான தலைவலி', 'පැහැදිලි හේතුවක් නැති හදිසි දැඩි හිසරදය'],
  ['collapse', 'account-alert-outline', 'Collapse or not responding', 'மயங்கி விழுதல் அல்லது பதிலளிக்காமல் இருத்தல்', 'ඇද වැටීම හෝ ප්‍රතිචාර නොදැක්වීම'],
];
export const PATIENT_SYMPTOMS = Object.freeze(rows.map(([key, icon, en, ta, si]) =>
  Object.freeze({ key, icon, labels: Object.freeze({ en, ta, si }) })));
export const PATIENT_SYMPTOM_KEYS = Object.freeze(PATIENT_SYMPTOMS.map(item => item.key));
export const PATIENT_SYMPTOM_NOTE_MAX_LENGTH = URGENT_HELP_NOTE_MAX_LENGTH;
const copy = {
  en: {
    title: 'How are you feeling?', subtitle: 'Patient or observer check-in',
    description: 'Select any new symptoms you or someone beside you noticed. This list does not cover every emergency.',
    source: 'Patient/observer-reported symptoms',
    notDiagnosis: 'These are your reports, not camera findings. A normal expression cannot rule out an emergency.',
    urgentTitle: 'Urgent medical assistance may be needed',
    guidance: 'Call 1990 now for emergency ambulance assistance in Sri Lanka. Do not wait for the camera, an AI result or an app response. Tell someone nearby what is happening.',
    noSelection: 'No symptoms selected. This does not mean that an emergency has been ruled out. You can still ask for help.',
    action: 'Ask the assigned care team for help', retry: 'Retry the same help request',
    sending: 'Saving your help request…', savedTitle: 'Help request saved',
    savedMessage: 'Saved for your authorized care team. This does not confirm delivery, that anyone has read it, or that help is on the way. Call 1990 if help is urgent.',
    duplicate: 'The same request was already saved; no duplicate request was created.',
    resolvedTitle: 'Earlier request marked resolved',
    resolvedMessage: 'Your earlier request is marked resolved. This does not confirm your current condition. Start a new request or call 1990 if you still need help.',
    failedTitle: 'Help request not confirmed',
    failedMessage: 'We could not confirm that your request was saved. Retry the same request, or call 1990 directly. Your local emergency guidance is still available.',
    authRequired: 'Sign in to send a care-team request. Emergency guidance and calling 1990 remain available.',
    call: 'Call 1990', callFailed: 'The phone dialer could not open. Dial 1990 directly.',
    note: 'What happened and when? (optional)', notePlaceholder: 'Add details that may help your care team.',
    share: 'Share symptom report', shareFailed: 'The report could not be shared. Try again.',
    reset: 'Clear this check-in', newRequest: 'Start a new request',
    cancelPending: 'Stop waiting (this request may already be saved)',
    privacy: 'Only the symptoms you select and your note are sent. No camera image, expression score or diagnosis is included.',
    reportTitle: 'CareConnect — patient symptom report', reportTime: 'Reported at',
    reportSymptoms: 'Selected symptoms', reportNote: 'Patient/observer note',
    reportGuidance: 'Local emergency guidance', status: 'Help request status',
    savedStatus: 'Saved; delivery and acknowledgement not confirmed', notSentStatus: 'Not confirmed as saved',
  },
  ta: {
    title: 'இப்போது எப்படி உணர்கிறீர்கள்?', subtitle: 'நோயாளி அல்லது அருகிலுள்ளவரின் தகவல்',
    description: 'நீங்கள் அல்லது அருகிலுள்ளவர் கவனித்த புதிய அறிகுறிகளைத் தேர்ந்தெடுக்கவும். எல்லா அவசர நிலைகளும் இந்தப் பட்டியலில் இல்லை.',
    source: 'நோயாளி அல்லது அருகிலுள்ளவர் தெரிவித்த அறிகுறிகள்',
    notDiagnosis: 'இவை நீங்கள் தெரிவித்த தகவல்கள்; கேமரா கண்டறிந்தவை அல்ல. இயல்பான முகபாவனை அவசர நிலையை நிராகரிக்க முடியாது.',
    urgentTitle: 'அவசர மருத்துவ உதவி தேவைப்படலாம்',
    guidance: 'இலங்கையில் அவசர ஆம்புலன்ஸ் உதவிக்கு இப்போதே 1990 ஐ அழைக்கவும். கேமரா, AI முடிவு அல்லது செயலியின் பதிலுக்காகக் காத்திருக்க வேண்டாம். என்ன நடக்கிறது என்பதை அருகிலுள்ளவரிடம் சொல்லவும்.',
    noSelection: 'அறிகுறிகள் தேர்ந்தெடுக்கப்படவில்லை. இதனால் அவசர நிலை நிராகரிக்கப்பட்டதாகாது. நீங்கள் இன்னும் உதவி கோரலாம்.',
    action: 'ஒதுக்கப்பட்ட பராமரிப்புக் குழுவிடம் உதவி கோரவும்', retry: 'இதே உதவிக் கோரிக்கையை மீண்டும் முயற்சிக்கவும்',
    sending: 'உதவிக் கோரிக்கை சேமிக்கப்படுகிறது…', savedTitle: 'உதவிக் கோரிக்கை சேமிக்கப்பட்டது',
    savedMessage: 'அங்கீகரிக்கப்பட்ட பராமரிப்புக் குழுவுக்காகச் சேமிக்கப்பட்டது. சென்றடைந்ததையோ யாராவது படித்ததையோ உதவி வந்துகொண்டிருப்பதையோ இது உறுதிப்படுத்தாது. அவசர உதவிக்கு 1990 ஐ அழைக்கவும்.',
    duplicate: 'இதே கோரிக்கை ஏற்கனவே சேமிக்கப்பட்டுள்ளது; நகல் கோரிக்கை உருவாக்கப்படவில்லை.',
    resolvedTitle: 'முந்தைய கோரிக்கை முடிக்கப்பட்டதாகக் குறிக்கப்பட்டுள்ளது',
    resolvedMessage: 'முந்தைய கோரிக்கை முடிக்கப்பட்டதாகக் குறிக்கப்பட்டுள்ளது. இது தற்போதைய நிலையை உறுதிப்படுத்தாது. இன்னும் உதவி தேவைப்பட்டால் புதிய கோரிக்கையைத் தொடங்கவும் அல்லது 1990 ஐ அழைக்கவும்.',
    failedTitle: 'உதவிக் கோரிக்கை உறுதிப்படுத்தப்படவில்லை',
    failedMessage: 'கோரிக்கை சேமிக்கப்பட்டதை உறுதிப்படுத்த முடியவில்லை. இதே கோரிக்கையை மீண்டும் முயற்சிக்கவும் அல்லது நேரடியாக 1990 ஐ அழைக்கவும். அவசர வழிகாட்டுதல் தொடர்ந்து கிடைக்கும்.',
    authRequired: 'பராமரிப்புக் குழுவுக்குக் கோரிக்கை அனுப்ப உள்நுழையவும். அவசர வழிகாட்டுதலும் 1990 அழைப்பும் தொடர்ந்து கிடைக்கும்.',
    call: '1990 ஐ அழைக்கவும்', callFailed: 'அழைப்புத் திரையைத் திறக்க முடியவில்லை. நேரடியாக 1990 ஐ அழைக்கவும்.',
    note: 'என்ன நடந்தது, எப்போது? (விருப்பத்திற்குரியது)', notePlaceholder: 'பராமரிப்புக் குழுவுக்கு உதவும் விவரங்களைச் சேர்க்கவும்.',
    share: 'அறிகுறி அறிக்கையைப் பகிரவும்', shareFailed: 'அறிக்கையைப் பகிர முடியவில்லை. மீண்டும் முயற்சிக்கவும்.',
    reset: 'இந்தத் தகவலை அழிக்கவும்', newRequest: 'புதிய கோரிக்கையைத் தொடங்கவும்',
    cancelPending: 'காத்திருப்பதை நிறுத்தவும் (கோரிக்கை ஏற்கனவே சேமிக்கப்பட்டிருக்கலாம்)',
    privacy: 'தேர்ந்தெடுத்த அறிகுறிகளும் உங்கள் குறிப்பும் மட்டுமே அனுப்பப்படும். கேமரா படம், முகபாவனை மதிப்பெண் அல்லது நோயறிதல் சேர்க்கப்படாது.',
    reportTitle: 'CareConnect — நோயாளியின் அறிகுறி அறிக்கை', reportTime: 'தெரிவித்த நேரம்',
    reportSymptoms: 'தேர்ந்தெடுத்த அறிகுறிகள்', reportNote: 'நோயாளி அல்லது அருகிலுள்ளவரின் குறிப்பு',
    reportGuidance: 'உள்ளூர் அவசர வழிகாட்டுதல்', status: 'உதவிக் கோரிக்கையின் நிலை',
    savedStatus: 'சேமிக்கப்பட்டது; சென்றடைந்ததும் ஏற்றுக்கொள்ளப்பட்டதும் உறுதிப்படுத்தப்படவில்லை', notSentStatus: 'சேமிக்கப்பட்டதாக உறுதிப்படுத்தப்படவில்லை',
  },
  si: {
    title: 'දැන් ඔබට දැනෙන්නේ කොහොමද?', subtitle: 'රෝගියා හෝ අසල සිටින අයෙකුගේ වාර්තාව',
    description: 'ඔබ හෝ අසල සිටින අයෙකු දුටු අලුත් ලක්ෂණ තෝරන්න. සියලු හදිසි අවස්ථා මෙම ලැයිස්තුවේ නැත.',
    source: 'රෝගියා හෝ අසල සිටින අයෙකු වාර්තා කළ ලක්ෂණ',
    notDiagnosis: 'මේ ඔබ වාර්තා කළ දේ මිස කැමරා සොයාගැනීම් නොවේ. සාමාන්‍ය මුහුණේ ඉරියව්වකින් හදිසි අවස්ථාවක් බැහැර කළ නොහැක.',
    urgentTitle: 'හදිසි වෛද්‍ය උපකාර අවශ්‍ය විය හැක',
    guidance: 'ශ්‍රී ලංකාවේ හදිසි ගිලන්රථ උපකාර සඳහා දැන් 1990 අමතන්න. කැමරාව, AI ප්‍රතිඵලයක් හෝ යෙදුමේ පිළිතුරක් සඳහා බලා නොසිටින්න. සිදුවන දේ අසල සිටින අයෙකුට කියන්න.',
    noSelection: 'ලක්ෂණ තෝරා නැත. මෙයින් හදිසි අවස්ථාවක් බැහැර කළ බවක් අදහස් නොවේ. ඔබට තවමත් උපකාර ඉල්ලිය හැක.',
    action: 'පවරා ඇති සත්කාර කණ්ඩායමෙන් උපකාර ඉල්ලන්න', retry: 'එම උපකාර ඉල්ලීම නැවත උත්සාහ කරන්න',
    sending: 'උපකාර ඉල්ලීම සුරකිමින්…', savedTitle: 'උපකාර ඉල්ලීම සුරැකිණි',
    savedMessage: 'ඔබට අවසර ලත් සත්කාර කණ්ඩායම සඳහා සුරැකිණි. ලැබුණු බව, කිසිවෙකු කියවූ බව හෝ උපකාර පැමිණෙන බව මෙයින් තහවුරු නොවේ. හදිසි උපකාර සඳහා 1990 අමතන්න.',
    duplicate: 'එම ඉල්ලීම දැනටමත් සුරැකී ඇත; අනුපිටපත් ඉල්ලීමක් සෑදී නැත.',
    resolvedTitle: 'පෙර ඉල්ලීම විසඳූ බව සලකුණු කර ඇත',
    resolvedMessage: 'පෙර ඉල්ලීම විසඳූ බව සලකුණු කර ඇත. මෙය වත්මන් තත්ත්වය තහවුරු නොකරයි. තවමත් උපකාර අවශ්‍ය නම් නව ඉල්ලීමක් අරඹන්න හෝ 1990 අමතන්න.',
    failedTitle: 'උපකාර ඉල්ලීම තහවුරු නොවිණි',
    failedMessage: 'ඉල්ලීම සුරැකි බව තහවුරු කළ නොහැකි විය. එම ඉල්ලීම නැවත උත්සාහ කරන්න හෝ කෙළින්ම 1990 අමතන්න. හදිසි උපදෙස් තවමත් ඇත.',
    authRequired: 'සත්කාර කණ්ඩායමට ඉල්ලීමක් යැවීමට පිවිසෙන්න. හදිසි උපදෙස් සහ 1990 ඇමතීම තවමත් භාවිත කළ හැක.',
    call: '1990 අමතන්න', callFailed: 'ඇමතුම් තිරය විවෘත කළ නොහැකි විය. කෙළින්ම 1990 අමතන්න.',
    note: 'සිදුවූයේ කුමක්ද, කවදාද? (අවශ්‍ය නම්)', notePlaceholder: 'සත්කාර කණ්ඩායමට උපකාරී වන විස්තර එක් කරන්න.',
    share: 'ලක්ෂණ වාර්තාව බෙදාගන්න', shareFailed: 'වාර්තාව බෙදාගත නොහැකි විය. නැවත උත්සාහ කරන්න.',
    reset: 'මෙම වාර්තාව මකන්න', newRequest: 'නව ඉල්ලීමක් අරඹන්න',
    cancelPending: 'බලා සිටීම නවත්වන්න (ඉල්ලීම දැනටමත් සුරැකී තිබිය හැක)',
    privacy: 'යවන්නේ තෝරාගත් ලක්ෂණ සහ ඔබේ සටහන පමණි. කැමරා රූපයක්, ඉරියව් ලකුණක් හෝ රෝග විනිශ්චයක් ඇතුළත් නොවේ.',
    reportTitle: 'CareConnect — රෝගියාගේ ලක්ෂණ වාර්තාව', reportTime: 'වාර්තා කළ වේලාව',
    reportSymptoms: 'තෝරාගත් ලක්ෂණ', reportNote: 'රෝගියාගේ හෝ අසල සිටින අයෙකුගේ සටහන',
    reportGuidance: 'දේශීය හදිසි උපදෙස්', status: 'උපකාර ඉල්ලීමේ තත්ත්වය',
    savedStatus: 'සුරැකී ඇත; ලැබීම සහ පිළිගැනීම තහවුරු කර නැත', notSentStatus: 'සුරැකි බව තහවුරු වී නැත',
  },
};
for (const language of Object.keys(copy)) {
  copy[language].symptoms = Object.freeze(Object.fromEntries(PATIENT_SYMPTOMS.map(item => [item.key, item.labels[language]])));
  Object.freeze(copy[language]);
}
Object.freeze(copy);
function languageKey(language) {
  const key = typeof language === 'string' ? language.trim().toLowerCase().split(/[-_]/)[0] : 'en';
  return key === 'ta' || key === 'si' ? key : 'en';
}
export function getPatientSymptomsCopy(language = 'en') { return copy[languageKey(language)]; }
export const getPatientSymptomCopy = getPatientSymptomsCopy;

export function normalizePatientSymptoms(keys) {
  if (!Array.isArray(keys) || keys.length > 32 || Array.from(keys).some(key => typeof key !== 'string' || !PATIENT_SYMPTOM_KEYS.includes(key))) {
    throw new TypeError('Choose only supported patient/observer-reported symptoms.');
  }
  return PATIENT_SYMPTOM_KEYS.filter(key => keys.includes(key));
}
function cleanNote(note) {
  if (typeof note !== 'string') throw new TypeError('The symptom note must be text.');
  if (note.length > PATIENT_SYMPTOM_NOTE_MAX_LENGTH) throw new RangeError('The symptom note is too long.');
  return note.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, '').trim();
}
export function evaluatePatientSymptoms(keys, language = 'en') {
  const symptomKeys = normalizePatientSymptoms(keys), translated = getPatientSymptomsCopy(language);
  return { source: 'patient-reported', symptomKeys, urgent: symptomKeys.length > 0,
    assistanceState: symptomKeys.length ? 'urgent-assistance' : 'no-symptoms-selected',
    guidance: symptomKeys.length ? translated.guidance : translated.noSelection,
    labels: symptomKeys.map(key => translated.symptoms[key]) };
}
export function buildPatientSymptomReport(keys, language = 'en', note = '', reportedAt = null, receipt = null) {
  const evaluation = evaluatePatientSymptoms(keys, language), translated = getPatientSymptomsCopy(language);
  const lines = [translated.reportTitle, translated.source, translated.notDiagnosis];
  if (reportedAt != null) {
    if (typeof reportedAt !== 'string' || !Number.isFinite(Date.parse(reportedAt))) throw new TypeError('The report time must be a valid timestamp.');
    // ISO time avoids incorrect timezone assumptions or locale support on older phones.
    lines.push(translated.reportTime + ': ' + new Date(reportedAt).toISOString());
  }
  lines.push(translated.reportSymptoms + ': ' + (evaluation.labels.length ? evaluation.labels.join('; ') : translated.noSelection));
  const cleaned = cleanNote(note);
  if (cleaned) lines.push(translated.reportNote + ': ' + cleaned);
  lines.push(translated.reportGuidance + ': ' + evaluation.guidance);
  const saved = receipt?.saved === true && Number.isSafeInteger(receipt.alertId) && receipt.alertId > 0;
  lines.push(translated.status + ': ' + (saved ? receipt.isResolved === true ? translated.resolvedMessage : translated.savedStatus : translated.notSentStatus));
  return lines.join('\n');
}
export function buildPatientSymptomHelpMessage(keys, language = 'en', note = '') {
  const symptomKeys = normalizePatientSymptoms(keys), translated = getPatientSymptomsCopy(language);
  const lines = ['Urgent help explicitly requested by patient/observer.', copy.en.source + '.',
    'Symptom codes: ' + (symptomKeys.join(',') || 'none-selected'),
    copy.en.reportSymptoms + ': ' + (symptomKeys.length ? symptomKeys.map(key => copy.en.symptoms[key]).join('; ') : copy.en.noSelection)];
  if (translated !== copy.en) lines.push(translated.source + '.', translated.reportSymptoms + ': ' +
    (symptomKeys.length ? symptomKeys.map(key => translated.symptoms[key]).join('; ') : translated.noSelection));
  const cleaned = cleanNote(note);
  if (cleaned) lines.push(copy.en.reportNote + ': ' + cleaned);
  const message = lines.join('\n');
  if (message.length > URGENT_HELP_MESSAGE_MAX_LENGTH) throw new RangeError('The symptom help message is too long.');
  return message;
}
