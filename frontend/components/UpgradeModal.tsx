import React, { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { CheckIcon, XIcon } from './Icons';
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

const DEFAULT_PLANS: PlanConfig[] = sanitizeSubscriptionPlans(null);

export const UpgradeModal = () => {
  const { isUpgradeModalOpen, setIsUpgradeModalOpen, user, upgradeToPro, language, subscriptionPlans } = useAppContext();
  const [plans, setPlans] = useState<PlanConfig[]>(DEFAULT_PLANS);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('basic');
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!isUpgradeModalOpen) return;
    const source = subscriptionPlans.length > 0 ? subscriptionPlans : null;
    if (source && source.length > 0) {
      const next = sanitizeSubscriptionPlans(source);
      setPlans(next);
      setSelectedPlanId((cur) => (next.some((p) => p.id === cur) ? cur : next[0]?.id || 'basic'));
      return;
    }
    const savedPlans = localStorage.getItem('casemate_subscription_plans');
    if (savedPlans) {
      try {
        const parsed: PlanConfig[] = JSON.parse(savedPlans);
        if (parsed.length > 0) {
          const next = sanitizeSubscriptionPlans(parsed);
          setPlans(next);
          setSelectedPlanId((cur) => (next.some((p) => p.id === cur) ? cur : next[0]?.id || 'basic'));
          return;
        }
      } catch (e) {
        console.error("Error reading plans in UpgradeModal", e);
      }
    }
    setPlans(DEFAULT_PLANS);
    setSelectedPlanId('basic');
  }, [isUpgradeModalOpen, subscriptionPlans]);

  if (!isUpgradeModalOpen || (user?.plan && user.plan !== 'free')) return null;

  const t = translations[language] || translations['English'];
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) || plans[0] || DEFAULT_PLANS[0];

  const handlePayment = async () => {
    if (paying) return;
    setPaying(true);
    try {
      await startRazorpayCheckout({
        planId: selectedPlan.id,
        description: `${selectedPlan.name} Subscription`,
        prefill: {
          name: user?.name || '',
          email: user?.email || '',
        },
        onVerified: async (_payload, plan) => {
          if (user?.email) {
            const days = selectedPlan.id === 'annual' ? 365 : 30;
            const expiryDate = plan.subscriptionExpiryDate || Date.now() + days * 24 * 60 * 60 * 1000;
            await sendPurchaseEmail(user.email, user.name || 'Advocate', selectedPlan.name, expiryDate);
          }
          upgradeToPro(plan.planId, plan.subscriptionExpiryDate);
          setIsUpgradeModalOpen(false);
          alert('Payment successful! Your plan is now active.');
        },
      });
    } catch (err: any) {
      console.error('[Upgrade] payment error', err);
      alert(err?.message || 'Unable to start payment. Please try again.');
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-ink/85 flex items-center justify-center z-[60] backdrop-blur-sm p-4">
      <div className="bg-ink-soft p-8 rounded-3xl max-w-md w-full shadow-2xl text-center relative overflow-hidden border border-ink-border">
        <div className="absolute top-0 left-0 w-full h-2 bg-white"></div>

        <button
          type="button"
          onClick={() => setIsUpgradeModalOpen(false)}
          className="absolute top-4 right-4 text-band-mute hover:text-white transition-colors z-10"
          aria-label="Close"
        >
          <XIcon className="w-6 h-6" />
        </button>
        
        <h2 className="text-2xl font-display font-semibold text-band mb-3 mt-2">{t.timeLimitTitle}</h2>
        <p className="text-band-mute mb-6 leading-relaxed">
          {t.timeLimitDesc}
        </p>

        <div className="grid grid-cols-3 gap-2 mb-6">
          {plans.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedPlanId(p.id)}
              className={`p-3 rounded-xl border text-left transition-all ${
                selectedPlanId === p.id
                  ? 'bg-white/10 border-white/40 ring-1 ring-white/30'
                  : 'bg-ink-muted/70 border-ink-border hover:bg-ink-muted'
              }`}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-band-dim mb-1 truncate">{p.name}</div>
              <div className="text-lg font-extrabold text-white">₹{p.price}</div>
            </button>
          ))}
        </div>
        
        <div className="bg-ink-muted/70 p-6 rounded-2xl mb-8 border border-ink-border text-left">
          <div className="flex items-baseline gap-1 mb-2 justify-center">
            <span className="text-4xl font-extrabold text-white">₹{selectedPlan.price}</span>
            <span className="text-band-mute font-medium">{selectedPlan.id === 'annual' ? '/year' : t.month}</span>
          </div>
          <p className="text-center text-xs text-band-dim font-bold uppercase tracking-wider mb-4">{selectedPlan.name}</p>
          <ul className="space-y-3 text-sm text-band-dim font-medium">
            {(selectedPlan.features && selectedPlan.features.length > 0
              ? selectedPlan.features
              : PLAN_FEATURES[(selectedPlan.id as 'basic' | 'pro' | 'annual')] || PLAN_FEATURES.basic
            ).map((feat, idx) => (
              <li key={idx} className="flex items-center gap-3">
                <CheckIcon className="w-5 h-5 text-green-500 flex-shrink-0"/> {feat}
              </li>
            ))}
          </ul>
        </div>
        
        <button 
          onClick={handlePayment}
          disabled={paying}
          className="w-full bg-white text-black py-4 rounded-xl font-bold text-lg hover:bg-neutral-200 transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {paying ? 'Starting payment…' : `Pay ₹${selectedPlan.price} with Razorpay`}
        </button>
      </div>
    </div>
  );
};
