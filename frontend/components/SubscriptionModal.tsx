import React, { useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { CheckIcon, XIcon, SparklesIcon } from './Icons';
import { translations } from '../utils/translations';
import { sendPurchaseEmail } from '../services/emailService';
import { PLAN_FEATURES, sanitizeSubscriptionPlans } from '../utils/planLimits';
import { startRazorpayCheckout } from '../services/razorpayCheckout';

interface PlanConfig {
  id: string;
  name: string;
  price: number;
  features?: string[];
}

export const SubscriptionModal = () => {
  const { isSubscriptionModalOpen, setIsSubscriptionModalOpen, user, upgradeToPro, language, subscriptionPlans } = useAppContext();
  const [plans, setPlans] = useState<PlanConfig[]>(() => sanitizeSubscriptionPlans(null));
  const [selectedPlanId, setSelectedPlanId] = useState<string>('basic');
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    const source = subscriptionPlans.length > 0 ? subscriptionPlans : null;
    if (source && source.length > 0) {
      const next = sanitizeSubscriptionPlans(source);
      setPlans(next);
      setSelectedPlanId((cur) => (next.some((p) => p.id === cur) ? cur : next[0].id));
      return;
    }
    const savedPlans = localStorage.getItem('casemate_subscription_plans');
    if (savedPlans) {
      try {
        const parsed = JSON.parse(savedPlans);
        if (parsed.length > 0) {
          const next = sanitizeSubscriptionPlans(parsed);
          setPlans(next);
          setSelectedPlanId((cur) => (next.some((p) => p.id === cur) ? cur : next[0].id));
        }
      } catch (e) {
        console.error("Error loading plans in modal", e);
      }
    }
  }, [isSubscriptionModalOpen, subscriptionPlans]);

  if (!isSubscriptionModalOpen) return null;

  const t = translations[language] || translations['English'];
  const activePlan = plans.find(p => p.id === selectedPlanId) || plans[0];

  const handlePayment = async () => {
    if (paying) return;
    setPaying(true);
    try {
      await startRazorpayCheckout({
        planId: activePlan.id,
        description: `${activePlan.name} Subscription`,
        prefill: {
          name: user?.name || '',
          email: user?.email || '',
        },
        onVerified: async (_payload, plan) => {
          if (user?.email) {
            const days = activePlan.id === 'annual' ? 365 : 30;
            const expiryDate = plan.subscriptionExpiryDate || Date.now() + days * 24 * 60 * 60 * 1000;
            await sendPurchaseEmail(user.email, user.name || 'Advocate', activePlan.name, expiryDate);
          }
          upgradeToPro(plan.planId, plan.subscriptionExpiryDate);
          setIsSubscriptionModalOpen(false);
          alert('Payment successful! Your plan is now active.');
        },
      });
    } catch (err: any) {
      console.error('[Subscription] payment error', err);
      alert(err?.message || 'Unable to start payment. Please try again.');
    } finally {
      setPaying(false);
    }
  };

  const isUserPaid = user?.plan && user?.plan !== 'free';

  return (
    <div className="fixed inset-0 z-[60] bg-ink/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="bg-ink-soft rounded-t-3xl sm:rounded-3xl max-w-xl w-full shadow-2xl text-center relative border border-ink-border max-h-[min(92dvh,920px)] flex flex-col overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-yellow-400 to-yellow-600 z-10"></div>

        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-5 pt-5 pb-3 border-b border-ink-border/80">
          <h2 className="text-lg sm:text-xl font-bold text-white text-left">{t.subscriptionDetails}</h2>
          <button
            type="button"
            onClick={() => setIsSubscriptionModalOpen(false)}
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-ink-muted border border-ink-border text-band-dim hover:text-white hover:bg-neutral-800 transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-8 py-4 custom-scrollbar">
          <p className="text-band-mute mb-5 text-sm leading-relaxed">
            {isUserPaid
              ? t.alreadyPro
              : "Choose a plan below to unlock unlimited legal drafting and advanced AI capabilities."}
          </p>

          {/* Plan Selector Cards */}
          {!isUserPaid && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
              {plans.map((p) => (
                <button
                  key={p.id || p.name}
                  onClick={() => setSelectedPlanId(p.id)}
                  className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between ${
                    selectedPlanId === p.id
                      ? 'bg-white/10 border-white/40 shadow-lg ring-1 ring-white/25'
                      : 'bg-ink-muted/70 border-ink-border hover:bg-ink-muted'
                  }`}
                >
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-band-dim mb-1">{p.name}</div>
                    <div className="text-xl font-extrabold text-white">₹{p.price}</div>
                  </div>
                  <div className="mt-3 text-[11px] text-band-mute flex items-center gap-1">
                    <SparklesIcon className="w-3 h-3 text-yellow-400" /> Select
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="bg-ink-muted/70 p-5 rounded-2xl mb-5 border border-ink-border text-left">
            <div className="flex items-center justify-between mb-3 border-b border-ink-border/60 pb-3">
              <span className="text-sm font-semibold text-white uppercase tracking-wider">{activePlan.name} Selected</span>
              <span className="text-xl font-extrabold text-yellow-400">₹{activePlan.price}</span>
            </div>
            <ul className="space-y-2 text-sm text-band-dim font-medium">
              {activePlan.features && activePlan.features.length > 0 ? (
                activePlan.features.map((feat, idx) => (
                  <li key={idx} className="flex items-center gap-2.5">
                    <CheckIcon className="w-4 h-4 text-green-500 flex-shrink-0"/> {feat}
                  </li>
                ))
              ) : (
                (PLAN_FEATURES[(activePlan.id as 'basic' | 'pro' | 'annual')] || PLAN_FEATURES.basic).map((feat, idx) => (
                  <li key={idx} className="flex items-center gap-2.5">
                    <CheckIcon className="w-4 h-4 text-green-500 flex-shrink-0"/> {feat}
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>

        {!isUserPaid && (
          <div className="flex-shrink-0 px-5 sm:px-8 pb-5 pt-2 border-t border-ink-border/80 bg-ink-soft">
            <button
              onClick={handlePayment}
              disabled={paying}
              className="w-full bg-white text-black py-3.5 rounded-xl font-bold text-base hover:bg-neutral-200 transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {paying ? 'Starting payment…' : `Pay ₹${activePlan.price} with Razorpay`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};