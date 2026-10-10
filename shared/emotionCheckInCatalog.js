// Patient-reported states only. These labels are not classifier outputs,
// diagnoses, confidence scores or automatic emergency classifications.
const categories = {
  positive: { en: 'Positive feelings', ta: 'நேர்மறை உணர்வுகள்', si: 'ධනාත්මක හැඟීම්' },
  calm: { en: 'Calm and comfort', ta: 'அமைதி மற்றும் ஆறுதல்', si: 'සන්සුන් බව සහ සුවපහසුව' },
  affection: { en: 'Affection and care', ta: 'அன்பு மற்றும் அக்கறை', si: 'සෙනෙහස සහ සැලකිල්ල' },
  attention: { en: 'Interest and attention', ta: 'ஆர்வம் மற்றும் கவனம்', si: 'උනන්දුව සහ අවධානය' },
  surprise: { en: 'Surprise', ta: 'ஆச்சரியம்', si: 'පුදුමය' },
  uncertainty: { en: 'Uncertainty and confusion', ta: 'நிச்சயமின்மை மற்றும் குழப்பம்', si: 'අවිනිශ්චිත බව සහ ව්‍යාකූල බව' },
  sadness: { en: 'Sadness and loss', ta: 'சோகம் மற்றும் இழப்பு', si: 'දුක සහ අහිමිවීම' },
  selfConscious: { en: 'Self-conscious feelings', ta: 'தன்னைப் பற்றிய சங்கட உணர்வுகள்', si: 'තමා ගැන ඇති ලැජ්ජා සහ අපහසු හැඟීම්' },
  anger: { en: 'Anger and frustration', ta: 'கோபம் மற்றும் விரக்தி', si: 'කෝපය සහ කලකිරීම' },
  disgust: { en: 'Disgust and aversion', ta: 'அருவருப்பு மற்றும் வெறுப்பு', si: 'පිළිකුල සහ අකමැත්ත' },
  fear: { en: 'Fear and anxiety', ta: 'பயம் மற்றும் பதட்டம்', si: 'බිය සහ කාංසාව' },
  tension: { en: 'Tension and discomfort', ta: 'பதற்றம் மற்றும் அசௌகரியம்', si: 'ආතතිය සහ අපහසුතාව' },
  energy: { en: 'Low energy', ta: 'குறைந்த ஆற்றல்', si: 'අඩු ශක්තිය' },
  neutral: { en: 'Neutral feeling', ta: 'நடுநிலை உணர்வு', si: 'මධ්‍යස්ථ හැඟීම' },
};

