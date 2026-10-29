import React, { useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { XIcon } from './Icons';
import { translations } from '../utils/translations';
import { sendPurchaseEmail } from '../services/emailService';
import {
  PLAN_DISPLAY_NAMES,
  formatInr,
  hasUnlimitedAccess,
  sanitizeSubscriptionPlans,
} from '../utils/planLimits';
import { startRazorpayCheckout } from '../services/razorpayCheckout';
import { fetchDevices, fetchEntitlements, revokeDevice, EntitlementsSnapshot, RegisteredDevice } from '../services/entitlementsService';
import { PlanComparison } from './PlanComparison';
import { UsageMeters } from './UsageMeters';
import { PromoCodeForm } from './PromoCodeForm';
import { CustomPlanBuilder } from './CustomPlanBuilder';
import { PENDING_CUSTOM_PLAN_KEY } from '../services/customPlanService';
import { getDeviceId } from '../utils/deviceId';

const SUPPORT_EMAIL = 'meetcasemate@gmail.com';
const REFUND_URL = 'https://meetcasemate.com/refund';

const formatWhen = (ts?: number | null) => {
  if (!ts || ts <= 0) return null;
  return new Date(ts).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

const statusLabel = (
  snap: EntitlementsSnapshot | null,
  userPlan: string | null | undefined,
  expiry: number,
  unlimited: boolean
) => {
  if (unlimited) return { label: 'Unlimited', tone: 'ok' as const };
  if (snap?.promoActive) return { label: 'Promo active', tone: 'ok' as const };
  const plan = snap?.plan || userPlan || 'free';
  if (plan === 'free') return { label: 'Free plan', tone: 'muted' as const };
  if (snap?.status === 'expired' || (expiry > 0 && expiry <= Date.now())) {
    return { label: 'Expired', tone: 'warn' as const };
  }
  if (snap?.paymentStatus === 'paid' || expiry > Date.now()) {
    return { label: 'Active', tone: 'ok' as const };
  }
  return { label: snap?.paymentStatus || 'Unknown', tone: 'muted' as const };
};

export const SubscriptionModal = () => {
  const {
    isSubscriptionModalOpen,
    setIsSubscriptionModalOpen,
    user,
    upgradeToPro,
    language,
    subscriptionPlans,
  } = useAppContext();
  const [tab, setTab] = useState<'account' | 'plans' | 'custom'>('account');
  const [selectedPlanId, setSelectedPlanId] = useState('basic');
  const [paying, setPaying] = useState(false);
  const [snap, setSnap] = useState<EntitlementsSnapshot | null>(null);
  const [devices, setDevices] = useState<RegisteredDevice[]>([]);
  const [deviceBusy, setDeviceBusy] = useState(false);

  useEffect(() => {
    if (!isSubscriptionModalOpen) return;
    let pendingCustom = false;
    try { pendingCustom = Boolean(sessionStorage.getItem(PENDING_CUSTOM_PLAN_KEY)); } catch { /* ignore */ }
    setTab(pendingCustom ? 'custom' : 'account');
    const paid = sanitizeSubscriptionPlans(subscriptionPlans.length > 0 ? subscriptionPlans : null);
    setSelectedPlanId(paid[0]?.id || 'basic');
    void fetchEntitlements().then((next) => {
      if (next?.ok) setSnap(next);
    });
    void fetchDevices().then(setDevices);
  }, [isSubscriptionModalOpen, subscriptionPlans]);

  if (!isSubscriptionModalOpen) return null;

  const t = translations[language] || translations['English'];
  const plans = sanitizeSubscriptionPlans(subscriptionPlans.length > 0 ? subscriptionPlans : null);
  const expiry = Number(snap?.subscriptionExpiryDate || user?.subscriptionExpiryDate || 0);
  const planId = snap?.plan || user?.plan || 'free';
  const unlimited = hasUnlimitedAccess(user?.email, user);
  const status = statusLabel(snap, user?.plan, expiry, unlimited);
  const listPrice = plans.find((p) => p.id === planId);
  const lastPaid = (snap?.billingHistory || []).filter((row) => row.status === 'paid').slice(-1)[0];
  const period = planId === 'annual' ? 'Annual' : planId === 'free' ? 'Free' : 'Monthly';
  const customConfig = snap?.customPlan || user?.customPlan;
  const currentDeviceId = getDeviceId();

  const removeDevice = async (id: string) => {
    if (deviceBusy) return;
    setDeviceBusy(true);
    try {
      const next = await revokeDevice(id);
      setDevices(next);
    } catch (err: any) {
      alert(err?.message || 'Could not remove that device.');
    } finally {
      setDeviceBusy(false);
    }
  };
  const accessUntil = formatWhen(expiry);
  const selected = plans.find((p) => p.id === selectedPlanId) || plans[0];
  const expired = Boolean(planId !== 'free' && expiry > 0 && expiry <= Date.now());

  const payFor = async (planToBuy: string) => {
    if (paying) return;
    const target = plans.find((p) => p.id === planToBuy) || selected;
    if (!target) return;
    setPaying(true);
    try {
      await startRazorpayCheckout({
        planId: target.id,
        description: `${target.name} Subscription`,
        prefill: { name: user?.name || '', email: user?.email || '' },
        onVerified: async (_payload, plan) => {
          if (user?.email) {
            const days = target.id === 'annual' ? 365 : 30;
            const expiryDate = plan.subscriptionExpiryDate || Date.now() + days * 24 * 60 * 60 * 1000;
            await sendPurchaseEmail(user.email, user.name || 'Advocate', target.name, expiryDate);
          }
          upgradeToPro(plan.planId, plan.subscriptionExpiryDate);
          setIsSubscriptionModalOpen(false);
        },
      });
    } catch (err: any) {
      alert(err?.message || 'Unable to start payment. Please try again.');
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-ink/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="subscription-title"
        className="bg-ink-soft rounded-t-3xl sm:rounded-3xl max-w-2xl w-full shadow-2xl relative border border-ink-border max-h-[min(92dvh,920px)] flex flex-col overflow-hidden"
      >
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-5 pt-5 pb-3 border-b border-ink-border">
          <div>
            <h2 id="subscription-title" className="text-lg sm:text-xl font-bold text-band text-left">{t.subscriptionDetails || 'Subscription'}</h2>
            <p className="text-xs text-band-mute mt-0.5">Prices and limits match the public plans list.</p>
          </div>
          <button
            type="button"
            onClick={() => setIsSubscriptionModalOpen(false)}
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-ink-muted border border-ink-border text-band-dim hover:text-white hover:bg-neutral-800"
            aria-label="Close"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-shrink-0 px-5 pt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setTab('account')}
            className={`px-3 py-1.5 rounded-lg text-sm ${tab === 'account' ? 'bg-[var(--btn-bg)] text-[var(--btn-fg)]' : 'text-band-mute border border-ink-border'}`}
          >
            Account
          </button>
          <button
            type="button"
            onClick={() => setTab('plans')}
            className={`px-3 py-1.5 rounded-lg text-sm ${tab === 'plans' ? 'bg-[var(--btn-bg)] text-[var(--btn-fg)]' : 'text-band-mute border border-ink-border'}`}
          >
            Plans
          </button>
          <button
            type="button"
            onClick={() => setTab('custom')}
            className={`px-3 py-1.5 rounded-lg text-sm ${tab === 'custom' ? 'bg-[var(--btn-bg)] text-[var(--btn-fg)]' : 'text-band-mute border border-ink-border'}`}
          >
            Custom
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-6 py-4 custom-scrollbar space-y-5">
          {tab === 'account' ? (
            <>
              <section className="rounded-2xl border border-ink-border bg-ink-muted/50 p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-band-mute">Current plan</p>
                    <p className="text-lg font-semibold text-band">
                      {unlimited ? 'Unlimited' : (PLAN_DISPLAY_NAMES[planId] || planId)}
                    </p>
                  </div>
                  {status ? (
                    <span className={`text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                      status.tone === 'ok'
                        ? 'border-green-700 text-green-400'
                        : status.tone === 'warn'
                        ? 'border-amber-700 text-amber-300'
                        : 'border-ink-border text-band-mute'
                    }`}>
                      {status.label}
                    </span>
                  ) : null}
                </div>
                <p className="text-sm text-band-dim">Billing period: {period}</p>
                {accessUntil && planId !== 'free' ? (
                  <p className="text-sm text-band-dim">Access until {accessUntil}. There is no automatic renewal on file.</p>
                ) : (
                  <p className="text-sm text-band-dim">Prepaid Razorpay charges grant a period on this account. Casemate does not show a renewal date unless a receipt exists.</p>
                )}
                <p className="text-sm text-band-dim">
                  Current list price:{' '}
                  {planId === 'free' || unlimited
                    ? '₹0'
                    : planId === 'custom' && customConfig?.totalRupees
                    ? `${formatInr(customConfig.totalRupees)} / month`
                    : listPrice
                    ? `${formatInr(listPrice.price)} ${planId === 'annual' ? '/ year' : '/ month'}`
                    : 'Not on file'}
                </p>
                {customConfig?.selection ? (
                  <div className="pt-2 space-y-1">
                    <p className="text-xs uppercase tracking-wider text-band-mute">Active custom configuration</p>
                    <p className="text-sm text-band-dim">{customConfig.selection.photoUpload} photos per upload</p>
                    <p className="text-sm text-band-dim">
                      {customConfig.selection.photoChatEnabled
                        ? `${customConfig.selection.photoChat} photos per chat`
                        : 'Chat photo feature not selected'}
                    </p>
                    <p className="text-sm text-band-dim">{Number(customConfig.selection.characters || 0).toLocaleString('en-IN')} characters per chat</p>
                    <p className="text-sm text-band-dim">{customConfig.selection.drafts} completed drafts / month</p>
                    <p className="text-sm text-band-dim">{customConfig.selection.devices} registered devices</p>
                  </div>
                ) : null}
                {lastPaid ? (
                  <p className="text-sm text-band-dim">
                    Last recorded payment: {formatInr(lastPaid.amountPaise / 100)} on {formatWhen(lastPaid.at)}
                    {lastPaid.planId ? ` (${lastPaid.planId})` : ''}
                  </p>
                ) : (
                  <p className="text-sm text-band-mute">No payment receipts are stored on this account yet.</p>
                )}
                {snap?.grandfathered ? (
                  <p className="text-xs text-band-mute">Your current paid cycle keeps the limits you already had. New purchases use the catalog shown under Plans.</p>
                ) : null}
                {expired ? (
                  <p className="text-sm text-amber-300">This paid period has ended. Free-plan limits apply until you buy again.</p>
                ) : null}
              </section>

              <section>
                <h3 className="text-sm font-semibold text-band-dim uppercase tracking-wider mb-3">Usage</h3>
                <UsageMeters deviceCount={devices.length} />
              </section>

              <section>
                <h3 className="text-sm font-semibold text-band-dim uppercase tracking-wider mb-2">Registered devices</h3>
                <p className="text-xs text-band-mute mb-2">Each install stores a random id. Casemate does not fingerprint hardware. Unused slots free after 14 days.</p>
                {devices.length === 0 ? (
                  <p className="text-sm text-band-mute">No devices listed yet. This install is counted the next time you use AI.</p>
                ) : (
                  <ul className="space-y-2">
                    {devices.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-3 text-sm text-band-dim border border-ink-border rounded-xl px-3 py-2">
                        <span>
                          {d.id.slice(0, 8)}…
                          {d.current || d.id === currentDeviceId ? ' · this device' : ''}
                        </span>
                        <button
                          type="button"
                          disabled={deviceBusy}
                          onClick={() => void removeDevice(d.id)}
                          className="text-xs px-3 py-1.5 rounded-lg border border-ink-border text-band disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {snap?.addOns && Object.keys(snap.addOns).length > 0 ? (
                <section>
                  <h3 className="text-sm font-semibold text-band-dim uppercase tracking-wider mb-2">Active add-ons</h3>
                  <ul className="text-sm text-band-dim space-y-1">
                    {Object.entries(snap.addOns).map(([key, value]) => (
                      <li key={key}>{key}: {String(value)}</li>
                    ))}
                  </ul>
                  {snap.chatLimit?.extraSessionChars ? (
                    <p className="text-xs text-band-mute mt-2">
                      +{snap.chatLimit.extraSessionChars.toLocaleString('en-IN')} characters per chat on every conversation until{' '}
                      {snap.chatLimit.extraUntil
                        ? new Date(snap.chatLimit.extraUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
                        : 'the next calendar month'}
                      . This is not a permanent raise.
                    </p>
                  ) : null}
                </section>
              ) : (
                <p className="text-sm text-band-mute">No add-ons on this account. Build a custom plan under Custom, or write to {SUPPORT_EMAIL}.</p>
              )}

              <section>
                <h3 className="text-sm font-semibold text-band-dim uppercase tracking-wider mb-2">Billing history</h3>
                {(snap?.billingHistory || []).length === 0 ? (
                  <p className="text-sm text-band-mute">No receipts on file. Casemate does not invent payment history.</p>
                ) : (
                  <ul className="space-y-2">
                    {(snap?.billingHistory || []).slice().reverse().map((row) => (
                      <li key={`${row.orderId}-${row.at}`} className="text-sm text-band-dim border border-ink-border rounded-xl px-3 py-2">
                        {formatWhen(row.at)} · {row.kind === 'addon' ? row.addOnId : row.planId} · {formatInr(row.amountPaise / 100)} · {row.status}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-2">
                <button
                  type="button"
                  onClick={() => setTab('plans')}
                  className="w-full py-3 rounded-xl bg-[var(--btn-bg)] text-[var(--btn-fg)] font-medium text-sm"
                >
                  View plans / upgrade
                </button>
                <button
                  type="button"
                  onClick={() => setTab('custom')}
                  className="w-full py-3 rounded-xl border border-ink-border text-band font-medium text-sm"
                >
                  Build a custom plan
                </button>
                <a
                  href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('casemate subscription')}`}
                  className="block w-full py-3 rounded-xl border border-ink-border text-center text-sm text-band"
                >
                  Contact support
                </a>
                <a
                  href={REFUND_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full py-3 rounded-xl border border-ink-border text-center text-sm text-band-dim"
                >
                  Refunds and cancellation
                </a>
                <p className="text-xs text-band-mute">
                  Paid access stays until the date on the account. There is no in-app auto-renewal to cancel. Refunds are not automatic; see the refund page or email support.
                </p>
              </section>

              {!unlimited ? (
                <div className="rounded-2xl border border-ink-border p-4">
                  <PromoCodeForm />
                </div>
              ) : null}
            </>
          ) : tab === 'plans' ? (
            <>
              <p className="text-sm text-band-mute">
                Buying a higher plan upgrades immediately after Razorpay confirms payment. Buying a lower plan while a higher one is still in date keeps the higher plan and extends the paid-through date. Limits are not cut during an active cycle.
              </p>
              <PlanComparison
                plans={plans}
                currentPlanId={planId}
                selectedPlanId={selectedPlanId}
                onSelect={setSelectedPlanId}
              />
              {selected && selected.id !== 'free' && !unlimited ? (
                <button
                  type="button"
                  disabled={paying}
                  onClick={() => payFor(selected.id)}
                  className="w-full py-3.5 rounded-xl bg-[var(--btn-bg)] text-[var(--btn-fg)] font-bold disabled:opacity-60"
                >
                  {paying ? 'Starting payment…' : `Pay ${formatInr(selected.price)} with Razorpay`}
                </button>
              ) : null}
            </>
          ) : (
            <CustomPlanBuilder
              variant="app"
              onPurchased={() => {
                void fetchEntitlements().then((next) => {
                  if (next?.ok) setSnap(next);
                });
                setTab('account');
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
