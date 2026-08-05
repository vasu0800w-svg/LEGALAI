import React, { useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { CheckIcon, XIcon, SparklesIcon } from './Icons';
import { translations } from '../utils/translations';

interface PlanConfig {
  id: string;
  name: string;
  price: number;
}

export const SubscriptionModal = () => {
  const { isSubscriptionModalOpen, setIsSubscriptionModalOpen, user, upgradeToPro, language } = useAppContext();
  const [plans, setPlans] = useState<PlanConfig[]>([
    { id: 'basic', name: 'Basic Plan', price: 699 },
    { id: 'pro', name: 'Pro Plan', price: 1299 },
    { id: 'annual', name: 'Annual Plan', price: 4999 }
  ]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('pro');

  useEffect(() => {
    const savedPlans = localStorage.getItem('legalai_subscription_plans');
    if (savedPlans) {
      try {
        setPlans(JSON.parse(savedPlans));
      } catch (e) {
        console.error("Error loading plans in modal", e);
      }
    }
  }, [isSubscriptionModalOpen]);

  if (!isSubscriptionModalOpen) return null;

  const t = translations[language] || translations['English'];
  const activePlan = plans.find(p => p.id === selectedPlanId) || plans[1];

  const handlePayment = () => {
    // Fetch Razorpay Key dynamically from Admin Panel settings
    let rzpKey = "rzp_test_123456789"; // Default fallback
    const savedKeys = localStorage.getItem('legalai_api_keys');
    if (savedKeys) {
      try {
        const parsed = JSON.parse(savedKeys);
        if (parsed.razorpayKeyId) {
          rzpKey = parsed.razorpayKeyId;
        }
      } catch (e) {
        console.error("Error reading Razorpay key", e);
      }
    }

    const amountInPaise = activePlan.price * 100;

    const options = {
      key: rzpKey,
      amount: amountInPaise.toString(),
      currency: "INR",
      name: "LegalAI Assistant",
      description: `${activePlan.name} Subscription`,
      handler: function (response: any) {
        upgradeToPro();
        setIsSubscriptionModalOpen(false);
      },
      prefill: {
        name: user?.name || "",
        email: user?.email || "",
      },
      theme: {
        color: "#2563eb"
      }
    };

    if ((window as any).Razorpay) {
      try {
        const rzp = new (window as any).Razorpay(options);
        rzp.on('payment.failed', function (response: any){
          console.warn("Payment Failed: " + response.error.description);
          alert("Payment Failed: " + response.error.description + "\n\nSimulating successful payment for demo purposes.");
          upgradeToPro();
          setIsSubscriptionModalOpen(false);
        });
        rzp.open();
      } catch (e) {
        console.warn("Razorpay error", e);
        upgradeToPro();
        setIsSubscriptionModalOpen(false);
      }
    } else {
      alert("Razorpay SDK not loaded. Simulating successful payment for demo.");
      upgradeToPro();
      setIsSubscriptionModalOpen(false);
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
                key={p.id}
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
            <li className="flex items-center gap-2.5"><CheckIcon className="w-4 h-4 text-green-500 flex-shrink-0"/> {t.feature1}</li>
            <li className="flex items-center gap-2.5"><CheckIcon className="w-4 h-4 text-green-500 flex-shrink-0"/> {t.feature2}</li>
            <li className="flex items-center gap-2.5"><CheckIcon className="w-4 h-4 text-green-500 flex-shrink-0"/> {t.feature3}</li>
          </ul>
        </div>
        
        {!isUserPaid && (
          <button 
            onClick={handlePayment}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-3.5 rounded-xl font-bold text-base hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
          >
            {t.payWithRazorpay} (₹{activePlan.price})
          </button>
        )}
      </div>
    </div>
  );
};