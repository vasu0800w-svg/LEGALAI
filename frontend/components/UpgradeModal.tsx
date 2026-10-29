import React, { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { XIcon } from './Icons';
import { translations } from '../utils/translations';
import { sendPurchaseEmail } from '../services/emailService';
import { formatInr, hasUnlimitedAccess, sanitizeSubscriptionPlans } from '../utils/planLimits';
import { PromoCodeForm } from './PromoCodeForm';
import { startRazorpayCheckout } from '../services/razorpayCheckout';
import { PlanComparison } from './PlanComparison';

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

  if (!isUpgradeModalOpen || hasUnlimitedAccess(user?.email, user) || (user?.plan && user.plan !== 'free')) return null;

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
      <div className="bg-ink-soft p-6 sm:p-8 rounded-3xl max-w-2xl w-full shadow-2xl text-center relative overflow-hidden border border-ink-border max-h-[min(92dvh,920px)] overflow-y-auto">
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

        <div className="mb-6 rounded-2xl border border-ink-border bg-ink-muted/70 p-4">
          <PromoCodeForm />
        </div>

        <div className="mb-6 max-h-[45vh] overflow-y-auto custom-scrollbar text-left">
          <PlanComparison
            plans={plans}
            selectedPlanId={selectedPlanId}
            onSelect={setSelectedPlanId}
            showFree={false}
            compact
          />
        </div>
        
        <button 
          onClick={handlePayment}
          disabled={paying}
          className="w-full bg-[var(--btn-bg)] text-[var(--btn-fg)] py-4 rounded-xl font-bold text-lg hover:opacity-90 transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {paying ? 'Starting payment…' : `Pay ${formatInr(selectedPlan.price)} with Razorpay`}
        </button>
      </div>
    </div>
  );
};
