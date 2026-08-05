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
    // Dynamically fetch Gemini API Key from localStorage (set via Admin Panel) or fallback to env
    let apiKey = process.env.API_KEY;
    const savedKeys = localStorage.getItem('legalai_api_keys');
    if (savedKeys) {
      try {
        const parsed = JSON.parse(savedKeys);
        if (parsed.geminiApiKey) {
          apiKey = parsed.geminiApiKey;
        }
      } catch (e) {
        console.error("Error reading saved keys", e);
      }
    }

    const ai = new GoogleGenAI({ apiKey: apiKey || '', vertexai: true });
    const currentParts: any[] = [];

    // Helper to convert file to base64
    const fileToBase64 = async (file: File): Promise<string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
          const result = reader.result as string;
          // Extract just the base64 data part
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
        finalPromptText += `${msg.role === 'user' ? 'Advocate' : 'LegalAI'}: ${msg.text}\n`;
      });
      finalPromptText += "--- End Context ---\n\n";
    }

    // Add predefined template content if selected with strict boundary rules
    if (templateContent) {
      finalPromptText += `--- REFERENCE FORMAT STRUCTURE ONLY (DO NOT COPY THIS TEXT/CONTENT, USE ONLY FOR LAYOUT) ---\n${templateContent}\n--- END TEMPLATE STRUCTURE ---\n\n`;
    }

    if (isGenerateDocument) {
      finalPromptText += `
TASK: Generate a comprehensive legal document based on the ENTIRE conversation history, provided case files, and instructions.
INSTRUCTIONS:
1. Synthesize all facts, evidence, and context from the previous conversation history and case files.
2. STRICT SEPARATION RULE: If format reference files or a format template are provided above, use them **ONLY AND ONLY for layout, headings structure, and formatting style**. Do NOT copy or mix the sample text, names, or placeholder details from the template into the final document. The factual content must come entirely from the case files and user prompt.
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

    // Call the Gemini API with gemini-3.6-flash model
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: {
        role: 'user',
        parts: currentParts,
      },
      config: {
        systemInstruction: 'You are LegalAI, an expert legal assistant and drafter. You help advocates analyze cases, extract facts, and draft documents with precise formatting based on their preferences. You strictly separate formatting templates from factual case content and leave missing fields blank with underscores.',
      }
    });

    return response.text || 'No response generated.';
  } catch (error) {
    console.error('Error calling Gemini:', error);
    return 'An error occurred while processing your request. Please ensure your files are valid and try again.';
  }
};