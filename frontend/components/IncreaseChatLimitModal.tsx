import React, { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { XIcon } from './Icons';
import {
  activeExtraSessionChars,
  formatInr,
  getPlanLimits,
  hasUnlimitedAccess,
  utcMonthEndMs,
} from '../utils/planLimits';
import { fetchEntitlements, EntitlementsSnapshot } from '../services/entitlementsService';
import { startRazorpayCheckout } from '../services/razorpayCheckout';

type Option = {
  id: string;
  name: string;
  price: number;
  extraSessionChars: number;
  features?: string[];
  eligible?: boolean;
};

type Props = {
  open: boolean;
  reason: 'near' | 'reached';
  usedChars: number;
  onClose: () => void;
};

const formatWhen = (ts?: number | null) => {
  if (!ts || ts <= 0) return null;
  return new Date(ts).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
};

export const IncreaseChatLimitModal = ({ open, reason, usedChars, onClose }: Props) => {
  const { user, createNewSession, setIsSubscriptionModalOpen } = useAppContext();
  const [snap, setSnap] = useState<EntitlementsSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [review, setReview] = useState(false);
  const [paying, setPaying] = useState(false);
  const [status, setStatus] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setReview(false);
    setStatus('');
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !paying) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, paying, onClose]);

  useEffect(() => {
    if (!open) return;
    void fetchEntitlements().then((next) => {
      if (!next?.ok) return;
      setSnap(next);
      const first = (next.chatLimit?.options || []).find((o) => o.eligible !== false);
      if (first) setSelectedId(first.id);
    });
  }, [open]);

  if (!open || !user) return null;

  const unlimited = hasUnlimitedAccess(user.email, user);
  const limits = getPlanLimits(user.plan, user.email, user);
  const extra = activeExtraSessionChars(user.addOns);
  const until = Number(snap?.chatLimit?.extraUntil || user.addOns?.extraSessionCharsUntil || utcMonthEndMs());
  const catalogOptions: Option[] = (snap?.chatLimit?.options || []).filter((o) => Number(o.extraSessionChars) > 0);
  const options: Option[] = catalogOptions.length > 0 ? catalogOptions : [
    { id: 'chat_chars_20k', name: 'Increase chat limit +20,000', price: 199, extraSessionChars: 20000 },
    { id: 'chat_chars_50k', name: 'Increase chat limit +50,000', price: 399, extraSessionChars: 50000 },
  ];
  const eligible = !unlimited && Number.isFinite(limits.maxSessionChars);
  const selected = options.find((o) => o.id === selectedId) || options[0];
  const newLimit = selected && Number.isFinite(limits.maxSessionChars)
    ? limits.maxSessionChars + selected.extraSessionChars
    : limits.maxSessionChars;

  const pay = async () => {
    if (!selected || paying || !eligible) return;
    if (!review) {
      setReview(true);
      return;
    }
    setPaying(true);
    setStatus('');
    try {
      await startRazorpayCheckout({
        kind: 'addon',
        addOnId: selected.id,
        description: `${selected.name} (rest of this month)`,
        prefill: { name: user.name || '', email: user.email || '' },
        onVerified: async () => {
          const next = await fetchEntitlements();
          if (next?.ok) setSnap(next);
          setStatus('Payment verified. The higher character limit applies to every chat until the date below. This conversation was not deleted.');
          setReview(false);
        },
      });
    } catch (err: any) {
      setStatus(err?.message || 'Unable to start payment. Razorpay must be configured on the server.');
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-ink/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="increase-chat-limit-title"
        className="bg-ink-soft rounded-t-3xl sm:rounded-3xl max-w-lg w-full border border-ink-border shadow-2xl max-h-[min(92dvh,820px)] flex flex-col overflow-hidden"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-ink-border">
          <div>
            <h2 id="increase-chat-limit-title" className="text-lg font-bold text-band">Increase Chat Limit</h2>
            <p className="text-xs text-band-mute mt-1">
              {reason === 'reached'
                ? 'This chat is at its character cap. Your messages and uploads stay on this account.'
                : 'This chat is close to its character cap. Extra capacity applies to every chat for the rest of this calendar month.'}
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="w-10 h-10 rounded-xl border border-ink-border text-band-dim" aria-label="Close">
            <XIcon className="w-5 h-5 mx-auto" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <section className="rounded-2xl border border-ink-border p-4 space-y-1">
            <p className="text-xs uppercase tracking-wider text-band-mute">This conversation</p>
            <p className="text-sm text-band">
              {usedChars.toLocaleString('en-IN')} / {Number.isFinite(limits.maxSessionChars) ? limits.maxSessionChars.toLocaleString('en-IN') : 'no cap'} characters
            </p>
            {extra > 0 ? (
              <p className="text-sm text-band-dim">
                Includes +{extra.toLocaleString('en-IN')} purchased this month, until {formatWhen(until) || 'the next calendar month'}.
              </p>
            ) : (
              <p className="text-sm text-band-dim">
                Extra characters last until {formatWhen(until)}. They do not become a permanent raise for future months.
              </p>
            )}
          </section>

          {!eligible ? (
            <p className="text-sm text-band-dim">Your current plan already has no chat character cap, so this add-on would not add capacity.</p>
          ) : options.length === 0 ? (
            <p className="text-sm text-band-dim">Chat-limit options are not configured on the server catalog yet.</p>
          ) : (
            <div className="space-y-2">
              {options.map((option) => {
                const nextMax = limits.maxSessionChars + option.extraSessionChars;
                const active = option.id === selected?.id;
                return (
                  <button
                    type="button"
                    key={option.id}
                    onClick={() => { setSelectedId(option.id); setReview(false); }}
                    className={`w-full text-left rounded-2xl border px-4 py-3 ${active ? 'border-white bg-ink-muted' : 'border-ink-border'}`}
                  >
                    <div className="flex justify-between gap-3">
                      <p className="text-sm font-semibold text-band">{option.name}</p>
                      <p className="text-sm text-band">{formatInr(option.price)} / month</p>
                    </div>
                    <p className="text-xs text-band-mute mt-1">
                      Adds {option.extraSessionChars.toLocaleString('en-IN')} characters per chat. New cap: {nextMax.toLocaleString('en-IN')}.
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          {review && selected && eligible ? (
            <section className="rounded-2xl border border-ink-border p-4 space-y-1">
              <p className="text-sm font-semibold text-band">Review before payment</p>
              <p className="text-sm text-band-dim">You will pay {formatInr(selected.price)} for +{selected.extraSessionChars.toLocaleString('en-IN')} characters on every chat until {formatWhen(utcMonthEndMs())}.</p>
              <p className="text-sm text-band-dim">New limit after payment: {Number(newLimit).toLocaleString('en-IN')} characters per chat.</p>
              <p className="text-xs text-band-mute">Prepaid Razorpay charge for the rest of this calendar month. Casemate does not auto-renew this add-on. No extra tax is added unless a tax percent is configured. Refunds follow the refund policy.</p>
            </section>
          ) : null}

          {status ? <p className="text-sm text-band-dim">{status}</p> : null}
        </div>

        <div className="px-5 py-4 border-t border-ink-border space-y-2">
          {eligible && selected ? (
            <button
              type="button"
              disabled={paying}
              onClick={() => void pay()}
              className="w-full py-3.5 rounded-xl bg-[var(--btn-bg)] text-[var(--btn-fg)] font-bold disabled:opacity-60"
            >
              {paying ? 'Starting payment…' : review ? `Pay ${formatInr(selected.price)} with Razorpay` : 'Review and pay'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => { createNewSession(); onClose(); }}
            className="w-full py-3 rounded-xl border border-ink-border text-band text-sm"
          >
            Start a new chat
          </button>
          <button
            type="button"
            onClick={() => { setIsSubscriptionModalOpen(true); onClose(); }}
            className="w-full py-3 rounded-xl border border-ink-border text-band-dim text-sm"
          >
            View available plans
          </button>
          <button type="button" onClick={onClose} className="w-full py-2 text-sm text-band-mute">
            Return to this conversation
          </button>
        </div>
      </div>
    </div>
  );
};
