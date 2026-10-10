// Interaction labels stay deterministic; the provider never writes translated health advice.
const mobileCopy = {
  en: {
    title: 'Face photo check', subtitle: 'Your photo. A clear, honest report.', back: 'Back',
    camera: 'Open camera', upload: 'Choose a photo', capture: 'Capture photo', captureHint: 'Face the camera in even light. Keep faces visible; multiple people are supported.',
    emptyTitle: 'Start with one clear photo', emptyHint: 'Use your camera or choose a photo. You can review it before analysis.',
    preview: 'Photo to be analyzed', exactPhoto: 'The boxes below belong to this exact photo.',
    analyze: 'Analyze this photo', analyzing: 'Checking your photo…', preparing: 'Preparing your photo…', retake: 'Use another photo',
    consent: 'Analyze sends this photo through CareConnect to Google Cloud Vision. Analysis runs once when you press the button.',
    privacy: 'Face photos are not saved in wellness history. Sharing a report shares text only.',
    limits: 'This detects faces and visible image signals. It cannot determine your actual feelings, pain, health or identity.',
    report: 'Your face report', ready: 'Report ready', needsRetake: 'A clearer photo is recommended', faces: 'Faces detected', confidence: 'Detection confidence',
    share: 'Share report', noPerfect: 'Detection confidence is a model estimate, not a guarantee of accuracy.',
    cameraPermission: 'Allow camera access to take a photo, or choose one from your gallery.', cameraReady: 'Getting the camera ready…',
    errors: {
      camera: 'The camera could not start. Check camera permission or choose a photo.', image: 'Choose a readable image photo.', large: 'This image is too large. Choose a smaller photo (up to 16 MB).',
      notConfigured: 'The project owner must configure Google Cloud Vision credentials and enable the service before photo analysis is available.', unavailable: 'Face analysis is temporarily unavailable. Please try again later.', analysis: 'The photo could not be analyzed. Check your connection and try again.',
      report: 'The service returned an invalid or mismatched photo report. Please try again.', auth: 'Please sign in again to continue.',
      timeout: 'The photo check took too long. Please try again.', rateLimit: 'Please wait a minute before another photo check.',
      save: 'Your check-in could not be confirmed as saved. Please try again.', share: 'The report could not be shared. Please try again.', score: 'Choose a whole-number wellness score from 0 to 100.',
    },
    manual: 'Optional wellness check-in', manualHint: 'Tell your care team how you feel. Your answers are separate from the photo report.',
    feeling: 'How do you feel?', feelings: { happy: 'Happy', sad: 'Sad', angry: 'Angry', anxious: 'Anxious', neutral: 'Neutral', pain: 'In pain', tired: 'Tired' },
    score: 'Your wellness score (0–100)', scoreHint: '0 means very unwell; 100 means feeling very well. Choose your own score.', note: 'Anything your care team should know? (optional)',
    notePlaceholder: 'Describe how you feel in your own words', save: 'Save my check-in', saving: 'Saving your check-in…', saved: 'Your check-in was saved.',
    alertCreated: 'A care-team alert was recorded from your self-reported score.', alertUpdated: 'An existing care-team alert was updated.', alertExisting: 'Your score is linked to an existing care-team alert.',
    alertNotice: 'Scores of 50 or below can record a care-team alert. This does not confirm that someone has read it.',
  },
  ta: {
    title: 'முகப் புகைப்படச் சரிபார்ப்பு', subtitle: 'உங்கள் படம். தெளிவான, நேர்மையான அறிக்கை.', back: 'பின்செல்',
    camera: 'கேமராவைத் திற', upload: 'புகைப்படத்தைத் தேர்வு செய்', capture: 'புகைப்படம் எடு', captureHint: 'சீரான வெளிச்சத்தில் கேமராவை நேராகப் பாருங்கள். முகங்கள் தெரியட்டும்; பலரையும் கண்டறியலாம்.',
    emptyTitle: 'தெளிவான ஒரு படத்துடன் தொடங்குங்கள்', emptyHint: 'கேமராவைப் பயன்படுத்துங்கள் அல்லது ஒரு படத்தைத் தேர்வு செய்யுங்கள். ஆய்வுக்கு முன் அதைப் பார்க்கலாம்.',
    preview: 'ஆய்வு செய்யப்படும் புகைப்படம்', exactPhoto: 'கீழே உள்ள முகக் கட்டங்கள் இந்தப் புகைப்படத்திற்குரியவை.',
    analyze: 'இந்தப் படத்தை ஆய்வு செய்', analyzing: 'படம் சரிபார்க்கப்படுகிறது…', preparing: 'படம் தயாராகிறது…', retake: 'வேறொரு புகைப்படம் பயன்படுத்து',
    consent: 'ஆய்வு பொத்தானை அழுத்தும்போது இந்தப் படம் CareConnect வழியாக Google Cloud Vision-க்கு அனுப்பப்படும். ஒவ்வொரு அழுத்தத்திற்கும் ஒருமுறை மட்டுமே ஆய்வு நடக்கும்.',
    privacy: 'முகப் புகைப்படங்கள் நலப் பதிவில் சேமிக்கப்படாது. அறிக்கையைப் பகிரும்போது உரை மட்டும் பகிரப்படும்.',
    limits: 'இது முகங்களையும் படத்தில் தெரியும் அறிகுறிகளையும் கண்டறியும். உங்கள் உண்மையான உணர்வு, வலி, உடல்நலம் அல்லது அடையாளத்தைத் தீர்மானிக்க முடியாது.',
    report: 'உங்கள் முக ஆய்வு அறிக்கை', ready: 'அறிக்கை தயார்', needsRetake: 'இன்னும் தெளிவான படம் பரிந்துரைக்கப்படுகிறது', faces: 'கண்டறியப்பட்ட முகங்கள்', confidence: 'முகக் கண்டறிதல் நம்பிக்கை',
    share: 'அறிக்கையைப் பகிர்', noPerfect: 'கண்டறிதல் நம்பிக்கை என்பது மாதிரியின் மதிப்பீடு; துல்லியத்திற்கான உத்தரவாதம் அல்ல.',
    cameraPermission: 'புகைப்படம் எடுக்க கேமரா அனுமதி கொடுங்கள் அல்லது படத் தொகுப்பிலிருந்து ஒன்றைத் தேர்வு செய்யுங்கள்.', cameraReady: 'கேமரா தயாராகிறது…',
    errors: {
      camera: 'கேமராவைத் தொடங்க முடியவில்லை. அனுமதியைச் சரிபார்க்கவும் அல்லது ஒரு படத்தைத் தேர்வு செய்யவும்.', image: 'படிக்கக்கூடிய புகைப்படத்தைத் தேர்வு செய்யுங்கள்.', large: 'படம் மிகப் பெரியது. 16 MB-க்கு உட்பட்ட படத்தைத் தேர்வு செய்யுங்கள்.',
      notConfigured: 'பட ஆய்வு கிடைப்பதற்கு திட்ட உரிமையாளர் Google Cloud Vision அணுகல் விவரங்களை அமைத்து சேவையை இயக்க வேண்டும்.', unavailable: 'முக ஆய்வு தற்காலிகமாகக் கிடைக்கவில்லை. சிறிது நேரம் கழித்து முயலுங்கள்.', analysis: 'படத்தை ஆய்வு செய்ய முடியவில்லை. இணைய இணைப்பைச் சரிபார்த்து மீண்டும் முயலுங்கள்.',
      report: 'சேவை தவறான அல்லது இந்தப் படத்துடன் பொருந்தாத அறிக்கையை வழங்கியது. மீண்டும் முயலுங்கள்.', auth: 'தொடர மீண்டும் உள்நுழையுங்கள்.',
      timeout: 'படச் சரிபார்ப்பு அதிக நேரம் எடுத்தது. மீண்டும் முயலுங்கள்.', rateLimit: 'மற்றொரு படச் சரிபார்ப்பிற்கு ஒரு நிமிடம் காத்திருங்கள்.',
      save: 'உங்கள் நலப் பதிவு சேமிக்கப்பட்டதை உறுதிப்படுத்த முடியவில்லை. மீண்டும் முயலுங்கள்.', share: 'அறிக்கையைப் பகிர முடியவில்லை. மீண்டும் முயலுங்கள்.', score: '0 முதல் 100 வரையிலான முழு எண் மதிப்பெண்ணைத் தேர்வு செய்யுங்கள்.',
    },
    manual: 'விருப்ப நலப் பதிவு', manualHint: 'நீங்கள் எப்படி உணர்கிறீர்கள் என்பதை பராமரிப்புக் குழுவிடம் கூறுங்கள். இந்தப் பதில்கள் புகைப்பட அறிக்கையிலிருந்து தனியானவை.',
    feeling: 'நீங்கள் எப்படி உணர்கிறீர்கள்?', feelings: { happy: 'மகிழ்ச்சி', sad: 'சோகம்', angry: 'கோபம்', anxious: 'பதற்றம்', neutral: 'நடுநிலை', pain: 'வலி', tired: 'சோர்வு' },
    score: 'உங்கள் நல மதிப்பெண் (0–100)', scoreHint: '0 என்பது மிகவும் உடல்நலமின்றி இருப்பது; 100 என்பது மிகவும் நலமாக இருப்பது. உங்கள் மதிப்பெண்ணை நீங்களே தேர்வு செய்யுங்கள்.', note: 'பராமரிப்புக் குழுவிடம் சொல்ல வேண்டியது உள்ளதா? (விருப்பம்)',
    notePlaceholder: 'உங்கள் உணர்வை உங்கள் சொற்களில் எழுதுங்கள்', save: 'என் நலப் பதிவைச் சேமி', saving: 'நலப் பதிவு சேமிக்கப்படுகிறது…', saved: 'உங்கள் நலப் பதிவு சேமிக்கப்பட்டது.',
    alertCreated: 'நீங்கள் கூறிய மதிப்பெண்ணின் அடிப்படையில் பராமரிப்புக் குழு அறிவிப்பு பதிவு செய்யப்பட்டது.', alertUpdated: 'ஏற்கனவே உள்ள பராமரிப்புக் குழு அறிவிப்பு புதுப்பிக்கப்பட்டது.', alertExisting: 'உங்கள் மதிப்பெண் ஏற்கனவே உள்ள பராமரிப்புக் குழு அறிவிப்புடன் இணைக்கப்பட்டுள்ளது.',
    alertNotice: '50 அல்லது அதற்குக் குறைவான மதிப்பெண் பராமரிப்புக் குழு அறிவிப்பை உருவாக்கலாம். அதை ஒருவர் படித்ததாக இது உறுதிப்படுத்தாது.',
  },
  si: {
    title: 'මුහුණේ ඡායාරූප පරීක්ෂාව', subtitle: 'ඔබේ ඡායාරූපය. පැහැදිලි, අවංක වාර්තාවක්.', back: 'ආපසු',
    camera: 'කැමරාව විවෘත කරන්න', upload: 'ඡායාරූපයක් තෝරන්න', capture: 'ඡායාරූපය ගන්න', captureHint: 'සමාන ආලෝකයක කැමරාව දෙස කෙළින් බලන්න. මුහුණු පැහැදිලිව තබන්න; කිහිප දෙනෙකු හඳුනාගත හැක.',
    emptyTitle: 'පැහැදිලි ඡායාරූපයකින් ආරම්භ කරන්න', emptyHint: 'කැමරාව භාවිත කරන්න හෝ ඡායාරූපයක් තෝරන්න. විශ්ලේෂණයට පෙර එය බැලිය හැක.',
    preview: 'විශ්ලේෂණය කරන ඡායාරූපය', exactPhoto: 'පහත මුහුණු කොටු අදාළ වන්නේ මේ ඡායාරූපයටමයි.',
    analyze: 'මේ ඡායාරූපය විශ්ලේෂණය කරන්න', analyzing: 'ඡායාරූපය පරීක්ෂා කරමින්…', preparing: 'ඡායාරූපය සකස් කරමින්…', retake: 'වෙනත් ඡායාරූපයක් භාවිත කරන්න',
    consent: 'විශ්ලේෂණ බොත්තම එබූ විට මේ ඡායාරූපය CareConnect හරහා Google Cloud Vision වෙත යවනු ලැබේ. සෑම එබීමකදීම විශ්ලේෂණය එක් වරක් සිදු වේ.',
    privacy: 'මුහුණු ඡායාරූප සුවතා ඉතිහාසයේ සුරැකෙන්නේ නැත. වාර්තාවක් බෙදා ගන්නා විට පෙළ පමණක් බෙදා ගැනේ.',
    limits: 'මෙය මුහුණු සහ රූපයේ පෙනෙන සංඥා හඳුනා ගනී. ඔබේ සැබෑ හැඟීම්, වේදනාව, සෞඛ්‍යය හෝ අනන්‍යතාව තීරණය කළ නොහැක.',
    report: 'ඔබේ මුහුණු වාර්තාව', ready: 'වාර්තාව සූදානම්', needsRetake: 'වඩා පැහැදිලි ඡායාරූපයක් නිර්දේශ කෙරේ', faces: 'හඳුනාගත් මුහුණු', confidence: 'මුහුණු හඳුනාගැනීමේ විශ්වාසය',
    share: 'වාර්තාව බෙදා ගන්න', noPerfect: 'හඳුනාගැනීමේ විශ්වාසය යනු ආකෘතියේ ඇස්තමේන්තුවකි; නිරවද්‍යතාව පිළිබඳ සහතිකයක් නොවේ.',
    cameraPermission: 'ඡායාරූපයක් ගැනීමට කැමරා අවසර දෙන්න, නැතහොත් ගැලරියෙන් ඡායාරූපයක් තෝරන්න.', cameraReady: 'කැමරාව සූදානම් කරමින්…',
    errors: {
      camera: 'කැමරාව ආරම්භ කළ නොහැකි විය. අවසර පරීක්ෂා කරන්න හෝ ඡායාරූපයක් තෝරන්න.', image: 'කියවිය හැකි ඡායාරූපයක් තෝරන්න.', large: 'මේ රූපය විශාල වැඩියි. 16 MB දක්වා කුඩා ඡායාරූපයක් තෝරන්න.',
      notConfigured: 'ඡායාරූප විශ්ලේෂණය ලබා ගැනීමට ව්‍යාපෘති හිමිකරු Google Cloud Vision පිවිසුම් තොරතුරු සකසා සේවාව සක්‍රිය කළ යුතුය.', unavailable: 'මුහුණු විශ්ලේෂණය තාවකාලිකව ලබා ගත නොහැක. පසුව නැවත උත්සාහ කරන්න.', analysis: 'ඡායාරූපය විශ්ලේෂණය කළ නොහැකි විය. සම්බන්ධතාව පරීක්ෂා කර නැවත උත්සාහ කරන්න.',
      report: 'සේවාව වලංගු නොවන හෝ ඡායාරූපයට නොගැළපෙන වාර්තාවක් ලබා දුන්නේය. නැවත උත්සාහ කරන්න.', auth: 'ඉදිරියට යාමට නැවත පිවිසෙන්න.',
      timeout: 'ඡායාරූප පරීක්ෂාවට වැඩි කාලයක් ගත විය. නැවත උත්සාහ කරන්න.', rateLimit: 'තවත් ඡායාරූප පරීක්ෂාවකට පෙර විනාඩියක් රැඳී සිටින්න.',
      save: 'ඔබේ සුවතා සටහන සුරැකුණු බව තහවුරු කළ නොහැක. නැවත උත්සාහ කරන්න.', share: 'වාර්තාව බෙදා ගැනීමට නොහැකි විය. නැවත උත්සාහ කරන්න.', score: '0 සිට 100 දක්වා පූර්ණ අංක සුවතා අගයක් තෝරන්න.',
    },
    manual: 'විකල්ප සුවතා සටහන', manualHint: 'ඔබට දැනෙන ආකාරය සත්කාර කණ්ඩායමට කියන්න. ඔබේ පිළිතුරු ඡායාරූප වාර්තාවෙන් වෙනස් වේ.',
    feeling: 'ඔබට දැනෙන්නේ කෙසේද?', feelings: { happy: 'සතුටුයි', sad: 'දුකයි', angry: 'කෝපයි', anxious: 'කනස්සල්ලෙන්', neutral: 'මධ්‍යස්ථ', pain: 'වේදනාවෙන්', tired: 'වෙහෙසයි' },
    score: 'ඔබේ සුවතා අගය (0–100)', scoreHint: '0 යනු ඉතා අසනීප බවයි; 100 යනු ඉතා සුවෙන් බවයි. ඔබේ අගය ඔබම තෝරන්න.', note: 'සත්කාර කණ්ඩායම දැනගත යුතු යමක් තිබේද? (විකල්ප)',
    notePlaceholder: 'ඔබට දැනෙන ආකාරය ඔබේ වචනවලින් ලියන්න', save: 'මගේ සුවතා සටහන සුරකින්න', saving: 'සුවතා සටහන සුරකිමින්…', saved: 'ඔබේ සුවතා සටහන සුරැකිණි.',
    alertCreated: 'ඔබ දුන් අගය අනුව සත්කාර කණ්ඩායමේ දැනුම්දීමක් සටහන් කෙරිණි.', alertUpdated: 'පවතින සත්කාර කණ්ඩායමේ දැනුම්දීමක් යාවත්කාලීන කෙරිණි.', alertExisting: 'ඔබේ අගය පවතින සත්කාර කණ්ඩායමේ දැනුම්දීමකට සම්බන්ධ කෙරිණි.',
    alertNotice: '50 හෝ ඊට අඩු අගයක් සත්කාර කණ්ඩායමේ දැනුම්දීමක් සටහන් කළ හැක. කෙනෙකු එය කියවා ඇති බව මෙයින් තහවුරු නොවේ.',
  },
};