// Keep the user's numbered 100-state list in order; pain preserves existing
// check-ins. Related terms remain distinct choices rather than inferred aliases.
const rows = [
  ['happy', 'positive', '😊', 'Happy', 'மகிழ்ச்சி', 'සතුටු'],
  ['joyful', 'positive', '😄', 'Joyful', 'ஆனந்தம்', 'ප්‍රීතිමත්'],
  ['excited', 'positive', '🤩', 'Excited', 'உற்சாகம்', 'උද්යෝගිමත්'],
  ['cheerful', 'positive', '😁', 'Cheerful', 'கலகலப்பு', 'ප්‍රසන්න'],
  ['delighted', 'positive', '😃', 'Delighted', 'பெருமகிழ்ச்சி', 'ඉතා සතුටු'],
  ['amused', 'positive', '😆', 'Amused', 'வேடிக்கை உணர்வு', 'විනෝදයට පත්'],
  ['content', 'positive', '🙂', 'Content', 'மனநிறைவு', 'තෘප්තිමත්'],
  ['satisfied', 'positive', '☺️', 'Satisfied', 'திருப்தி', 'සෑහීමකට පත්'],
  ['relaxed', 'calm', '😌', 'Relaxed', 'தளர்வான உணர்வு', 'සැහැල්ලු'],
  ['calm', 'calm', '😌', 'Calm', 'அமைதி', 'සන්සුන්'],
  ['peaceful', 'calm', '🕊️', 'Peaceful', 'சாந்தம்', 'සාමකාමී'],
  ['hopeful', 'positive', '🌱', 'Hopeful', 'நம்பிக்கை உணர்வு', 'බලාපොරොත්තු සහිත'],
  ['optimistic', 'positive', '🌤️', 'Optimistic', 'நல்லது நடக்கும் என்ற நம்பிக்கை', 'හොඳ දේ බලාපොරොත්තු වන'],
  ['proud', 'positive', '🏅', 'Proud', 'பெருமிதம்', 'ආඩම්බර'],
  ['confident', 'positive', '💪', 'Confident', 'தன்னம்பிக்கை', 'ආත්ම විශ්වාසයෙන් යුතු'],
  ['grateful', 'positive', '🙏', 'Grateful', 'நன்றியுணர்வு', 'කෘතඥ'],
  ['thankful', 'positive', '🙏', 'Thankful', 'நன்றி தெரிவிக்கும் உணர்வு', 'ස්තුතිවන්ත'],
  ['loving', 'affection', '❤️', 'Loving', 'அன்பு', 'ආදරයෙන් යුතු'],
  ['affectionate', 'affection', '🥰', 'Affectionate', 'பாசம்', 'සෙනෙහසින් යුතු'],
  ['caring', 'affection', '🤗', 'Caring', 'அக்கறை', 'සැලකිලිමත්'],
  ['compassionate', 'affection', '💗', 'Compassionate', 'கருணை', 'කරුණාවන්ත'],
  ['inspired', 'positive', '✨', 'Inspired', 'ஊக்கம் பெற்ற உணர்வு', 'ආභාසය ලැබූ'],
  ['motivated', 'positive', '🎯', 'Motivated', 'செயல்பட உந்துதல்', 'පෙළඹවීමක් ඇති'],
  ['enthusiastic', 'positive', '🙌', 'Enthusiastic', 'மிகுந்த ஆர்வம்', 'ඉමහත් උනන්දුවෙන් යුතු'],
  ['energetic', 'positive', '⚡', 'Energetic', 'ஆற்றல் மிக்க உணர்வு', 'ශක්තිමත්'],
  ['playful', 'positive', '😜', 'Playful', 'விளையாட்டுத்தனம்', 'කෙළිලොල්'],
  ['curious', 'attention', '🧐', 'Curious', 'அறிந்துகொள்ளும் ஆர்வம்', 'කුතුහලයෙන් යුතු'],
  ['interested', 'attention', '👀', 'Interested', 'ஆர்வம்', 'උනන්දුවක් ඇති'],
  ['focused', 'attention', '🎯', 'Focused', 'கவனம் ஒருமுகப்பட்ட உணர்வு', 'අවධානය යොමු කළ'],
  ['attentive', 'attention', '👂', 'Attentive', 'கவனமாக இருக்கும் உணர்வு', 'අවධානයෙන් සිටින'],
  ['surprised', 'surprise', '😮', 'Surprised', 'ஆச்சரியம்', 'පුදුමයට පත්'],
  ['amazed', 'surprise', '🤩', 'Amazed', 'வியப்பு', 'විස්මයට පත්'],
  ['astonished', 'surprise', '😲', 'Astonished', 'பெரும் வியப்பு', 'අතිශයින් විස්මයට පත්'],
  ['shocked', 'surprise', '😳', 'Shocked', 'அதிர்ச்சி உணர்வு', 'කම්පනයට පත් වූ හැඟීම'],
  ['startled', 'surprise', '😯', 'Startled', 'திடுக்கிட்ட உணர்வு', 'හදිසියේ තිගැස්සුණු'],
  ['confused', 'uncertainty', '😕', 'Confused', 'குழப்பம்', 'ව්‍යාකූල'],
  ['puzzled', 'uncertainty', '🤔', 'Puzzled', 'புரியாமல் திகைக்கும் உணர்வு', 'තේරුම්ගත නොහැකිව සිටින'],
  ['uncertain', 'uncertainty', '😐', 'Uncertain', 'நிச்சயமின்மை', 'අවිනිශ්චිත'],
  ['doubtful', 'uncertainty', '🤨', 'Doubtful', 'ஐயம்', 'සැක සහිත'],
  ['hesitant', 'uncertainty', '🤔', 'Hesitant', 'தயக்கம்', 'පසුබට වන'],
  ['sad', 'sadness', '😢', 'Sad', 'சோகம்', 'දුකින් සිටින'],
  ['unhappy', 'sadness', '🙁', 'Unhappy', 'மகிழ்ச்சியின்மை', 'අසතුටු'],
  ['sorrowful', 'sadness', '😞', 'Sorrowful', 'துயரம்', 'ශෝකයෙන් යුතු'],
  ['depressed', 'sadness', '😔', 'Depressed', 'மனச்சோர்வாக உணரும் நிலை', 'මානසිකව පහත වැටුණු බවක් දැනෙන'],
  ['lonely', 'sadness', '🥺', 'Lonely', 'தனிமை', 'තනිකමක් දැනෙන'],
  ['heartbroken', 'sadness', '💔', 'Heartbroken', 'மனம் உடைந்த உணர்வு', 'හදවත බිඳුණු බවක් දැනෙන'],
  ['disappointed', 'sadness', '😞', 'Disappointed', 'ஏமாற்றம்', 'බලාපොරොත්තු කඩ වූ'],
  ['hopeless', 'sadness', '😔', 'Hopeless', 'நம்பிக்கையின்மை', 'බලාපොරොත්තු රහිත'],
  ['miserable', 'sadness', '😣', 'Miserable', 'மிகுந்த துன்பம்', 'ඉතා දුක්ඛිත'],
  ['tearful', 'sadness', '😭', 'Tearful', 'கண்ணீர் வரும் உணர்வு', 'කඳුළු පිරි'],
  ['grieving', 'sadness', '🕯️', 'Grieving', 'இழப்பால் துயரப்படும் உணர்வு', 'අහිමිවීමක් ගැන ශෝක වන'],
  ['regretful', 'sadness', '😔', 'Regretful', 'வருந்தும் உணர்வு', 'පසුතැවෙන'],
  ['guilty', 'selfConscious', '😟', 'Guilty', 'குற்ற உணர்வு', 'වරදකාරී හැඟීමක් ඇති'],
  ['ashamed', 'selfConscious', '😳', 'Ashamed', 'அவமான உணர்வு', 'ලැජ්ජාවෙන් යුතු'],
  ['embarrassed', 'selfConscious', '😳', 'Embarrassed', 'சங்கடம்', 'අපහසුතාවට පත්'],
  ['rejected', 'sadness', '💔', 'Rejected', 'நிராகரிக்கப்பட்ட உணர்வு', 'ප්‍රතික්ෂේප වූ බවක් දැනෙන'],
  ['hurt', 'sadness', '🥺', 'Hurt', 'மனம் புண்பட்ட உணர்வு', 'සිත් රිදුණු'],
  ['angry', 'anger', '😠', 'Angry', 'கோபம்', 'කෝපයෙන් යුතු'],
  ['furious', 'anger', '😡', 'Furious', 'கடும் கோபம்', 'දැඩි කෝපයෙන් යුතු'],
  ['irritated', 'anger', '😒', 'Irritated', 'எரிச்சல்', 'නොරිස්සුම්'],
  ['annoyed', 'anger', '🙄', 'Annoyed', 'தொந்தரவால் எரிச்சல்', 'කරදරයක් නිසා නොරිස්සුම්'],
  ['frustrated', 'anger', '😤', 'Frustrated', 'விரக்தி', 'කලකිරුණු'],
  ['enraged', 'anger', '😡', 'Enraged', 'ஆத்திரம்', 'ඉතා දැඩි කෝපයෙන් යුතු'],
  ['resentful', 'anger', '😒', 'Resentful', 'மனக்கசப்பு', 'අමනාපයෙන් යුතු'],
  ['hostile', 'anger', '😠', 'Hostile', 'பகை உணர்வு', 'වෛරී හැඟීමක් ඇති'],
  ['aggressive', 'anger', '😤', 'Aggressive', 'ஆவேசமாக உணரும் நிலை', 'ආක්‍රමණශීලී බවක් දැනෙන'],
  ['outraged', 'anger', '😡', 'Outraged', 'அநீதியால் கடும் கோபம்', 'අසාධාරණයක් ගැන දැඩි කෝපයෙන් යුතු'],
  ['impatient', 'anger', '⌛', 'Impatient', 'பொறுமையின்மை', 'ඉවසිලිමත් නොවන'],
  ['disgusted', 'disgust', '🤢', 'Disgusted', 'அருவருப்பு', 'පිළිකුලෙන් යුතු'],
  ['repulsed', 'disgust', '🤢', 'Repulsed', 'கடும் அருவருப்பு', 'දැඩි පිළිකුලක් ඇති'],
  ['contemptuous', 'disgust', '😒', 'Contemptuous', 'இகழ்ச்சியுணர்வு', 'අවඥාවෙන් යුතු'],
  ['afraid', 'fear', '😨', 'Afraid', 'பயம்', 'බියට පත්'],
  ['fearful', 'fear', '😨', 'Fearful', 'அச்சம் நிறைந்த உணர்வு', 'බියෙන් යුතු'],
  ['scared', 'fear', '😧', 'Scared', 'பயந்த உணர்வு', 'බිය වූ'],
  ['terrified', 'fear', '😱', 'Terrified', 'மிகுந்த அச்சம்', 'අතිශයින් බියට පත්'],
  ['panicked', 'fear', '😰', 'Panicked', 'பீதியடைந்த உணர்வு', 'භීතියට පත්'],
  ['anxious', 'fear', '😟', 'Anxious', 'பதட்டம்', 'කාංසාවෙන් යුතු'],
  ['nervous', 'fear', '😬', 'Nervous', 'பதற்றம்', 'චකිතයෙන් යුතු'],
  ['worried', 'fear', '😟', 'Worried', 'கவலை', 'කනස්සල්ලෙන් යුතු'],
  ['concerned', 'fear', '😟', 'Concerned', 'அக்கறையுடன் கவலைப்படும் உணர்வு', 'සැලකිල්ලෙන් කනස්සල්ලට පත්'],
  ['alarmed', 'fear', '😧', 'Alarmed', 'அபாயம் உணர்ந்து அஞ்சும் நிலை', 'අනතුරක් ගැන බියට පත්'],
  ['tense', 'tension', '😬', 'Tense', 'இறுக்கமான உணர்வு', 'ආතතියෙන් යුතු'],
  ['stressed', 'tension', '😣', 'Stressed', 'மன அழுத்தம்', 'මානසික පීඩනයක් ඇති'],
  ['uneasy', 'tension', '😟', 'Uneasy', 'நிம்மதியின்மை', 'නොසන්සුන්'],
  ['insecure', 'fear', '🥺', 'Insecure', 'பாதுகாப்பின்மை உணர்வு', 'අනාරක්ෂිත බවක් දැනෙන'],
  ['overwhelmed', 'tension', '😵‍💫', 'Overwhelmed', 'சமாளிக்க முடியாத உணர்வு', 'දරාගත නොහැකි බවක් දැනෙන'],
  ['distressed', 'tension', '😣', 'Distressed', 'மிகுந்த மனவேதனை', 'දැඩි පීඩාවෙන් යුතු'],
  ['agitated', 'tension', '😤', 'Agitated', 'கலக்கமடைந்த உணர்வு', 'කැළඹුණු'],
  ['restless', 'tension', '😬', 'Restless', 'இருப்புக்கொள்ளாத உணர்வு', 'නොසන්සුන්ව සිටින'],
  ['uncomfortable', 'tension', '😖', 'Uncomfortable', 'அசௌகரியம்', 'අපහසුතාවක් දැනෙන'],
  ['tired', 'energy', '😪', 'Tired', 'சோர்வு', 'වෙහෙසට පත්'],
  ['fatigued', 'energy', '😮‍💨', 'Fatigued', 'உடல் தளர்ச்சி', 'ශක්තිය හීන වූ බවක් දැනෙන'],
  ['exhausted', 'energy', '😩', 'Exhausted', 'மிகுந்த சோர்வு', 'අතිශයින් වෙහෙසට පත්'],
  ['sleepy', 'energy', '😴', 'Sleepy', 'தூக்கம் வரும் உணர்வு', 'නිදිමත'],
  ['drowsy', 'energy', '🥱', 'Drowsy', 'தூக்கக் கலக்கம்', 'නිදිබර'],
  ['bored', 'energy', '🥱', 'Bored', 'சலிப்பு', 'කම්මැලි බවක් දැනෙන'],
  ['apathetic', 'energy', '😐', 'Apathetic', 'எதிலும் ஆர்வமின்மை', 'කිසිවකට උනන්දුවක් නැති'],
  ['neutral', 'neutral', '😐', 'Neutral', 'நடுநிலை உணர்வு', 'මධ්‍යස්ථ හැඟීම'],
  ['concentrated', 'attention', '🎯', 'Concentrated', 'ஆழ்ந்த கவனம்', 'ගැඹුරු අවධානයෙන් යුතු'],
  ['relieved', 'calm', '😮‍💨', 'Relieved', 'நிம்மதி', 'සහනයක් දැනෙන'],
  ['pain', 'tension', '😖', 'Pain', 'வலி', 'වේදනාව'],
];

