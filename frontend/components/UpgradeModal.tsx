import React, { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { CheckIcon, XIcon } from './Icons';
import { translations } from '../utils/translations';
import { sendPurchaseEmail } from '../services/emailService';
import { PLAN_FEATURES } from '../utils/planLimits';
import { startRazorpayCheckout } from '../services/razorpayCheckout';

interface PlanConfig {
  id: string;
  name: string;
  price: number;
  features?: string[];
}

const DEFAULT_PLANS: PlanConfig[] = [
  { id: 'basic', name: 'Basic Plan', price: 699, features: [...PLAN_FEATURES.basic] },
  { id: 'pro', name: 'Pro Plan', price: 1299, features: [...PLAN_FEATURES.pro] },
  { id: 'annual', name: 'Annual Plan', price: 9999, features: [...PLAN_FEATURES.annual] },
];

const normalizePlans = (plans: PlanConfig[]): PlanConfig[] =>
  plans.map((p) => {
    if (p.id === 'basic') return { ...p, price: 699, name: p.name || 'Basic Plan', features: [...PLAN_FEATURES.basic] };
    if (p.id === 'pro') return { ...p, price: p.price === 999 ? 1299 : (p.price || 1299), name: p.name || 'Pro Plan', features: [...PLAN_FEATURES.pro] };
    if (p.id === 'annual') return { ...p, price: p.price === 4999 || p.price === 999 ? 9999 : (p.price || 9999), name: p.name || 'Annual Plan', features: [...PLAN_FEATURES.annual] };
    return p;
  });

export const UpgradeModal = () => {
  const { isUpgradeModalOpen, setIsUpgradeModalOpen, user, upgradeToPro, language } = useAppContext();
  const [plans, setPlans] = useState<PlanConfig[]>(DEFAULT_PLANS);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('basic');
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (isUpgradeModalOpen) {
      const savedPlans = localStorage.getItem('casemate_subscription_plans');
      if (savedPlans) {
        try {
          const parsed: PlanConfig[] = JSON.parse(savedPlans);
          if (parsed.length > 0) {
            const migrated = normalizePlans(parsed);
            setPlans(migrated);
            setSelectedPlanId(migrated[0]?.id || 'basic');
            localStorage.setItem('casemate_subscription_plans', JSON.stringify(migrated));
          }
        } catch (e) {
          console.error("Error reading plans in UpgradeModal", e);
          setPlans(DEFAULT_PLANS);
          setSelectedPlanId('basic');
        }
      } else {
        setPlans(DEFAULT_PLANS);
        setSelectedPlanId('basic');
      }
    }
  }, [isUpgradeModalOpen]);

  if (!isUpgradeModalOpen || (user?.plan && user.plan !== 'free')) return null;

  const t = translations[language] || translations['English'];
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) || plans[0] || DEFAULT_PLANS[0];

  const handlePayment = async () => {
    if (paying) return;
    setPaying(true);
    try {
      await startRazorpayCheckout({
        amountRupees: selectedPlan.price,
        description: `${selectedPlan.name} Subscription`,
        prefill: {
          name: user?.name || '',
          email: user?.email || '',
        },
        onVerified: async () => {
          if (user?.email) {
            await sendPurchaseEmail(user.email, user.name || 'Advocate', selectedPlan.name);
          }
          upgradeToPro(selectedPlan.id);
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
    <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center z-[60] backdrop-blur-sm p-4">
      <div className="bg-slate-900 p-8 rounded-3xl max-w-md w-full shadow-2xl text-center relative overflow-hidden border border-slate-800">
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-500 to-purple-600"></div>

        <button
          type="button"
          onClick={() => setIsUpgradeModalOpen(false)}
          className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors z-10"
          aria-label="Close"
        >
          <XIcon className="w-6 h-6" />
        </button>
        
        <h2 className="text-2xl font-bold text-white mb-3 mt-2">{t.timeLimitTitle}</h2>
        <p className="text-slate-400 mb-6 leading-relaxed">
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
                  ? 'bg-blue-600/20 border-blue-500 ring-1 ring-blue-500'
                  : 'bg-slate-800/50 border-slate-700 hover:bg-slate-800'
              }`}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-purple-400 mb-1 truncate">{p.name}</div>
              <div className="text-lg font-extrabold text-white">₹{p.price}</div>
            </button>
          ))}
        </div>
        
        <div className="bg-slate-800/50 p-6 rounded-2xl mb-8 border border-slate-700 text-left">
          <div className="flex items-baseline gap-1 mb-2 justify-center">
            <span className="text-4xl font-extrabold text-white">₹{selectedPlan.price}</span>
            <span className="text-slate-400 font-medium">{selectedPlan.id === 'annual' ? '/year' : t.month}</span>
          </div>
          <p className="text-center text-xs text-purple-400 font-bold uppercase tracking-wider mb-4">{selectedPlan.name}</p>
          <ul className="space-y-3 text-sm text-slate-300 font-medium">
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
          className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-4 rounded-xl font-bold text-lg hover:from-blue-700 hover:to-purple-700 transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {paying ? 'Starting payment…' : `Pay ₹${selectedPlan.price} with Razorpay`}
        </button>
      </div>
    </div>
  );
};
