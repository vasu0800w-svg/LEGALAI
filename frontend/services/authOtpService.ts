const OTP_URL = 'https://asia-south1-legalai-78759.cloudfunctions.net/authOtp';

const postOtp = async (
  body: Record<string, string>,
  idToken?: string
): Promise<{ ok?: boolean; alreadyVerified?: boolean; message?: string }> => {
  const res = await fetch(OTP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || 'Could not complete that request.');
  }
  return data;
};

export const sendEmailOtp = (idToken: string) => postOtp({ action: 'send-email' }, idToken);

export const verifyEmailOtp = (idToken: string, code: string) =>
  postOtp({ action: 'verify-email', code }, idToken);

export const sendResetOtp = (email: string) => postOtp({ action: 'send-reset', email });

export const confirmResetOtp = (email: string, code: string, password: string) =>
  postOtp({ action: 'confirm-reset', email, code, password });

/** Indian mobiles are stored as +91 followed by 10 digits. */
export const toE164Phone = (raw: string): string => {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (String(raw || '').trim().startsWith('+') && digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }
  throw new Error('PHONE');
};
