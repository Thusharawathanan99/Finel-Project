const states = ['checking', 'missing', 'invalid', 'available', 'unavailable'];
const copy = {
  en: {
    title: 'Google Cloud Vision configuration',
    states: {
      checking: 'Checking Google Cloud Vision configuration…',
      missing: 'Google Cloud Vision is not configured on the server. Local detection remains available.',
      invalid: 'Google Cloud Vision configuration needs correction on the server. Local detection remains available.',
      available: 'Google Cloud Vision configuration is available. Provider access has not yet been verified by an analysis request.',
      unavailable: 'Google Cloud Vision configuration could not be checked. No cloud connection has been confirmed.',
    },
  },
  ta: {
    title: 'Google Cloud Vision அமைப்பு',
    states: {
      checking: 'Google Cloud Vision அமைப்பு சரிபார்க்கப்படுகிறது…',
      missing: 'சேவையகத்தில் Google Cloud Vision அமைக்கப்படவில்லை. சாதன முகக் கண்டறிதலைத் தொடர்ந்து பயன்படுத்தலாம்.',
      invalid: 'சேவையகத்தில் Google Cloud Vision அமைப்பைத் திருத்த வேண்டும். சாதன முகக் கண்டறிதலைத் தொடர்ந்து பயன்படுத்தலாம்.',
      available: 'Google Cloud Vision அமைப்பு உள்ளது. ஆய்வுக் கோரிக்கை மூலம் சேவை அணுகல் இன்னும் உறுதிப்படுத்தப்படவில்லை.',
      unavailable: 'Google Cloud Vision அமைப்பைச் சரிபார்க்க முடியவில்லை. மேக சேவை இணைப்பு உறுதிப்படுத்தப்படவில்லை.',
    },
  },
  si: {
    title: 'Google Cloud Vision සැකසුම',
    states: {
      checking: 'Google Cloud Vision සැකසුම පරීක්ෂා කරමින්…',
      missing: 'සේවාදායකයේ Google Cloud Vision සකසා නැත. උපාංගයේ හඳුනාගැනීම තවදුරටත් භාවිත කළ හැක.',
      invalid: 'සේවාදායකයේ Google Cloud Vision සැකසුම නිවැරදි කළ යුතුයි. උපාංගයේ හඳුනාගැනීම තවදුරටත් භාවිත කළ හැක.',
      available: 'Google Cloud Vision සැකසුම ඇත. විශ්ලේෂණ ඉල්ලීමකින් සේවා ප්‍රවේශය තවම තහවුරු කර නැත.',
      unavailable: 'Google Cloud Vision සැකසුම පරීක්ෂා කළ නොහැකි විය. වලාකුළු සම්බන්ධතාවක් තහවුරු කර නැත.',
    },
  },
};
for (const value of Object.values(copy)) { Object.freeze(value.states); Object.freeze(value); }
Object.freeze(copy);

export function getFaceProviderStatusCopy(language = 'en') {
  const key = typeof language === 'string' ? language.trim().toLowerCase().split(/[-_]/)[0] : 'en';
  return copy[key === 'ta' || key === 'si' ? key : 'en'];
}

// Configuration alone never proves credentials, billing, network access or detection accuracy.
export function validateFaceProviderStatus(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.provider !== 'google-cloud-vision' ||
      value.providerVerified !== false || !states.slice(1, 4).includes(value.configurationState)) throw new Error('cloud_status');
  return Object.freeze({ provider: value.provider, configurationState: value.configurationState, providerVerified: false });
}