export function getMobileFaceCopy(language) { return mobileCopy[language] || mobileCopy.en; }

// Same contain transform as the Image view, including its letterbox margins.
export function containedFaceBox(box, image, frame) {
  if (!box || !image || !frame || image.width <= 0 || image.height <= 0 || frame.width <= 0 || frame.height <= 0) return null;
  const scale = Math.min(frame.width / image.width, frame.height / image.height);
  const width = image.width * scale, height = image.height * scale;
  return { left: (frame.width - width) / 2 + box.x * width,
    top: (frame.height - height) / 2 + box.y * height, width: box.width * width, height: box.height * height };
}

// Live camera previews use aspect-fill, unlike a contained photo. Expo's front
// preview is mirrored on web and native, while mirror={false} keeps captured
// pixels unmirrored. Reflect geometry only; inference and exact-photo reports
// must keep their original pixels and coordinates.
function livePreviewRect(image, frame) {
  if (![image?.width, image?.height, frame?.width, frame?.height].every(value => Number.isFinite(value) && value > 0)) return null;
  const scale = Math.max(frame.width / image.width, frame.height / image.height);
  const width = image.width * scale, height = image.height * scale;
  return { left: (frame.width - width) / 2, top: (frame.height - height) / 2, width, height };
}

export function livePreviewFaceBox(box, image, frame, { mirrored = false } = {}) {
  const rect = livePreviewRect(image, frame);
  if (!rect || !box || ![box.x, box.y, box.width, box.height].every(value => Number.isFinite(value) && value >= 0 && value <= 1) ||
      !box.width || !box.height || box.x + box.width > 1.000001 || box.y + box.height > 1.000001) return null;
  return { left: rect.left + (mirrored ? 1 - box.x - box.width : box.x) * rect.width,
    top: rect.top + box.y * rect.height, width: box.width * rect.width, height: box.height * rect.height };
}

export function livePreviewPoint(point, image, frame, { mirrored = false } = {}) {
  const rect = livePreviewRect(image, frame);
  if (!rect || !point || ![point.x, point.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) return null;
  return { left: rect.left + (mirrored ? 1 - point.x : point.x) * rect.width, top: rect.top + point.y * rect.height };
}

export const SELF_REPORTED_FEELINGS = Object.freeze(['happy', 'sad', 'angry', 'anxious', 'neutral', 'pain', 'tired']);
