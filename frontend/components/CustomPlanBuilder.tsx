import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { formatInr } from '../utils/planLimits';
import { sendPurchaseEmail } from '../services/emailService';
import { startRazorpayCheckout } from '../services/razorpayCheckout';
import {
  CustomPlanCatalog,
  CustomPlanPricing,
  CustomPlanSelection,
  CustomQuote,
  DEFAULT_CUSTOM_PRICING,
  clearPendingCustomSelection,
  defaultCustomSelection,
  fetchCustomPlanCatalog,
  quoteCustomPlan,
  readPendingCustomSelection,
  writePendingCustomSelection,
} from '../services/customPlanService';

type Props = {
  variant?: 'landing' | 'app';
  onNeedSignIn?: () => void;
  onPurchased?: () => void;
};

const Stepper = ({
  label,
  hint,
  unitPrice,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
}: {
  label: string;
  hint: string;
  unitPrice: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  formatValue?: (n: number) => string;
}) => {
  const display = formatValue ? formatValue(value) : String(value);
  return (
    <div className="rounded-2xl border border-ink-border bg-ink-muted/40 p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-band">{label}</p>
          <p className="text-xs text-band-mute mt-1 leading-5">{hint}</p>
        </div>
        <p className="text-xs text-band-dim whitespace-nowrap">{unitPrice}</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - step))}
          className="w-10 h-10 rounded-xl border border-ink-border text-band text-lg disabled:opacity-40"
        >
          −
        </button>
        <p className="flex-1 text-center text-lg font-semibold text-band tabular-nums">{display}</p>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + step))}
          className="w-10 h-10 rounded-xl border border-ink-border text-band text-lg disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
};

