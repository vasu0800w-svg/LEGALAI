export type AppLanguage = {
  id: string;
  native: string;
  locale: string;
};

/** Languages advocates use across Indian courts and regions. */
export const APP_LANGUAGES: AppLanguage[] = [
  { id: 'English', native: 'English', locale: 'en-IN' },
  { id: 'Hindi', native: 'हिन्दी', locale: 'hi-IN' },
  { id: 'Bengali', native: 'বাংলা', locale: 'bn-IN' },
  { id: 'Assamese', native: 'অসমীয়া', locale: 'as-IN' },
  { id: 'Odia', native: 'ଓଡ଼ିଆ', locale: 'or-IN' },
  { id: 'Marathi', native: 'मराठी', locale: 'mr-IN' },
  { id: 'Gujarati', native: 'ગુજરાતી', locale: 'gu-IN' },
  { id: 'Punjabi', native: 'ਪੰਜਾਬੀ', locale: 'pa-IN' },
  { id: 'Urdu', native: 'اردو', locale: 'ur-IN' },
  { id: 'Telugu', native: 'తెలుగు', locale: 'te-IN' },
  { id: 'Tamil', native: 'தமிழ்', locale: 'ta-IN' },
  { id: 'Kannada', native: 'ಕನ್ನಡ', locale: 'kn-IN' },
  { id: 'Malayalam', native: 'മലയാളം', locale: 'ml-IN' },
];

export const languageLocale = (language: string) =>
  APP_LANGUAGES.find((item) => item.id === language)?.locale || 'en-IN';

export const languageNativeName = (language: string) =>
  APP_LANGUAGES.find((item) => item.id === language)?.native || language;

