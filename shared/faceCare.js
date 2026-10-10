// Manual patient/observer reports only. This module accepts no camera or expression input.
// Guidance: AHA first aid + stroke warning signs; local ambulance contact: 1990 Suwa Seriya.
export const URGENT_SYMPTOM_KEYS = Object.freeze([
  'chestPain', 'breathingDifficulty', 'faceDrooping', 'armOrSpeechDifficulty', 'collapse',
]);
export const URGENT_HELP_NOTE_MAX_LENGTH = 1000;
export const URGENT_HELP_MESSAGE_MAX_LENGTH = 4999;
export const SRI_LANKA_AMBULANCE_NUMBER = '1990';
export const SRI_LANKA_AMBULANCE_TEL = 'tel:1990';
export const FACE_CARE_SOURCES = Object.freeze([
  Object.freeze({ title: 'American Heart Association: first aid', url: 'https://cpr.heart.org/en/resuscitation-science/first-aid-guidelines/first-aid' }),
  Object.freeze({ title: 'American Stroke Association: stroke warning signs', url: 'https://www.stroke.org/en/about-stroke/stroke-symptoms' }),
  Object.freeze({ title: '1990 Suwa Seriya: emergency ambulance information', url: 'https://www.1990.lk/faq/' }),
]);

const copy = {
  en: {
    title: 'Request urgent help',
    description: 'Choose symptoms you or an observer noticed, or request help without selecting one. This list does not cover every emergency.',
    notDiagnosis: 'Camera results cannot confirm or rule out an emergency. These symptoms must be reported by you or an observer.',
    symptomHeading: 'What have you or an observer noticed?',
    symptoms: {
      chestPain: 'Chest pain or pressure',
      breathingDifficulty: 'Severe difficulty breathing',
      faceDrooping: 'Sudden drooping on one side of the face',
      armOrSpeechDifficulty: 'Sudden arm weakness or difficulty speaking',
      collapse: 'Collapse or not responding',
    },
    optionalNote: 'Additional information (optional)',
    notePlaceholder: 'Describe what happened and when it started.',
    action: 'Request help from care team',
    confirmationTitle: 'Send this request?',
    confirmationMessage: 'This saves your report for your care team. It does not call an ambulance or confirm that anyone has seen it. For immediate help in Sri Lanka, call 1990 now.',
    confirmSend: 'Send request', cancel: 'Cancel',
    cancelPending: 'Stop waiting (the request may already be saved)',
    call1990: 'Call 1990',
    callHelp: 'For immediate help in Sri Lanka, call 1990 now. Do not wait for an app response.',
    callFailed: 'The phone dialer could not open. Dial 1990 directly for immediate help in Sri Lanka.',
    sending: 'Saving your request…',
    savedTitle: 'Request saved',
    savedMessage: 'Your request was saved for your care team. This does not confirm that anyone has seen it. For immediate help in Sri Lanka, call 1990.',
    alreadyResolved: 'This earlier request is marked resolved. If you still need help, start a new request or call 1990 for immediate help.',
    resolvedTitle: 'Earlier request is resolved',
    resolvedMessage: 'This saved request is already marked resolved. This does not confirm your current condition. If you need help again, start a new request or call 1990 for immediate help in Sri Lanka.',
    newRequest: 'Start a new request',
    failedTitle: 'Request not confirmed',
    failedMessage: 'We could not confirm that your request was saved. Retry this request, or call 1990 for immediate help in Sri Lanka.',
    retry: 'Retry request',
    signInRequired: 'Sign in to send a request to your care team. You can call 1990 for immediate help in Sri Lanka.',
    chooseSymptomsOptional: 'Selecting symptoms is optional. You can ask for help even if none of these apply.',
    privacy: 'Only your selected symptoms and written note are sent. No camera image or expression result is included.',
    sourcesLabel: 'First aid and emergency contact information',
    sourceTitles: ['American Heart Association: first aid', 'American Stroke Association: stroke warning signs', '1990 Suwa Seriya: emergency ambulance information'],
    reportSource: 'Patient/observer-reported; not a facial diagnosis',
    reportedSymptoms: 'Reported symptoms',
    noSymptomsSelected: 'No symptoms selected; help requested explicitly',
    reportNote: 'Patient/observer note',
  },
  ta: {
    title: 'அவசர உதவி கோரவும்',
    description: 'நீங்கள் அல்லது அருகிலுள்ளவர் கவனித்த அறிகுறிகளைத் தேர்ந்தெடுக்கவும். எதையும் தேர்ந்தெடுக்காமலும் உதவி கோரலாம். எல்லா அவசர நிலைகளும் இந்தப் பட்டியலில் இல்லை.',
    notDiagnosis: 'கேமரா முடிவுகள் அவசர நிலையை உறுதிப்படுத்தவோ நிராகரிக்கவோ முடியாது. இந்த அறிகுறிகளை நீங்கள் அல்லது அருகிலுள்ளவர் தெரிவிக்க வேண்டும்.',
    symptomHeading: 'நீங்கள் அல்லது அருகிலுள்ளவர் என்ன கவனித்தீர்கள்?',
    symptoms: {
      chestPain: 'மார்பு வலி அல்லது அழுத்தம்',
      breathingDifficulty: 'கடுமையான மூச்சுத்திணறல்',
      faceDrooping: 'முகத்தின் ஒரு பக்கம் திடீரெனத் தொங்குதல்',
      armOrSpeechDifficulty: 'திடீர் கை பலவீனம் அல்லது பேசுவதில் சிரமம்',
      collapse: 'மயங்கி விழுதல் அல்லது பதிலளிக்காமல் இருத்தல்',
    },
    optionalNote: 'கூடுதல் தகவல் (விருப்பத்திற்குரியது)',
    notePlaceholder: 'என்ன நடந்தது, எப்போது தொடங்கியது என்பதை எழுதவும்.',
    action: 'பராமரிப்புக் குழுவிடம் உதவி கோரவும்',
    confirmationTitle: 'இந்தக் கோரிக்கையை அனுப்பவா?',
    confirmationMessage: 'உங்கள் தகவல் பராமரிப்புக் குழுவுக்காகச் சேமிக்கப்படும். இது ஆம்புலன்ஸை அழைக்காது; யாராவது பார்த்ததை உறுதிப்படுத்தாது. இலங்கையில் உடனடி உதவிக்கு இப்போதே 1990 ஐ அழைக்கவும்.',
    confirmSend: 'கோரிக்கையை அனுப்பவும்', cancel: 'ரத்து செய்யவும்',
    cancelPending: 'காத்திருப்பதை நிறுத்தவும் (கோரிக்கை ஏற்கனவே சேமிக்கப்பட்டிருக்கலாம்)',
    call1990: '1990 ஐ அழைக்கவும்',
    callHelp: 'இலங்கையில் உடனடி உதவிக்கு இப்போதே 1990 ஐ அழைக்கவும். செயலியின் பதிலுக்காகக் காத்திருக்க வேண்டாம்.',
    callFailed: 'தொலைபேசி அழைப்புத் திரையைத் திறக்க முடியவில்லை. இலங்கையில் உடனடி உதவிக்கு நேரடியாக 1990 ஐ அழைக்கவும்.',
    sending: 'கோரிக்கை சேமிக்கப்படுகிறது…',
    savedTitle: 'கோரிக்கை சேமிக்கப்பட்டது',
    savedMessage: 'உங்கள் கோரிக்கை பராமரிப்புக் குழுவுக்காகச் சேமிக்கப்பட்டது. யாராவது பார்த்ததை இது உறுதிப்படுத்தாது. இலங்கையில் உடனடி உதவிக்கு 1990 ஐ அழைக்கவும்.',
    alreadyResolved: 'இந்த முந்தைய கோரிக்கை முடிக்கப்பட்டதாகக் குறிக்கப்பட்டுள்ளது. இன்னும் உதவி தேவைப்பட்டால் புதிய கோரிக்கையைத் தொடங்கவும் அல்லது உடனடி உதவிக்கு 1990 ஐ அழைக்கவும்.',
    resolvedTitle: 'முந்தைய கோரிக்கை முடிக்கப்பட்டுள்ளது',
    resolvedMessage: 'சேமிக்கப்பட்ட இந்தக் கோரிக்கை ஏற்கனவே முடிக்கப்பட்டதாகக் குறிக்கப்பட்டுள்ளது. இது உங்கள் தற்போதைய நிலையை உறுதிப்படுத்தாது. மீண்டும் உதவி தேவைப்பட்டால் புதிய கோரிக்கையைத் தொடங்கவும் அல்லது இலங்கையில் உடனடி உதவிக்கு 1990 ஐ அழைக்கவும்.',
    newRequest: 'புதிய கோரிக்கையைத் தொடங்கவும்',
    failedTitle: 'கோரிக்கை உறுதிப்படுத்தப்படவில்லை',
    failedMessage: 'கோரிக்கை சேமிக்கப்பட்டதை உறுதிப்படுத்த முடியவில்லை. இதே கோரிக்கையை மீண்டும் முயற்சிக்கவும் அல்லது இலங்கையில் உடனடி உதவிக்கு 1990 ஐ அழைக்கவும்.',
    retry: 'மீண்டும் முயற்சிக்கவும்',
    signInRequired: 'பராமரிப்புக் குழுவுக்குக் கோரிக்கையை அனுப்ப உள்நுழையவும். இலங்கையில் உடனடி உதவிக்கு 1990 ஐ அழைக்கலாம்.',
    chooseSymptomsOptional: 'அறிகுறிகளைத் தேர்ந்தெடுப்பது கட்டாயமில்லை. இவற்றில் எதுவும் பொருந்தாவிட்டாலும் உதவி கேட்கலாம்.',
    privacy: 'தேர்ந்தெடுத்த அறிகுறிகளும் எழுதிய குறிப்பும் மட்டுமே அனுப்பப்படும். கேமரா படமோ முகபாவனை முடிவோ சேர்க்கப்படாது.',
    sourcesLabel: 'முதலுதவி மற்றும் அவசரத் தொடர்புத் தகவல்',
    sourceTitles: ['அமெரிக்க இதய சங்கம்: முதலுதவி', 'அமெரிக்க பக்கவாத சங்கம்: பக்கவாத எச்சரிக்கை அறிகுறிகள்', '1990 சுவசெரிய: அவசர ஆம்புலன்ஸ் தகவல்'],
    reportSource: 'நோயாளி அல்லது அருகிலுள்ளவர் தெரிவித்தது; முகத்திலிருந்து கண்டறிந்த நோயறிதல் அல்ல',
    reportedSymptoms: 'தெரிவிக்கப்பட்ட அறிகுறிகள்',
    noSymptomsSelected: 'அறிகுறிகள் தேர்ந்தெடுக்கப்படவில்லை; உதவி நேரடியாகக் கோரப்பட்டுள்ளது',
    reportNote: 'நோயாளி அல்லது அருகிலுள்ளவரின் குறிப்பு',
  },
  si: {
    title: 'හදිසි උපකාර ඉල්ලන්න',
    description: 'ඔබ හෝ ඔබ අසල සිටින අයෙකු දුටු ලක්ෂණ තෝරන්න. කිසිවක් තෝරා නොගෙනත් උපකාර ඉල්ලිය හැක. සියලු හදිසි අවස්ථා මෙම ලැයිස්තුවේ නැත.',
    notDiagnosis: 'කැමරා ප්‍රතිඵලවලින් හදිසි අවස්ථාවක් තහවුරු කිරීමට හෝ බැහැර කිරීමට නොහැක. මෙම ලක්ෂණ ඔබ හෝ ඔබ අසල සිටින අයෙකු වාර්තා කළ යුතුය.',
    symptomHeading: 'ඔබ හෝ ඔබ අසල සිටින අයෙකු දුටුවේ කුමක්ද?',
    symptoms: {
      chestPain: 'පපුවේ වේදනාව හෝ තදවීම',
      breathingDifficulty: 'හුස්ම ගැනීමට දැඩි අපහසුතාව',
      faceDrooping: 'මුහුණේ එක් පැත්තක් හදිසියේ එල්ලා වැටීම',
      armOrSpeechDifficulty: 'අතක හදිසි දුර්වලතාව හෝ කතා කිරීමට අපහසුතාව',
      collapse: 'ඇද වැටීම හෝ ප්‍රතිචාර නොදැක්වීම',
    },
    optionalNote: 'අමතර තොරතුරු (අවශ්‍ය නම්)',
    notePlaceholder: 'සිදුවූ දේ සහ එය ආරම්භ වූ වේලාව ලියන්න.',
    action: 'සත්කාර කණ්ඩායමෙන් උපකාර ඉල්ලන්න',
    confirmationTitle: 'මෙම ඉල්ලීම යවන්නද?',
    confirmationMessage: 'ඔබේ වාර්තාව සත්කාර කණ්ඩායම සඳහා සුරකිනු ඇත. මෙය ගිලන් රථයක් අමතන්නේ නැත; කිසිවෙකු එය දුටු බව තහවුරු නොකරයි. ශ්‍රී ලංකාවේ වහාම උපකාර සඳහා දැන් 1990 අමතන්න.',
    confirmSend: 'ඉල්ලීම යවන්න', cancel: 'අවලංගු කරන්න',
    cancelPending: 'බලා සිටීම නවත්වන්න (ඉල්ලීම දැනටමත් සුරැකී තිබිය හැක)',
    call1990: '1990 අමතන්න',
    callHelp: 'ශ්‍රී ලංකාවේ වහාම උපකාර සඳහා දැන් 1990 අමතන්න. යෙදුමේ පිළිතුරක් සඳහා බලා නොසිටින්න.',
    callFailed: 'දුරකථන ඇමතුම් තිරය විවෘත කළ නොහැකි විය. ශ්‍රී ලංකාවේ වහාම උපකාර සඳහා කෙළින්ම 1990 අමතන්න.',
    sending: 'ඉල්ලීම සුරකිමින්…',
    savedTitle: 'ඉල්ලීම සුරැකිණි',
    savedMessage: 'ඔබේ ඉල්ලීම සත්කාර කණ්ඩායම සඳහා සුරැකිණි. කිසිවෙකු එය දුටු බව මෙයින් තහවුරු නොවේ. ශ්‍රී ලංකාවේ වහාම උපකාර සඳහා 1990 අමතන්න.',
    alreadyResolved: 'මෙම පෙර ඉල්ලීම විසඳූ බව සලකුණු කර ඇත. තවමත් උපකාර අවශ්‍ය නම් නව ඉල්ලීමක් අරඹන්න හෝ වහාම උපකාර සඳහා 1990 අමතන්න.',
    resolvedTitle: 'පෙර ඉල්ලීම විසඳා ඇත',
    resolvedMessage: 'මෙම සුරැකි ඉල්ලීම දැනටමත් විසඳූ බව සලකුණු කර ඇත. මෙය ඔබේ වත්මන් තත්ත්වය තහවුරු නොකරයි. නැවත උපකාර අවශ්‍ය නම් නව ඉල්ලීමක් අරඹන්න හෝ ශ්‍රී ලංකාවේ වහාම උපකාර සඳහා 1990 අමතන්න.',
    newRequest: 'නව ඉල්ලීමක් අරඹන්න',
    failedTitle: 'ඉල්ලීම තහවුරු නොවිණි',
    failedMessage: 'ඉල්ලීම සුරැකි බව තහවුරු කළ නොහැකි විය. මෙම ඉල්ලීම නැවත උත්සාහ කරන්න හෝ ශ්‍රී ලංකාවේ වහාම උපකාර සඳහා 1990 අමතන්න.',
    retry: 'නැවත උත්සාහ කරන්න',
    signInRequired: 'සත්කාර කණ්ඩායමට ඉල්ලීමක් යැවීමට පිවිසෙන්න. ශ්‍රී ලංකාවේ වහාම උපකාර සඳහා 1990 අමතන්න.',
    chooseSymptomsOptional: 'ලක්ෂණ තේරීම අනිවාර්ය නැත. මේ කිසිවක් අදාළ නොවුණත් උපකාර ඉල්ලිය හැක.',
    privacy: 'යවන්නේ තෝරාගත් ලක්ෂණ සහ ඔබ ලියූ සටහන පමණි. කැමරා රූපයක් හෝ මුහුණේ ඉරියව් ප්‍රතිඵලයක් ඇතුළත් නොවේ.',
    sourcesLabel: 'ප්‍රථමාධාර සහ හදිසි සම්බන්ධතා තොරතුරු',
    sourceTitles: ['ඇමරිකානු හෘද සංගමය: ප්‍රථමාධාර', 'ඇමරිකානු ආඝාත සංගමය: ආඝාත අනතුරු ලක්ෂණ', '1990 සුව සැරිය: හදිසි ගිලන්රථ තොරතුරු'],
    reportSource: 'රෝගියා හෝ අසල සිටින අයෙකු වාර්තා කළ දේ; මුහුණෙන් කළ රෝග විනිශ්චයක් නොවේ',
    reportedSymptoms: 'වාර්තා කළ ලක්ෂණ',
    noSymptomsSelected: 'ලක්ෂණ තෝරා නැත; උපකාර පැහැදිලිව ඉල්ලා ඇත',
    reportNote: 'රෝගියාගේ හෝ අසල සිටින අයෙකුගේ සටහන',
  },
};
for (const value of Object.values(copy)) { Object.freeze(value.symptoms); Object.freeze(value.sourceTitles); Object.freeze(value); }
Object.freeze(copy);
function languageKey(language) {
  if (typeof language !== 'string') return 'en';
  const key = language.trim().toLowerCase().split(/[-_]/)[0];
  return key === 'ta' || key === 'si' ? key : 'en';
}
export function getFaceCareCopy(language = 'en') { return copy[languageKey(language)]; }