export const EMOTION_CHECK_IN_STATES = Object.freeze(rows.map(([id, category, emoji, en, ta, si]) =>
  Object.freeze({ id, category, emoji, labels: Object.freeze({ en, ta, si }) })));

const catalogById = new Map(EMOTION_CHECK_IN_STATES.map(state => [state.id, state]));
const copy = {
  en: {
    title: 'How do you feel?',
    description: 'Choose feelings you report yourself. The camera cannot identify these 100 states. Your answers are separate from facial-expression estimates and are not a diagnosis.',
    reportSource: 'Patient-reported feelings; not detected by the camera',
    searchPlaceholder: 'Search feelings or categories', allStates: 'All feelings',
    noResults: 'No matching feelings. Try another word.', statesCountLabel: 'patient-reported states available', close: 'Close',
    reportTitle: 'Patient-reported feelings check-in', shareReport: 'Share saved check-in report',
    wellnessScore: 'Self-rated wellness score', note: 'Patient note', recordedAt: 'Recorded at',
    clinicalLimit: 'This is a patient-reported check-in, not a camera estimate or a diagnosis. It cannot confirm or rule out an emergency.',
  },
  ta: {
    title: 'நீங்கள் எப்படி உணர்கிறீர்கள்?',
    description: 'நீங்கள் உணரும் உணர்வுகளை நீங்களே தேர்ந்தெடுக்கவும். கேமராவால் இந்த 100 நிலைகளை அடையாளம் காண முடியாது. உங்கள் பதில்கள் முகபாவனை மதிப்பீடுகளிலிருந்து தனியானவை; இவை நோயறிதல் அல்ல.',
    reportSource: 'நோயாளி தெரிவித்த உணர்வுகள்; கேமரா கண்டறிந்தவை அல்ல',
    searchPlaceholder: 'உணர்வுகள் அல்லது வகைகளைத் தேடவும்', allStates: 'அனைத்து உணர்வுகள்',
    noResults: 'பொருந்தும் உணர்வுகள் இல்லை. வேறு சொல்லைப் பயன்படுத்தவும்.', statesCountLabel: 'நோயாளி தெரிவிக்கக்கூடிய நிலைகள் உள்ளன', close: 'மூடவும்',
    reportTitle: 'நோயாளி தெரிவித்த உணர்வுகளின் பதிவு', shareReport: 'சேமித்த உணர்வுப் பதிவைப் பகிரவும்',
    wellnessScore: 'நீங்கள் மதிப்பிட்ட நல உணர்வு மதிப்பெண்', note: 'நோயாளியின் குறிப்பு', recordedAt: 'பதிவு செய்த நேரம்',
    clinicalLimit: 'இது நோயாளி தெரிவித்த பதிவு; கேமரா மதிப்பீடோ நோயறிதலோ அல்ல. அவசர நிலையை உறுதிப்படுத்தவோ நிராகரிக்கவோ இது உதவாது.',
  },
  si: {
    title: 'ඔබට දැනෙන්නේ කොහොමද?',
    description: 'ඔබට දැනෙන හැඟීම් ඔබම තෝරන්න. කැමරාවට මෙම තත්ත්ව 100 හඳුනාගත නොහැක. ඔබේ පිළිතුරු මුහුණේ ඉරියව් ඇස්තමේන්තුවලින් වෙන් වූ ඒවා වන අතර රෝග විනිශ්චයක් නොවේ.',
    reportSource: 'රෝගියා වාර්තා කළ හැඟීම්; කැමරාව හඳුනාගත් ඒවා නොවේ',
    searchPlaceholder: 'හැඟීම් හෝ කාණ්ඩ සොයන්න', allStates: 'සියලු හැඟීම්',
    noResults: 'ගැළපෙන හැඟීම් නැත. වෙනත් වචනයක් උත්සාහ කරන්න.', statesCountLabel: 'රෝගියාට වාර්තා කළ හැකි තත්ත්ව තිබේ', close: 'වසන්න',
    reportTitle: 'රෝගියා වාර්තා කළ හැඟීම් සටහන', shareReport: 'සුරැකි හැඟීම් වාර්තාව බෙදාගන්න',
    wellnessScore: 'ඔබම ඇගයූ සුවතා ලකුණ', note: 'රෝගියාගේ සටහන', recordedAt: 'වාර්තා කළ වේලාව',
    clinicalLimit: 'මෙය රෝගියා වාර්තා කළ සටහනක් වන අතර කැමරා ඇස්තමේන්තුවක් හෝ රෝග විනිශ්චයක් නොවේ. හදිසි තත්ත්වයක් තහවුරු කිරීමට හෝ බැහැර කිරීමට එයට නොහැක.',
  },
};

