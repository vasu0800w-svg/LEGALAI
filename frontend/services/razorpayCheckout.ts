/**
 * Razorpay Standard Web Checkout helpers (KEY_ID only on frontend).
 */

import { Capacitor } from '@capacitor/core';

export type RazorpaySuccessPayload = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

export type VerifiedPlan = {
  planId: string;
  subscriptionExpiryDate: number | null;
  addOnId?: string;
};

type CheckoutArgs = {
  /** Server prices the plan — the phone never sends an amount. */
  planId?: string;
  kind?: 'plan' | 'addon' | 'custom';
  addOnId?: string;
  selection?: Record<string, unknown>;
  description: string;
  prefill?: { name?: string; email?: string; contact?: string };
  onVerified: (payload: RazorpaySuccessPayload, plan: VerifiedPlan) => void | Promise<void>;
};

const apiBase = () => (import.meta as any).env?.VITE_API_BASE_URL || '';

const authHeader = async (): Promise<Record<string, string>> => {
  const { auth } = await import('./firebaseService');
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    throw new Error('Please sign in again before paying.');
  }
  return { Authorization: `Bearer ${token}` };
};

async function ensureCheckoutScript(): Promise<boolean> {
  if ((window as any).Razorpay) return true;
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export async function startRazorpayCheckout(args: CheckoutArgs): Promise<void> {
  const envKey = String((import.meta as any).env?.VITE_RAZORPAY_KEY_ID || '');

  const headers = await authHeader();

  const orderRes = await fetch(`${apiBase()}/api/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      planId: args.planId,
      kind: args.kind,
      addOnId: args.addOnId,
      selection: args.selection,
    }),
  });

  const orderData = await orderRes.json().catch(() => ({}));
  if (!orderRes.ok) {
    throw new Error(orderData?.message || 'Failed to create payment order.');
  }

  const loaded = await ensureCheckoutScript();
  if (!loaded || !(window as any).Razorpay) {
    throw new Error('Razorpay Checkout failed to load. Check your internet connection.');
  }

  // The order was created with the server key. Checkout must use that same key.
  const keyId = String(orderData.key_id || envKey);
  if (!keyId) {
    throw new Error('Razorpay key is missing. Add the live key on the server.');
  }
  const isTestKey = keyId.startsWith('rzp_test_');
  // Capacitor Android WebView hides UPI unless webview_intent is set (Razorpay docs).
  const isNativeWebView = Capacitor.isNativePlatform();

  const options = {
    key: keyId,
    amount: orderData.amount,
    currency: orderData.currency || 'INR',
    name: 'casemate Assistant',
    description: args.description,
    order_id: orderData.order_id,
    prefill: {
      name: args.prefill?.name || '',
      email: args.prefill?.email || '',
      contact: args.prefill?.contact || '',
    },
    // Test mode: real UPI IDs fail with "Invalid UPI" — prefer card for testing
    ...(isTestKey
      ? {
          method: {
            netbanking: true,
            card: true,
            upi: false,
            wallet: true,
          },
        }
      : {
          method: {
            netbanking: true,
            card: true,
            upi: true,
            wallet: true,
          },
        }),
    // Required for UPI Intent inside Android/iOS in-app WebViews
    ...(isNativeWebView && !isTestKey ? { webview_intent: true } : {}),
    theme: { color: '#0a0a0a' },
    modal: {
      ondismiss: () => {
        console.info('[Razorpay] Checkout dismissed by user');
      },
    },
    handler: async (response: RazorpaySuccessPayload) => {
      try {
        const verifyRes = await fetch(`${apiBase()}/api/verify-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
          body: JSON.stringify({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          }),
        });
        const verifyData = await verifyRes.json().catch(() => ({}));
        if (!verifyRes.ok || !verifyData?.success) {
          alert(verifyData?.message || 'Payment verification failed. Please contact support.');
          return;
        }
        await args.onVerified(response, {
          planId: String(verifyData.planId || args.planId || ''),
          subscriptionExpiryDate: Number(verifyData.subscriptionExpiryDate) || null,
          addOnId: verifyData.addOnId ? String(verifyData.addOnId) : args.addOnId,
        });
      } catch (err: any) {
        console.error('[Razorpay] verify error', err);
        alert(err?.message || 'Could not verify payment.');
      }
    },
  };

  const rzp = new (window as any).Razorpay(options);
  rzp.on('payment.failed', (response: any) => {
    const desc = response?.error?.description || 'Payment failed';
    console.warn('[Razorpay] payment.failed', response?.error);
    alert(`Payment Failed: ${desc}`);
  });
  rzp.open();
}
