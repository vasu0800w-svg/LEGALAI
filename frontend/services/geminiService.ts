import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import { Message } from '../types';

export const generateLegalResponse = async (
  prompt: string,
  history: Message[],
  caseFiles: File[],
  formatFiles: File[],
  templateContent: string | null,
  isGenerateDocument: boolean,
  language: string
): Promise<string> => {
  try {
    // .env file se direct API Key utha rahe hain (Baki sab code original hai)
    const apiKey = (import.meta as any).env.VITE_GEMINI_API_KEY;

    if (!apiKey) {
      return language === 'Hindi'
        ? "त्रुटि: जेमिनी API की (Gemini API Key) .env फाइल में गायब है!"
        : "Error: Gemini API Key is missing in the .env file!";
    }

    const ai = new GoogleGenAI({ apiKey });
    const currentParts: any[] = [];

    // Helper to convert file to base64
    const fileToBase64 = async (file: File): Promise<string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
      });
    };

    // Process case files (Uploader 1)
    for (const file of caseFiles) {
      const base64 = await fileToBase64(file);
      currentParts.push({
        inlineData: {
          mimeType: file.type || 'application/octet-stream',
          data: base64,
        },
      });
    }

    // Process format reference files (Uploader 2)
    for (const file of formatFiles) {
      const base64 = await fileToBase64(file);
      currentParts.push({
        inlineData: {
          mimeType: file.type || 'application/octet-stream',
          data: base64,
        },
      });
    }

    // Construct the text prompt with history context
    let finalPromptText = '';
    
    if (history.length > 0) {
      finalPromptText += "--- Previous Conversation Context ---\n";
      history.forEach(msg => {
        finalPromptText += `${msg.role === 'user' ? 'Advocate' : 'casemate'}: ${msg.text}\n`;
      });
      finalPromptText += "--- End Context ---\n\n";
    }

    // Add predefined template content if selected with strict boundary rules
    if (templateContent) {
      finalPromptText += `--- REFERENCE FORMAT STRUCTURE ONLY (ABSOLUTELY DO NOT COPY OR USE ANY TEXT, NAMES, OR DETAILS FROM BELOW. USE IT 100% EXCLUSIVELY FOR VISUAL LAYOUT & HEADING PLACEMENT) ---\n${templateContent}\n--- END TEMPLATE STRUCTURE ---\n\n`;
    }

    if (isGenerateDocument) {
      finalPromptText += `
TASK: Generate a comprehensive legal document based on the ENTIRE conversation history, provided case files, and instructions.
INSTRUCTIONS:
1. Synthesize all facts, evidence, and context from the previous conversation history and case files.
2. STRICT ANTI-MIXING & ZERO PLAGIARISM RULE FOR TEMPLATES: If format reference files or a format template are provided above, you are strictly forbidden from copying any words, sentences, party names, facts, or placeholder contents from them. Treat the template purely as an invisible skeleton/blueprint for heading placement. All factual narrative, names, and details must come strictly from the case files and user prompt.
3. MISSING DETAILS RULE (CRITICAL): If any specific information such as date (दिनांक), location/place (स्थान), or specific identification numbers are NOT provided in the case files or prompt, do NOT invent them and do NOT write instructions like "yahan date dale". Instead, leave them completely blank using underscores or empty spaces (e.g., दिनांक:- ________ or स्थान:- ________) so the advocate can fill them manually later.
4. Draft the final document based on the user's request below, strictly adhering to the style/structure of the format reference/template without mixing its sample content.
5. FORMATTING RULES (CRITICAL):
   - You MUST use [CENTER]text[/CENTER] for Court Names, Main Titles, "PRAYER", and "VERIFICATION".
   - You MUST use [RIGHT]text[/RIGHT] for Signatures, Dates, Place, or any text that should be right-aligned.
   - For elements that must appear on the EXACT SAME LINE (e.g., Date/Place on the left and Signature/Name on the right), you MUST use the format: 
     [ROW]
     स्थान:- ________
     दिनांक:- ________
     |
     वादीगण / हस्ताक्षर
     [/ROW]
   - The system will automatically convert [ROW] into a strict flexbox container (\`display: flex; justify-content: space-between;\`) to prevent line breaks.
   - You MUST use **text** for bolding important terms, names, and headings.
   - You MUST use [U]text[/U] for underlining text.
   - Combine them if needed, e.g., [CENTER]**[U]HEADING[/U]**[/CENTER].
6. Output ONLY the document content. Do not include conversational filler like "Here is the document".
7. Ensure the output is professional, legally sound, and ready for review.

USER REQUEST: ${prompt}
      `;
    } else {
      finalPromptText += `USER REQUEST: ${prompt}`;
    }

    // Apply language preference
    if (language !== 'English') {
      finalPromptText += `\n\nIMPORTANT: Please provide your entire response in ${language}.`;
    }

    currentParts.push({ text: finalPromptText });

    // Call Gemini API with gemini-3.6-flash model
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: currentParts,
      config: {
        systemInstruction: 'You are casemate, an expert legal assistant and drafter. You help advocates analyze cases, extract facts, and draft documents with precise formatting based on their preferences. ABSOLUTE RULE: When a format template or reference file is provided, use it ONLY for layout structure and headings placement. NEVER copy its sample text, names, or factual contents. All facts must come from case files. Leave missing fields blank with underscores.',
      }
    });

    return response.text || 'No response generated.';
  } catch (error: any) {
    console.error('Error calling Gemini:', error);
    return `API Error: ${error.message || JSON.stringify(error)}`;
  }
};