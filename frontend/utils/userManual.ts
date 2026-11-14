export type ManualSection = {
  title: string;
  paragraphs: string[];
};

export const userManual: Record<string, { heading: string; intro: string; sections: ManualSection[] }> = {
  English: {
    heading: 'User manual',
    intro: 'casemate is an AI legal assistant for advocates. Use it to analyse case papers, draft court documents in your format, and edit them before download. This is a drafting aid — always review the draft before filing.',
    sections: [
      {
        title: '1. Getting started',
        paragraphs: [
          'Create an account with your name, email, and password, then sign in. Use Forgot password if you cannot sign in.',
          'Open Settings to choose the app language. AI replies and drafts follow that language, including the regional languages used in Indian courts.',
          'Your chats are saved to the cloud on your account so you can continue on another phone or the website.',
        ],
      },
      {
        title: '2. Chats and cases',
        paragraphs: [
          'Tap New Chat to start a matter. Recent cases stay in the sidebar. Tap a case to reopen it, rename it, or delete it.',
          'Type a legal question or instructions in the message box and send. Tap the mic to speak instead of typing.',
          'You can stop a reply while it is generating. You can also edit a message you already sent to regenerate the answer.',
        ],
      },
      {
        title: '3. Case files, formats, and templates',
        paragraphs: [
          'Upload Case: add photos or PDFs of FIRs, notices, orders, and other papers. casemate reads them as evidence and must not invent facts.',
          'Upload Format: add a past draft used only as a blank layout. The new document copies headings, numbering, prayer, and verification — not names or facts from that old case.',
          'Select Template: use built-in layouts such as Bail Application, Legal Notice (Sec 138), Divorce Petition, or NDA.',
          'Ask casemate to analyse the papers, answer a question, or generate a full document.',
        ],
      },
      {
        title: '4. Generated documents',
        paragraphs: [
          'When a document is generated it appears as pages in the chat. You can Copy, Share, Edit, Download DOCX, or Download PDF (Hindi/Unicode is supported).',
          'Open Edit to work in the full-page editor. Changes are saved only when you tap Save. The back arrow discards unsaved edits.',
        ],
      },
      {
        title: '5. Document editor',
        paragraphs: [
          'Formatting: Bold, Italic, Underline, alignment (Left, Center, Right, Justify), bullets, numbers, indent, and outdent.',
          'Undo / Redo: restore earlier edits inside the editor.',
          'Same-line placement (no extra spaces): type the left words first (for example Place: Delhi). Then tap Same line → Right (or Tab) — the cursor jumps to the right of that line so you can type Date or a signature. Tap Centre for the middle. The highlighted button and the dashed column show where you are typing. Tap Left, or Backspace in an empty centre/right box, to return to a normal line. Tab moves between those parts. Enter starts a new line below.',
          'Find & Replace: tap the search icon (or Ctrl/Cmd+F). It searches every page. Use Next / Previous, Replace, or Replace all. Match case is optional.',
          'Zoom: use − / % / + in the top bar, pinch with two fingers, or Ctrl/Cmd + scroll. Tap the percent to reset.',
          'Page setup: font size, Legal / Letter / A4, and margins. शेष // पर marks a continued page.',
          'Always tap Save before you leave the editor if you want to keep the changes.',
        ],
      },
      {
        title: '6. Plans and limits',
        paragraphs: [
          'Free: 1 hour per day and 5 drafts per month, with character and photo limits per chat.',
          'Casemate Starter ₹999/month: 30 completed drafts, 50 photos per upload, no per-chat photo cap, 1,00,000 characters per chat, no daily AI cap, up to 2 devices.',
          'Casemate Basic ₹2,999/month: 50 completed drafts, 80 photos per upload, 3,00,000 characters per chat, up to 3 devices.',
          'Casemate Pro ₹4,999/month: unlimited drafts under monthly AI fair use, about 200 photos per upload, larger chats, up to 5 devices.',
          'Annual ₹34,990/year is the same as Pro. Twelve months of Pro is ₹59,988, so the annual saving is ₹24,998 (about 41.7%) before tax.',
          'Pay with Razorpay. Access lasts until the date stored on the account. There is no automatic renewal in the app.',
        ],
      },
      {
        title: '7. Privacy and support',
        paragraphs: [
          'Case files, chats, and drafts stay on your account. Party names and case facts are not used as shared learning. Only anonymized heading/style patterns may be remembered to improve your future drafts.',
          'Change password or request data/account deletion from Settings. Privacy policy is also in Settings.',
          'For help email casemateyour@gmail.com from Contact support.',
        ],
      },
    ],
  },
  Hindi: {
    heading: 'उपयोगकर्ता पुस्तिका',
    intro: 'casemate अधिवक्ताओं के लिए एक एआई कानूनी सहायक है। केस कागजात का विश्लेषण करें, अपने प्रारूप में न्यायालय दस्तावेज़ तैयार करें, और डाउनलोड से पहले संपादित करें। यह केवल ड्राफ्टिंग सहायता है — दाखिल करने से पहले ड्राफ्ट अवश्य जाँचें।',
    sections: [
      {
        title: '1. शुरुआत',
        paragraphs: [
          'नाम, ईमेल और पासवर्ड से खाता बनाएँ, फिर साइन इन करें। साइन इन न हो तो पासवर्ड भूल गए का उपयोग करें।',
          'सेटिंग्स में ऐप की भाषा चुनें। एआई के उत्तर और ड्राफ्ट उसी भाषा में आते हैं, जिनमें भारत के क्षेत्रीय भाषाएँ भी शामिल हैं।',
          'चैट आपके खाते पर क्लाउड में सहेजी जाती हैं, ताकि दूसरी फ़ोन या वेबसाइट पर काम जारी रह सके।',
        ],
      },
      {
        title: '2. चैट और मामले',
        paragraphs: [
          'नई चैट से नया मामला शुरू करें। हाल के मामले साइडबार में रहते हैं। मामला खोलें, नाम बदलें, या हटाएँ।',
          'संदेश बॉक्स में प्रश्न या निर्देश लिखकर भेजें। टाइप करने की जगह माइक से बोल भी सकते हैं।',
          'उत्तर बनते समय उसे रोक सकते हैं। भेजा हुआ संदेश संपादित कर नया उत्तर भी ले सकते हैं।',
        ],
      },
      {
        title: '3. केस फ़ाइल, प्रारूप और टेम्पलेट',
        paragraphs: [
          'केस अपलोड: FIR, नोटिस, आदेश आदि की फ़ोटो या PDF जोड़ें। casemate इन्हें साक्ष्य की तरह पढ़ता है और तथ्य गढ़ता नहीं है।',
          'प्रारूप अपलोड: पुराना ड्राफ्ट केवल खाली लेआउट के लिए जोड़ें। नया दस्तावेज़ शीर्षक, नंबरिंग, प्रार्थना और सत्यापन की नकल करता है — उस पुराने मामले के नाम या तथ्य नहीं।',
          'टेम्पलेट चुनें: जमानत याचिका, कानूनी नोटिस (धारा 138), तलाक याचिका, या NDA जैसे बने-बनाए प्रारूप।',
          'कागजात का विश्लेषण, प्रश्न का उत्तर, या पूरा दस्तावेज़ बनवाने के लिए casemate से कहें।',
        ],
      },
      {
        title: '4. बने हुए दस्तावेज़',
        paragraphs: [
          'दस्तावेज़ चैट में पृष्ठों के रूप में दिखता है। कॉपी, शेयर, संपादित करें, DOCX या PDF डाउनलोड करें (हिंदी/यूनिकोड समर्थित)।',
          'पूरे पेज संपादक के लिए संपादित करें खोलें। परिवर्तन तभी सहेजते हैं जब आप सहेजें दबाएँ। पीछे का तीर बिना सहेजे संपादन छोड़ देता है।',
        ],
      },
      {
        title: '5. दस्तावेज़ संपादक',
        paragraphs: [
          'फ़ॉर्मैट: बोल्ड, तिरछा, रेखांकित, संरेखण (बाएँ, मध्य, दाएँ, जस्टिफ़ाई), बुलेट, नंबर, इंडेंट।',
          'पूर्ववत / फिर से: संपादक के अंदर पिछला बदलाव लौटाएँ।',
          'एक ही पंक्ति (अधिक स्पेस के बिना): पहले बाएँ शब्द लिखें (जैसे Place: Delhi)। फिर एक पंक्ति → दाएँ (या Tab) दबाएँ — कर्सर उसी पंक्ति के दाएँ छोर पर चला जाता है, जहाँ Date या हस्ताक्षर लिखें। मध्य के लिए मध्य दबाएँ। हाइलाइट बटन और धराशायी कॉलम बताते हैं आप कहाँ लिख रहे हैं। बाएँ दबाएँ, या खाली मध्य/दाएँ बॉक्स में बैकस्पेस, तो पंक्ति सामान्य हो जाती है। Tab उन हिस्सों के बीच घूमता है। Enter नीचे नई पंक्ति खोलता है।',
          'खोजें और बदलें: खोज आइकन (या Ctrl/Cmd+F)। यह सभी पृष्ठों में खोजता है। अगला / पिछला, बदलें, या सभी बदलें। केस मिलाएँ वैकल्पिक है।',
          'ज़ूम: ऊपर − / % / +, दो अंगुलों से पिंच, या Ctrl/Cmd + स्क्रॉल। प्रतिशत पर टैप कर रीसेट करें।',
          'पेज सेटअप: फ़ॉन्ट साइज़, Legal / Letter / A4, और मार्जिन। शेष // पर जारी पृष्ठ का चिह्न है।',
          'संपादक छोड़ने से पहले सहेजें अवश्य दबाएँ यदि परिवर्तन रखने हैं।',
        ],
      },
      {
        title: '6. योजनाएँ और सीमाएँ',
        paragraphs: [
          'मुफ़्त: प्रतिदिन 1 घंटा और महीने में 5 ड्राफ्ट, चैट की वर्ण और फ़ोटो सीमा के साथ।',
          'Casemate Starter ₹999/माह: 30 पूर्ण ड्राफ्ट, प्रति अपलोड 50 फ़ोटो, चैट पर फ़ोटो सीमा नहीं, 1,00,000 अक्षर प्रति चैट, दैनिक AI सीमा नहीं, अधिकतम 2 डिवाइस।',
          'Casemate Basic ₹2,999/माह: 50 पूर्ण ड्राफ्ट, प्रति अपलोड 80 फ़ोटो, 3,00,000 अक्षर प्रति चैट, अधिकतम 3 डिवाइस।',
          'Casemate Pro ₹4,999/माह: मासिक AI उचित-उपयोग के अधीन असीमित ड्राफ्ट, प्रति अपलोड लगभग 200 फ़ोटो, बड़ी चैट, अधिकतम 5 डिवाइस।',
          'वार्षिक ₹34,990/वर्ष प्रो के समान है। बारह महीने का प्रो ₹59,988 है, वार्षिक बचत ₹24,998 (लगभग 41.7%) कर से पहले।',
          'भुगतान Razorpay से। पहुँच खाते पर दर्ज तिथि तक रहती है। ऐप में स्वतः नवीनीकरण नहीं है।',
        ],
      },
      {
        title: '7. गोपनीयता और सहायता',
        paragraphs: [
          'केस फ़ाइलें, चैट और ड्राफ्ट आपके खाते पर रहते हैं। पक्षकारों के नाम और केस तथ्य साझा सीखने में नहीं जाते। केवल अनामित शीर्षक/शैली याद रह सकती है ताकि आगे के ड्राफ्ट बेहतर हों।',
          'सेटिंग्स से पासवर्ड बदलें या डेटा/खाता हटाने का अनुरोध करें। गोपनीयता नीति भी सेटिंग्स में है।',
          'सहायता के लिए सपोर्ट से संपर्क करें पर casemateyour@gmail.com लिखें।',
        ],
      },
    ],
  },
};