export const greetingFor = (language: string): { text: string; questions: string[] } => {
  const pack: Record<string, { text: string; questions: string[] }> = {
    Hindi: {
      text: 'नमस्ते, मैं casemate हूँ। केस की फ़ाइल, नोटिस, या अपना सवाल भेजें। मैं उसका पूरा विश्लेषण करूँगा।',
      questions: ['मेरे पास एक FIR है', 'एक जमानत अर्जी का ड्राफ्ट बनाएं', 'एक नोटिस समझाएं'],
    },
    Bengali: {
      text: 'নমস্কার, আমি casemate। মামলার কাগজ, নোটিশ, বা আপনার প্রশ্ন পাঠান। আমি সেটি বিশ্লেষণ করব।',
      questions: ['আমার কাছে একটি FIR আছে', 'একটি জামিনের আবেদনের খসড়া তৈরি করুন', 'একটি নোটিশ বুঝিয়ে দিন'],
    },
    Assamese: {
      text: 'নমস্কাৰ, মই casemate। গোচৰৰ কাগজ, জাননী, বা আপোনাৰ প্ৰশ্ন পঠিয়াওক। মই বিশ্লেষণ কৰিম।',
      questions: ['মোৰ ওচৰত এখন FIR আছে', 'জামিন আবেদনৰ খসড়া বনাওক', 'এখন জাননী বুজাই দিয়ক'],
    },
    Odia: {
      text: 'ନମସ୍କାର, ମୁଁ casemate। ମାମଲାର କାଗଜ, ନୋଟିସ କିମ୍ବା ଆପଣଙ୍କ ପ୍ରଶ୍ନ ପଠାନ୍ତୁ। ମୁଁ ବିଶ୍ଳେଷଣ କରିବି।',
      questions: ['ମୋ ପାଖରେ ଏକ FIR ଅଛି', 'ଏକ ଜାମିନ ଆବେଦନର ଖସଡ଼ା ଲେଖନ୍ତୁ', 'ଏକ ନୋଟିସ ବୁଝାନ୍ତୁ'],
    },
    Marathi: {
      text: 'नमस्कार, मी casemate आहे. केसची कागदपत्रे, नोटीस किंवा प्रश्न पाठवा. मी त्याचे विश्लेषण करेन.',
      questions: ['माझ्याकडे एक FIR आहे', 'जामीन अर्जाचा मसुदा तयार करा', 'एक नोटीस समजावून सांगा'],
    },
    Gujarati: {
      text: 'નમસ્તે, હું casemate છું. કેસના કાગળ, નોટિસ અથવા તમારો પ્રશ્ન મોકલો. હું તેનું વિશ્લેષણ કરીશ.',
      questions: ['મારી પાસે એક FIR છે', 'જામીન અરજીનો મુસદ્દો બનાવો', 'એક નોટિસ સમજાવો'],
    },
    Punjabi: {
      text: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਮੈਂ casemate ਹਾਂ। ਕੇਸ ਦੀਆਂ ਫਾਈਲਾਂ, ਨੋਟਿਸ ਜਾਂ ਆਪਣਾ ਸਵਾਲ ਭੇਜੋ। ਮੈਂ ਉਸਦਾ ਵਿਸ਼ਲੇਸ਼ਣ ਕਰਾਂਗਾ।',
      questions: ['ਮੇਰੇ ਕੋਲ ਇੱਕ FIR ਹੈ', 'ਜ਼ਮਾਨਤ ਅਰਜ਼ੀ ਦਾ ਖਰੜਾ ਬਣਾਓ', 'ਇੱਕ ਨੋਟਿਸ ਸਮਝਾਓ'],
    },
    Urdu: {
      text: 'السلام علیکم، میں casemate ہوں۔ مقدمے کی فائلیں، نوٹس، یا اپنا سوال بھیجیں۔ میں اس کا تجزیہ کروں گا۔',
      questions: ['میرے پاس ایک FIR ہے', 'ضمانت کی درخواست کا مسودہ بنائیں', 'ایک نوٹس سمجھائیں'],
    },
    Telugu: {
      text: 'నమస్కారం, నేను casemate. కేసు పత్రాలు, నోటీసు లేదా మీ ప్రశ్న పంపండి. నేను విశ్లేషిస్తాను.',
      questions: ['నా దగ్గర ఒక FIR ఉంది', 'బెయిల్ దరఖాస్తు డ్రాఫ్ట్ రాయండి', 'ఒక నోటీసును వివరించండి'],
    },
    Tamil: {
      text: 'வணக்கம், நான் casemate. வழக்கு ஆவணங்கள், நோட்டீஸ் அல்லது உங்கள் கேள்வியை அனுப்புங்கள். நான் பகுப்பாய்வு செய்கிறேன்.',
      questions: ['என்னிடம் ஒரு FIR உள்ளது', 'ஜாமின் மனு வரைவு எழுதுங்கள்', 'ஒரு நோட்டீஸை விளக்குங்கள்'],
    },
    Kannada: {
      text: 'ನಮಸ್ಕಾರ, ನಾನು casemate. ಪ್ರಕರಣದ ದಾಖಲೆಗಳು, ನೋಟಿಸ್ ಅಥವಾ ನಿಮ್ಮ ಪ್ರಶ್ನೆಯನ್ನು ಕಳುಹಿಸಿ. ನಾನು ವಿಶ್ಲೇಷಿಸುತ್ತೇನೆ.',
      questions: ['ನನ್ನ ಬಳಿ ಒಂದು FIR ಇದೆ', 'ಜಾಮೀನು ಅರ್ಜಿಯ ಕರಡು ಬರೆಯಿರಿ', 'ಒಂದು ನೋಟಿಸ್ ಅನ್ನು ವಿವರಿಸಿ'],
    },
    Malayalam: {
      text: 'നമസ്കാരം, ഞാൻ casemate ആണ്. കേസ് രേഖകൾ, നോട്ടീസ് അല്ലെങ്കിൽ ചോദ്യം അയയ്ക്കുക. ഞാൻ വിശകലനം ചെയ്യും.',
      questions: ['എന്റെ കൈയിൽ ഒരു FIR ഉണ്ട്', 'ജാമ്യാപേക്ഷയുടെ കരട് എഴുതുക', 'ഒരു നോട്ടീസ് വിശദീകരിക്കുക'],
    },
  };
  return pack[language] || {
    text: 'Hi, I am casemate. Send the case papers, a notice, or your question, and I will analyse it.',
    questions: ['I have an FIR to review', 'Draft a bail application', 'Explain a legal notice'],
  };
};
