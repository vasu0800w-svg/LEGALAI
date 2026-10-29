import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { PENDING_PROMO_KEY } from '../services/promoService';

type Props = {
  variant?: 'dark' | 'light';
  onNeedSignIn?: () => void;
};

export const PromoCodeForm = ({ variant = 'dark', onNeedSignIn }: Props) => {
  const { user, redeemPromoCode } = useAppContext();
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [note, setNote] = useState('');
  const light = variant === 'light';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const next = code.trim();
    if (!next || status === 'sending') return;
    if (!user) {
      try { sessionStorage.setItem(PENDING_PROMO_KEY, next); } catch { /* ignore */ }
      onNeedSignIn?.();
      return;
    }
    setStatus('sending');
    setNote('');
    try {
      const result = await redeemPromoCode(next);
      if (result.alreadyUnlimited || result.alreadyActive) {
        setNote(result.alreadyUnlimited
          ? 'This account already has unlimited access.'
          : 'Unlimited access is already on for this account.');
      } else if (result.kind === '14d' && result.expiresAt) {
        const when = new Date(result.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
        setNote(`Unlimited access is on until ${when}.`);
      } else {
        setNote('Unlimited access is on. It stays until the always promo code is changed.');
      }
      setCode('');
      setStatus('done');
    } catch (err) {
      setStatus('error');
      setNote(err instanceof Error ? err.message : 'That promo code is not valid.');
    }
  };

  return (
    <form onSubmit={submit} className={light ? 'cm-form' : 'space-y-3 text-left'}>
      <label className={light ? undefined : 'block text-sm text-band-mute'}>
        Have a promo code?
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="Enter promo code"
          className={light ? undefined : 'mt-2 w-full rounded-xl border border-ink-border bg-ink px-4 py-3 text-band outline-none focus:border-white/40'}
        />
      </label>
      <button
        type="submit"
        disabled={status === 'sending'}
        className={light ? 'cm-btn cm-btn-light' : 'w-full rounded-xl border border-ink-border py-3 text-sm font-semibold text-band hover:bg-ink-muted disabled:opacity-60'}
      >
        {status === 'sending' ? 'Checking…' : 'Apply promo code'}
      </button>
      {note && <p className={light ? 'cm-form-note' : 'text-sm text-band-mute'}>{note}</p>}
    </form>
  );
};
