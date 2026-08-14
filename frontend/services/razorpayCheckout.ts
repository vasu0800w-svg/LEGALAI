/**
 * Razorpay Standard Web Checkout helpers (KEY_ID only on frontend).
 */

export type RazorpaySuccessPayload = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type CheckoutArgs = {
  amountRupees: number;
  description: string;
  prefill?: { name?: string; email?: string; contact?: string };
  onVerified: (payload: RazorpaySuccessPayload) => void | Promise<void>;
};

const apiBase = () => (import.meta as any).env?.VITE_API_BASE_URL || '';

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
  const keyId = (import.meta as any).env?.VITE_RAZORPAY_KEY_ID as string | undefined;
  if (!keyId) {
    throw new Error('VITE_RAZORPAY_KEY_ID is missing. Add it to frontend/.env');
  }

  const amountPaise = Math.round(Number(args.amountRupees) * 100);
  if (!Number.isFinite(amountPaise) || amountPaise < 100) {
    throw new Error('Minimum payment amount is ₹1 (100 paise).');
  }

  const orderRes = await fetch(`${apiBase()}/api/create-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: amountPaise,
      currency: 'INR',
      receipt: `rcpt_${Date.now()}`.slice(0, 40),
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

  const isTestKey = String(keyId).startsWith('rzp_test_');

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
      : {}),
    theme: { color: '#2563eb' },
    modal: {
      ondismiss: () => {
        console.info('[Razorpay] Checkout dismissed by user');
      },
    },
    handler: async (response: RazorpaySuccessPayload) => {
      try {
        const verifyRes = await fetch(`${apiBase()}/api/verify-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
        await args.onVerified(response);
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