const language = lang => Object.hasOwn(copy, lang) ? lang : 'en';
for (const lang of Object.keys(copy)) {
  copy[lang] = Object.freeze({ ...copy[lang], categories: Object.freeze(Object.fromEntries(
    Object.entries(categories).map(([id, labels]) => [id, labels[lang]]))) });
}
Object.freeze(copy);

export function getEmotionCheckInCopy(lang = 'en') { return copy[language(lang)]; }

export function getEmotionCheckInState(id, lang = 'en') {
  if (typeof id !== 'string') return null;
  const state = catalogById.get(id);
  return state ? Object.freeze({ ...state, label: state.labels[language(lang)] }) : null;
}

// Fold Latin diacritics only. Removing all Unicode marks would corrupt Tamil
// and Sinhala vowel signs and make unrelated localized labels collide.
const searchText = value => value.normalize('NFKC').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function searchEmotionCheckInStates(query = '', lang = 'en') {
  if (typeof query !== 'string') return [];
  const selectedLanguage = language(lang), words = searchText(query).split(/\s+/).filter(Boolean);
  return EMOTION_CHECK_IN_STATES.filter(state => {
    const text = searchText([state.id, state.labels.en, state.labels[selectedLanguage],
      categories[state.category].en, categories[state.category][selectedLanguage]].join(' '));
    return words.every(word => text.includes(word));
  }).map(state => getEmotionCheckInState(state.id, selectedLanguage));
}

