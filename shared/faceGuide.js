const copy = {
  en: { title: 'Understand your monitoring', cameraOffGuide: 'Stop the camera to open the illustrated guide.', notice: 'Original fictional illustrations. These images are educational, not patient data or model predictions.',
    movement: 'Facial movement', movementText: 'Landmarks measure visible geometry. A tense-looking face alone cannot establish pain.',
    rest: 'Rest and everyday variation', restText: 'Closed eyes, tiredness and ordinary rest do not automatically mean an emergency.',
    support: 'Symptoms and assistance', supportText: 'Tell your care team how you feel. Serious reported symptoms need attention even when an expression looks neutral.',
    asymmetry: 'Comparing facial landmarks', asymmetryText: 'The diagram illustrates a mouth-corner difference. Camera angle affects it; this cannot confirm or exclude stroke.',
    workflow: 'Assistance workflow', normal: 'No repeated measured change', possible: 'Check-in suggested', attention: 'Care-team request saved', urgent: 'Urgent symptoms reported', unavailable: 'Waiting for usable observations',
    workflowNotice: 'Workflow status, not a medical risk score. A saved request does not confirm delivery or that help is on the way.' },
  ta: { title: 'கண்காணிப்பு முடிவுகளைப் புரிந்துகொள்ள', cameraOffGuide: 'விளக்கப் படங்களைப் பார்க்க கேமராவை நிறுத்துங்கள்.', notice: 'கற்பனையாக உருவாக்கப்பட்ட விளக்கப் படங்கள். இவை நோயாளியின் தகவலோ மாதிரியின் கணிப்போ அல்ல.',
    movement: 'முக அசைவு', movementText: 'முகப் புள்ளிகள் தெரியும் வடிவத்தை அளவிடுகின்றன. இறுக்கமாகத் தெரியும் முகத்தை மட்டும் வைத்து வலி இருப்பதாக உறுதிப்படுத்த முடியாது.',
    rest: 'ஓய்வும் இயல்பான மாற்றங்களும்', restText: 'கண்களை மூடுதல், சோர்வு அல்லது சாதாரண ஓய்வு தானாகவே அவசர நிலையாகாது.',
    support: 'அறிகுறிகளும் உதவியும்', supportText: 'உங்கள் உணர்வை பராமரிப்புக் குழுவிடம் கூறுங்கள். முகபாவனை நடுநிலையாக இருந்தாலும் கடுமையான அறிகுறிகளைக் கவனிக்க வேண்டும்.',
    asymmetry: 'முகப் புள்ளிகளை ஒப்பிடுதல்', asymmetryText: 'இந்த வரைபடம் வாயின் மூலைகளில் உள்ள வேறுபாட்டை விளக்குகிறது. கேமரா கோணம் இதைப் பாதிக்கும்; இதனால் பக்கவாதத்தை உறுதிப்படுத்தவோ மறுக்கவோ முடியாது.',
    workflow: 'உதவி செயல்முறை', normal: 'தொடர்ந்த அளவு மாற்றம் காணப்படவில்லை', possible: 'நலம் விசாரிக்க பரிந்துரை', attention: 'பராமரிப்பு உதவிக் கோரிக்கை சேமிக்கப்பட்டது', urgent: 'அவசர அறிகுறிகள் தெரிவிக்கப்பட்டன', unavailable: 'பயன்படக்கூடிய அளவுகளுக்காகக் காத்திருக்கிறது',
    workflowNotice: 'இது உதவி செயல்முறையின் நிலை; மருத்துவ அபாய மதிப்பெண் அல்ல. கோரிக்கை சேமிக்கப்பட்டது என்பது தகவல் சென்றது அல்லது உதவி வருகிறது என்பதை உறுதிப்படுத்தாது.' },
  si: { title: 'ඔබේ නිරීක්ෂණ තේරුම් ගන්න', cameraOffGuide: 'රූප සහිත මාර්ගෝපදේශය විවෘත කිරීමට කැමරාව නවත්වන්න.', notice: 'නිර්මාණය කළ කල්පිත අධ්‍යාපනික රූප. මේවා රෝගියාගේ දත්ත හෝ ආකෘති අනාවැකි නොවේ.',
    movement: 'මුහුණු චලනය', movementText: 'මුහුණු ලක්ෂ්‍ය පෙනෙන හැඩය මනියි. තද වූ මුහුණක් පමණක් වේදනාව තහවුරු නොකරයි.',
    rest: 'විවේකය සහ එදිනෙදා වෙනස්කම්', restText: 'ඇස් වැසීම, විඩාව හෝ සාමාන්‍ය විවේකය ස්වයංක්‍රීයව හදිසි තත්ත්වයක් නොවේ.',
    support: 'ලක්ෂණ සහ සහාය', supportText: 'ඔබට දැනෙන දේ සත්කාර කණ්ඩායමට කියන්න. මුහුණ මධ්‍යස්ථ වුවත් බරපතළ වාර්තා කළ ලක්ෂණ ගැන අවධානය යොමු කළ යුතුය.',
    asymmetry: 'මුහුණු ලක්ෂ්‍ය සැසඳීම', asymmetryText: 'රූපය මුඛ කොන්වල වෙනසක් පෙන්වයි. කැමරා කෝණය එයට බලපායි; මෙයින් ආඝාතයක් තහවුරු හෝ බැහැර කළ නොහැක.',
    workflow: 'සහාය ක්‍රියාවලිය', normal: 'නැවත මනින ලද වෙනසක් නැත', possible: 'සුවදුක් විමසීම යෝජිතයි', attention: 'සත්කාර සහාය ඉල්ලීම සුරැකිණි', urgent: 'හදිසි ලක්ෂණ වාර්තා කර ඇත', unavailable: 'භාවිත කළ හැකි නිරීක්ෂණ බලා සිටියි',
    workflowNotice: 'මෙය සහාය ක්‍රියාවලියේ තත්ත්වයයි; වෛද්‍ය අවදානම් ලකුණක් නොවේ. ඉල්ලීම සුරැකීමෙන් ලැබීම හෝ සහාය පැමිණීම තහවුරු නොවේ.' },
};
export function getFaceGuideCopy(language = 'en') { return copy[language] || copy.en; }
export function getAssistanceWorkflow(observation, symptoms) {
  if (symptoms?.urgent === true) return 'urgent';
  if (symptoms?.receipt?.saved === true && symptoms.receipt.isResolved !== true) return 'attention';
  if (observation?.state === 'repeated-change') return 'possible';
  if (observation?.state === 'no-significant-change') return 'normal';
  return 'unavailable';
}
