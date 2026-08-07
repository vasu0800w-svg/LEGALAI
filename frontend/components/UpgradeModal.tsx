import React, { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { CheckIcon } from './Icons';
import { translations } from '../utils/translations';
import { sendPurchaseEmail } from '../services/emailService';

interface PlanConfig {
  id: string;
  name: string;
  price: number;
}

export const UpgradeModal = () => {
  const { isTimeUp, user, upgradeToPro, language } = useAppContext();
  const [selectedPlan, setSelectedPlan] = useState<PlanConfig>({ id: 'pro', name: 'Pro Plan', price: 999 });
  const [razorpayKey, setRazorpayKey] = useState('rzp_test_123456789');

  useEffect(() => {
    if (isTimeUp) {
      // 1. Load Plans from Admin Panel
      const savedPlans = localStorage.getItem('casemate_subscription_plans');
      if (savedPlans) {
        try {
          const plans: PlanConfig[] = JSON.parse(savedPlans);
          if (plans.length > 0) {
            setSelectedPlan(plans[1] || plans[0]); // Default to Pro or first plan
          }
        } catch (e) {
          console.error("Error reading plans in UpgradeModal", e);
        }
      }

      // 2. Load Razorpay Key from Admin Panel
      const savedKeys = localStorage.getItem('casemate_api_keys');
      if (savedKeys) {
        try {
          const keys = JSON.parse(savedKeys);
          if (keys.razorpayKeyId) {
            setRazorpayKey(keys.razorpayKeyId);
          }
        } catch (e) {
          console.error("Error reading keys in UpgradeModal", e);
        }
      }
    }
  }, [isTimeUp]);

  if (!isTimeUp || user?.plan !== 'free') return null;

  const t = translations[language] || translations['English'];

  const handlePayment = async () => {
    // Send purchase email via EmailJS
    if (user?.email) {
      await sendPurchaseEmail(user.email, user.name || 'Advocate', selectedPlan.name);
    }

    const options = {
      key: razorpayKey, // Dynamic key from Admin Panel
      amount: (selectedPlan.price * 100).toString(), // Amount in paise
      currency: "INR",
      name: "casemate Assistant",
      description: `${selectedPlan.name} Subscription`,
      handler: function (response: any) {
        upgradeToPro();
      },
      prefill: {
        name: user?.name || "",
        email: user?.email || "",
      },
      theme: { color: "#2563eb" }
    };

    if ((window as any).Razorpay) {
      try {
        const rzp = new (window as any).Razorpay(options);
        rzp.on('payment.failed', function (response: any){
          console.warn("Payment Failed: " + response.error.description);
          alert("Payment Failed: " + response.error.description + "\n\nSimulating successful payment for demo purposes.");
          upgradeToPro();
        });
        rzp.open();
      } catch (e) {
        console.warn("Razorpay error", e);
        upgradeToPro();
      }
    } else {
      alert("Razorpay SDK not loaded. Simulating successful payment for demo.");
      upgradeToPro();
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center z-[60] backdrop-blur-sm p-4">
      <div className="bg-slate-900 p-8 rounded-3xl max-w-md w-full shadow-2xl text-center relative overflow-hidden border border-slate-800">
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-500 to-purple-600"></div>
        
        <h2 className="text-2xl font-bold text-white mb-3 mt-2">{t.timeLimitTitle}</h2>
        <p className="text-slate-400 mb-8 leading-relaxed">
          {t.timeLimitDesc}
        </p>
        
        <div className="bg-slate-800/50 p-6 rounded-2xl mb-8 border border-slate-700 text-left">
          <div className="flex items-baseline gap-1 mb-2 justify-center">
            <span className="text-4xl font-extrabold text-white">₹{selectedPlan.price}</span>
            <span className="text-slate-400 font-medium">{t.month}</span>
          </div>
          <p className="text-center text-xs text-purple-400 font-bold uppercase tracking-wider mb-4">{selectedPlan.name}</p>
          <ul className="space-y-3 text-sm text-slate-300 font-medium">
            <li className="flex items-center gap-3"><CheckIcon className="w-5 h-5 text-green-500 flex-shrink-0"/> {t.feature1}</li>
            <li className="flex items-center gap-3"><CheckIcon className="w-5 h-5 text-green-500 flex-shrink-0"/> {t.feature2}</li>
            <li className="flex items-center gap-3"><CheckIcon className="w-5 h-5 text-green-500 flex-shrink-0"/> {t.feature3}</li>
          </ul>
        </div>
        
        <button 
          onClick={handlePayment}
          className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-4 rounded-xl font-bold text-lg hover:from-blue-700 hover:to-purple-700 transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
        >
          {t.payWithRazorpay}
        </button>
      </div>
    </div>
  );
};