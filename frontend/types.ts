export interface User {
  id: string;
  name: string;
  email: string;
  plan: 'free' | 'basic' | 'pro' | 'annual';
  role?: 'user' | 'admin';
  subscriptionExpiryDate?: number;
}

export interface Attachment {
  name: string;
  type: 'case' | 'format';
  /** Firebase Storage download URL (persisted so AI / user can reopen later) */
  url?: string;
  storagePath?: string;
  mimeType?: string;
  size?: number;
}

/** Anonymized drafting memory from a completed case chat (no party PII) */
export interface CaseLearning {
  id: string;
  caseType: string;
  notes: string;
  updatedAt: number;
  useCount: number;
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  attachments?: Attachment[];
  /** AI-extracted facts from case photos/files in this message (kept for later turns) */
  evidenceNotes?: string;
  isDocument?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
}

export interface AppState {
  user: User | null;
  chatSessions: ChatSession[];
  activeSessionId: string | null;
  usageSeconds: number;
  isTimeUp: boolean;
  language: string;
}
