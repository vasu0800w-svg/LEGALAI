import React, { useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { CheckIcon, XIcon, SparklesIcon } from './Icons';
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

export const SubscriptionModal = () => {
  const { isSubscriptionModalOpen, setIsSubscriptionModalOpen, user, upgradeToPro, language } = useAppContext();
  const [plans, setPlans] = useState<PlanConfig[]>([
    { 
      id: 'basic', 
      name: 'Basic Plan', 
      price: 699, 
      features: [...PLAN_FEATURES.basic],
    },
    { 
      id: 'pro', 
      name: 'Pro Plan', 
      price: 1299, 
      features: [...PLAN_FEATURES.pro],
    },
    { 
      id: 'annual', 
      name: 'Annual Plan', 
      price: 9999, 
      features: [...PLAN_FEATURES.annual],
    }
  ]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('basic');
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    const savedPlans = localStorage.getItem('casemate_subscription_plans');
    if (savedPlans) {
      try {
        const parsed = JSON.parse(savedPlans);
        if (parsed.length > 0) {
          const migrated = parsed.map((p: PlanConfig) => {
            if (p.id === 'basic') return { ...p, price: 699, features: [...PLAN_FEATURES.basic] };
            if (p.id === 'pro') return { ...p, price: p.price === 999 ? 1299 : (p.price || 1299), features: [...PLAN_FEATURES.pro] };
            if (p.id === 'annual') {
              return {
                ...p,
                price: p.price === 4999 || p.price === 999 ? 9999 : (p.price || 9999),
                features: [...PLAN_FEATURES.annual],
              };
            }
            return p;
          });
          setPlans(migrated);
          setSelectedPlanId(migrated[0].id);
          localStorage.setItem('casemate_subscription_plans', JSON.stringify(migrated));
        }
      } catch (e) {
        console.error("Error loading plans in modal", e);
      }
    }
  }, [isSubscriptionModalOpen]);

  if (!isSubscriptionModalOpen) return null;

  const t = translations[language] || translations['English'];
  const activePlan = plans.find(p => p.id === selectedPlanId) || plans[0];

  const handlePayment = async () => {
    if (paying) return;
    setPaying(true);
    try {
      await startRazorpayCheckout({
        amountRupees: activePlan.price,
        description: `${activePlan.name} Subscription`,
        prefill: {
          name: user?.name || '',
          email: user?.email || '',
        },
        onVerified: async () => {
          if (user?.email) {
            await sendPurchaseEmail(user.email, user.name || 'Advocate', activePlan.name);
          }
          upgradeToPro(activePlan.id);
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
    <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center z-[60] backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 p-6 sm:p-8 rounded-3xl max-w-xl w-full shadow-2xl text-center relative overflow-hidden border border-slate-800 my-8">
        <button 
          onClick={() => setIsSubscriptionModalOpen(false)}
          className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
        >
          <XIcon className="w-6 h-6" />
        </button>
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-yellow-400 to-yellow-600"></div>
        
        <h2 className="text-2xl font-bold text-white mb-2 mt-2">{t.subscriptionDetails}</h2>
        <p className="text-slate-400 mb-6 text-sm leading-relaxed">
          {isUserPaid 
            ? t.alreadyPro 
            : "Choose a plan below to unlock unlimited legal drafting and advanced AI capabilities."}
        </p>

        {/* Plan Selector Cards */}
        {!isUserPaid && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            {plans.map((p) => (
              <button
                key={p.id || p.name}
                onClick={() => setSelectedPlanId(p.id)}
                className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between ${
                  selectedPlanId === p.id 
                    ? 'bg-blue-600/20 border-blue-500 shadow-lg ring-1 ring-blue-500' 
                    : 'bg-slate-800/50 border-slate-700/80 hover:bg-slate-800'
                }`}
              >
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-purple-400 mb-1">{p.name}</div>
                  <div className="text-xl font-extrabold text-white">₹{p.price}</div>
                </div>
                <div className="mt-3 text-[11px] text-slate-400 flex items-center gap-1">
                  <SparklesIcon className="w-3 h-3 text-yellow-400" /> Select
                </div>
              </button>
            ))}
          </div>
        )}
        
        <div className="bg-slate-800/50 p-5 rounded-2xl mb-6 border border-slate-700 text-left">
          <div className="flex items-center justify-between mb-3 border-b border-slate-700/60 pb-3">
            <span className="text-sm font-semibold text-white uppercase tracking-wider">{activePlan.name} Selected</span>
            <span className="text-xl font-extrabold text-yellow-400">₹{activePlan.price}</span>
          </div>
          <ul className="space-y-2 text-sm text-slate-300 font-medium">
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
        
        {!isUserPaid && (
          <button 
            onClick={handlePayment}
            disabled={paying}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-3.5 rounded-xl font-bold text-base hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {paying ? 'Starting payment…' : `Pay ₹${activePlan.price} with Razorpay`}
          </button>
        )}
      </div>
    </div>
  );
};