export const CustomPlanBuilder = ({ variant = 'app', onNeedSignIn, onPurchased }: Props) => {
  const { user, upgradeToPro } = useAppContext();
  const [pricing, setPricing] = useState<CustomPlanPricing>(DEFAULT_CUSTOM_PRICING);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [catalogOk, setCatalogOk] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [catalogTick, setCatalogTick] = useState(0);
  const [selection, setSelection] = useState<CustomPlanSelection>(() => readPendingCustomSelection() || defaultCustomSelection());
  const [quote, setQuote] = useState<CustomQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [review, setReview] = useState(false);
  const [paying, setPaying] = useState(false);
  const [status, setStatus] = useState('');
  const warnClass = variant === 'landing' ? 'text-amber-800' : 'text-amber-300';

  useEffect(() => {
    let cancelled = false;
    setCatalogError('');
    void fetchCustomPlanCatalog()
      .then((catalog: CustomPlanCatalog) => {
        if (cancelled || !catalog?.pricing) return;
        setPricing(catalog.pricing);
        setNotes(catalog.notes || {});
        setCatalogOk(true);
        const pending = readPendingCustomSelection();
        if (!pending && catalog.defaultSelection) {
          setSelection(catalog.defaultSelection);
        }
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setCatalogOk(false);
        setCatalogError(err?.message || 'Could not load live Custom Plan pricing.');
      });
    return () => { cancelled = true; };
  }, [catalogTick]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setQuoting(true);
      void quoteCustomPlan(selection)
        .then((next) => {
          if (cancelled) return;
          setQuote(next);
          setQuoteError(next.ok ? '' : (next.errors || []).join(' '));
        })
        .catch((err) => {
          if (cancelled) return;
          setQuoteError(err?.message || 'Could not reach the pricing service.');
        })
        .finally(() => {
          if (!cancelled) setQuoting(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [selection, catalogTick]);

  const patch = useCallback((partial: Partial<CustomPlanSelection>) => {
    setSelection((prev) => ({ ...prev, ...partial }));
    setReview(false);
    setStatus('');
  }, []);

  const reset = () => {
    setSelection(defaultCustomSelection(pricing));
    setReview(false);
    setStatus('');
    clearPendingCustomSelection();
  };

  const total = quote?.ok ? quote.totalRupees : 0;
  const extraChars = Math.max(0, selection.characters - pricing.characters.included);
  const extraDevices = Math.max(0, selection.devices - pricing.devices.included);

  const summaryLines = useMemo(() => {
    const rows = [
      `${selection.photoUpload} photos per upload (total allowed in one attach)`,
      selection.photoChatEnabled
        ? `${selection.photoChat} photos across the whole chat (flat feature)`
        : 'Chat photo cap follows the upload size (feature not selected)',
      `${selection.characters.toLocaleString('en-IN')} characters per chat (${pricing.characters.included.toLocaleString('en-IN')} included)`,
      `${selection.drafts} completed drafts each month (total quota)`,
      `${selection.devices} registered device${selection.devices === 1 ? '' : 's'} (${pricing.devices.included} included)`,
    ];
    return rows;
  }, [selection, pricing]);

  const beginCheckout = async () => {
    if (!quote?.ok || paying) return;
    if (!user) {
      writePendingCustomSelection(selection);
      onNeedSignIn?.();
      setStatus('Sign in to continue to Razorpay. Your selection is saved on this device.');
      return;
    }
    if (!review) {
      setReview(true);
      return;
    }
    setPaying(true);
    setStatus('');
    try {
      await startRazorpayCheckout({
        planId: 'custom',
        kind: 'custom',
        selection,
        description: 'Casemate custom plan (30 days prepaid)',
        prefill: { name: user.name || '', email: user.email || '' },
        onVerified: async (_payload, plan) => {
          clearPendingCustomSelection();
          if (user.email) {
            const expiryDate = plan.subscriptionExpiryDate || Date.now() + 30 * 24 * 60 * 60 * 1000;
            await sendPurchaseEmail(user.email, user.name || 'Advocate', 'Custom Plan', expiryDate);
          }
          upgradeToPro(plan.planId, plan.subscriptionExpiryDate);
          setStatus('Payment verified. Your custom limits are now on this account.');
          onPurchased?.();
        },
      });
    } catch (err: any) {
      setStatus(err?.message || 'Unable to start payment. Check that Razorpay is configured on the server.');
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className={variant === 'landing' ? 'cm-builder' : 'space-y-4'}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Stepper
          label="Photos per upload"
          hint={notes.photoUpload || 'Total photos allowed in one upload, in blocks of 10. This is not extra photos on top of another plan.'}
          unitPrice={`${formatInr(pricing.photoUpload.pricePerBlock)} / ${pricing.photoUpload.blockSize}`}
          value={selection.photoUpload}
          min={pricing.photoUpload.min}
          max={pricing.photoUpload.max}
          step={pricing.photoUpload.blockSize}
          onChange={(photoUpload) => patch({
            photoUpload,
            photoChat: Math.max(selection.photoChat, photoUpload),
          })}
        />
        <div className="rounded-2xl border border-ink-border bg-ink-muted/40 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-band">Total photos per chat</p>
              <p className="text-xs text-band-mute mt-1 leading-5">
                {notes.photoChat || 'Separate from photos-per-upload. Flat monthly charge, not per photo. The chat total cannot be lower than one upload.'}
              </p>
            </div>
            <p className="text-xs text-band-dim whitespace-nowrap">{formatInr(pricing.photoChat.price)} flat</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-band">
            <input
              type="checkbox"
              checked={selection.photoChatEnabled}
              onChange={(e) => patch({
                photoChatEnabled: e.target.checked,
                photoChat: Math.max(selection.photoChat, selection.photoUpload, pricing.photoChat.min),
              })}
            />
            Add this feature
          </label>
          {selection.photoChatEnabled ? (
            <Stepper
              label="Chat photo cap"
              hint="Total case photos allowed across the whole conversation."
              unitPrice="Included in the flat charge"
              value={Math.max(selection.photoChat, selection.photoUpload)}
              min={Math.max(pricing.photoChat.min, selection.photoUpload)}
              max={pricing.photoChat.max}
              step={pricing.photoChat.step}
              onChange={(photoChat) => patch({ photoChat })}
            />
          ) : (
            <p className="text-xs text-band-mute">Without this feature, the chat cap follows the upload size so one attach still fits. You are not charged twice for the same photos.</p>
          )}
        </div>
        <Stepper
          label="Characters per chat"
          hint={notes.characters || 'Total message-text characters in one chat. Image bytes are not characters. Only extra blocks above the included base are billed.'}
          unitPrice={`${formatInr(pricing.characters.pricePerBlock)} / ${pricing.characters.blockSize.toLocaleString('en-IN')} extra`}
          value={selection.characters}
          min={pricing.characters.min}
          max={pricing.characters.max}
          step={pricing.characters.blockSize}
          onChange={(characters) => patch({ characters })}
          formatValue={(n) => n.toLocaleString('en-IN')}
        />
        <Stepper
          label="Monthly drafting quota"
          hint={notes.drafts || 'Total completed drafts each month. A draft counts only after a successful generate. Failed requests do not keep a draft.'}
          unitPrice={`${formatInr(pricing.drafts.pricePerBlock)} / ${pricing.drafts.blockSize}`}
          value={selection.drafts}
          min={pricing.drafts.min}
          max={pricing.drafts.max}
          step={pricing.drafts.blockSize}
          onChange={(drafts) => patch({ drafts })}
        />
        <Stepper
          label="Registered devices"
          hint={notes.devices || 'Total devices that may use this account. First device included. Each install stores a random id — Casemate does not fingerprint hardware. Manage devices in Settings after you sign in.'}
          unitPrice={`${formatInr(pricing.devices.priceEach)} each extra`}
          value={selection.devices}
          min={pricing.devices.min}
          max={pricing.devices.max}
          step={1}
          onChange={(devices) => patch({ devices })}
        />
      </div>

      <div className="rounded-2xl border border-ink-border bg-ink-muted/40 p-4 space-y-2">
        <p className="text-sm font-semibold text-band">Selected configuration</p>
        <ul className="text-sm text-band-dim space-y-1">
          {summaryLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="text-xs text-band-mute">
          Included characters: {pricing.characters.included.toLocaleString('en-IN')}. Extra purchased: {extraChars.toLocaleString('en-IN')}.
          Extra devices: {extraDevices}. Daily AI stays at the Free allowance on a custom plan.
        </p>
      </div>

      <div className="rounded-2xl border border-ink-border p-4 space-y-2">
        <p className="text-sm font-semibold text-band">Monthly price (server quote)</p>
        {!catalogOk ? (
          <p className={warnClass}>
            {catalogError || 'Live catalog is unavailable. The total is not shown until the server returns a quote.'}
          </p>
        ) : null}
        {quoting && !quote?.ok ? <p className="text-sm text-band-mute">Pricing…</p> : null}
        {(quote?.ok ? quote.lines : []).map((line) => (
          <div key={line.id} className="flex justify-between gap-3 text-sm">
            <span className="text-band-dim">{line.label}</span>
            <span className="text-band tabular-nums">{formatInr(line.rupees)}</span>
          </div>
        ))}
        {quote?.ok && quote.taxPercent > 0 ? (
          <div className="flex justify-between gap-3 text-sm">
            <span className="text-band-dim">Tax ({quote.taxPercent}%)</span>
            <span className="text-band tabular-nums">{formatInr(quote.taxRupees)}</span>
          </div>
        ) : catalogOk ? (
          <p className="text-xs text-band-mute">{notes.tax || 'No extra tax is added unless a tax percent is configured.'}</p>
        ) : null}
        <div className="flex justify-between gap-3 text-lg font-semibold text-band pt-1" aria-live="polite">
          <span>Total / month</span>
          <span className="tabular-nums">{quote?.ok ? formatInr(total) : quoting ? 'Pricing…' : '—'}</span>
        </div>
        {quoteError ? <p className={`text-sm ${warnClass}`}>{quoteError}</p> : null}
      </div>

      {review && quote?.ok ? (
        <div className="rounded-2xl border border-ink-border p-4 space-y-2">
          <p className="text-sm font-semibold text-band">Review before payment</p>
          <p className="text-sm text-band-dim">You will pay {formatInr(quote.totalRupees)} for 30 prepaid days of this configuration.</p>
          <p className="text-xs text-band-mute">
            {notes.billing || 'This is a prepaid Razorpay charge, not an auto-renewing subscription. Access lasts 30 days from activation. There is no in-app cancel button because nothing renews automatically. Refunds follow the refund policy and meetcasemate@gmail.com.'}
          </p>
        </div>
      ) : null}

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          disabled={paying || quoting || !quote?.ok}
          onClick={() => void beginCheckout()}
          className="flex-1 py-3.5 rounded-xl bg-[var(--btn-bg)] text-[var(--btn-fg)] font-bold disabled:opacity-50"
        >
          {paying
            ? 'Starting payment…'
            : !user
              ? 'Sign in to buy this plan'
              : review
                ? `Pay ${formatInr(total)} with Razorpay`
                : 'Review and pay'}
        </button>
        <button
          type="button"
          onClick={reset}
          className="py-3.5 px-4 rounded-xl border border-ink-border text-band"
        >
          Reset to defaults
        </button>
        {!catalogOk || quoteError ? (
          <button
            type="button"
            onClick={() => {
              setQuote(null);
              setQuoteError('');
              setCatalogTick((n) => n + 1);
            }}
            className="py-3.5 px-4 rounded-xl border border-ink-border text-band"
          >
            Retry pricing
          </button>
        ) : null}
      </div>
      {status ? <p className="text-sm text-band-dim">{status}</p> : null}
    </div>
  );
};
