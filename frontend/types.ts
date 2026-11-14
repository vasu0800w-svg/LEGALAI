/** Who is using the app. Advocates draft pleadings; judges draft judgments and orders. */
export type UserMode = 'advocate' | 'judge';

export const normalizeUserMode = (value: unknown): UserMode =>
  value === 'judge' ? 'judge' : 'advocate';

export interface User {
  id: string;
  name: string;
  email: string;
  plan: 'free' | 'starter' | 'basic' | 'pro' | 'annual' | 'custom';
  customPlan?: {
    selection?: {
      photoUpload?: number;
      photoChatEnabled?: boolean;
      photoChat?: number;
      characters?: number;
      drafts?: number;
      devices?: number;
    };
    lines?: Array<{ id?: string; label?: string; rupees?: number }>;
    totalRupees?: number;
    taxPercent?: number;
  };
  role?: 'user' | 'admin';
  subscriptionExpiryDate?: number;
  /** Set by the server after a promo code. Not written by the app. */
  promoKind?: '14d' | 'forever';
  promoExpiresAt?: number | null;
  promoCode?: string;
  /** Server-granted add-on allowances. Clients cannot write this field. */
  addOns?: Record<string, number | string>;
  grantedLimits?: Record<string, number>;
  entitlementsVersion?: number;
  paymentStatus?: string;
  billingCycleStart?: number;
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
  /** Short follow-up questions shown under this AI reply */
  suggestedQuestions?: string[];
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
  /** Date printed on the client's uploaded case photo, kept as read */
  caseDate?: string;
  /** Which app mode this chat belongs to. Older chats have none and stay with advocates. */
  userMode?: UserMode;
}

export interface AppState {
  user: User | null;
  chatSessions: ChatSession[];
  activeSessionId: string | null;
  usageSeconds: number;
  isTimeUp: boolean;
  language: string;
}