export function buildEmotionCheckInReport({ stateId, wellnessScore, note = '', language: lang = 'en', recordedAt } = {}) {
  const state = getEmotionCheckInState(stateId, lang), localizedCopy = getEmotionCheckInCopy(lang);
  if (!state) throw new TypeError('Unknown patient-reported state.');
  if (!Number.isInteger(wellnessScore) || wellnessScore < 0 || wellnessScore > 100) {
    throw new RangeError('Self-rated wellness score must be an integer from 0 to 100.');
  }
  if (typeof note !== 'string' || note.length > 4500) throw new TypeError('Patient note must be a string of at most 4500 characters.');
  if (!(recordedAt instanceof Date) && typeof recordedAt !== 'string' && typeof recordedAt !== 'number') {
    throw new TypeError('A valid recorded-at date is required.');
  }
  if (typeof recordedAt === 'string' && !recordedAt.trim()) throw new TypeError('A valid recorded-at date is required.');
  const recordedDate = new Date(recordedAt);
  if (!Number.isFinite(recordedDate.getTime())) throw new TypeError('A valid recorded-at date is required.');
  return [localizedCopy.reportTitle, localizedCopy.reportSource, '', `${state.emoji} ${state.label}`,
    `${localizedCopy.wellnessScore}: ${wellnessScore}/100`, `${localizedCopy.recordedAt}: ${recordedDate.toISOString()}`,
    ...(note.trim() ? [`${localizedCopy.note}: ${note.trim()}`] : []), '', localizedCopy.clinicalLimit].join('\n');
}