/** Deterministic text for a manually confirmed request; does not send or assess anything. */
export function buildUrgentHelpMessage(symptomKeys, language = 'en', note = '') {
  if (!Array.isArray(symptomKeys) || symptomKeys.length > 32 ||
      Array.from(symptomKeys).some(key => typeof key !== 'string' || !URGENT_SYMPTOM_KEYS.includes(key))) {
    throw new TypeError('Choose only supported patient/observer-reported symptoms.');
  }
  if (typeof note !== 'string') throw new TypeError('The additional information must be text.');
  if (note.length > URGENT_HELP_NOTE_MAX_LENGTH) throw new RangeError('Additional information is limited to 1000 characters.');
  // Remove invisible controls that could spoof the fixed source label. Preserve normal paragraphs.
  const cleanNote = note.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, '').trim();
  const selected = URGENT_SYMPTOM_KEYS.filter(key => symptomKeys.includes(key));
  const english = copy.en;
  const lines = ['Urgent help requested.', 'Source: ' + english.reportSource + '.',
    english.reportedSymptoms + ': ' + (selected.length ? selected.map(key => english.symptoms[key]).join('; ') : english.noSymptomsSelected) + '.'];
  const translated = getFaceCareCopy(language);
  if (translated !== english) {
    lines.push(translated.title + '.', translated.reportSource + '.',
      translated.reportedSymptoms + ': ' + (selected.length ? selected.map(key => translated.symptoms[key]).join('; ') : translated.noSymptomsSelected) + '.');
  }
  if (cleanNote) lines.push(english.reportNote + ': ' + cleanNote);
  const message = lines.join('\n');
  if (message.length > URGENT_HELP_MESSAGE_MAX_LENGTH) throw new RangeError('The urgent help message is too long.');
  return message;
}
