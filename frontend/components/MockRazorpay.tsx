import React, { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { XIcon } from './Icons';
import { sendPurchaseEmail } from '../services/emailService';
import { startRazorpayCheckout } from '../services/razorpayCheckout';

interface PlanConfig {
  id: string;
  name: string;
  price: number;
}

export const MockRazorpay = () => {
  const { isMockRazorpayOpen, setIsMockRazorpayOpen, upgradeToPro, user } = useAppContext();
  const [isProcessing, setIsProcessing] = useState(false);
  const [activePlan, setActivePlan] = useState<PlanConfig>({ id: 'pro', name: 'Pro Plan', price: 1299 });

  useEffect(() => {
    if (isMockRazorpayOpen) {
      const savedPlans = localStorage.getItem('casemate_subscription_plans');
      if (savedPlans) {
        try {
          const plans: PlanConfig[] = JSON.parse(savedPlans);
          if (plans.length > 0) {
            setActivePlan(plans[1] || plans[0]);
          }
        } catch (e) {
          console.error("Error reading plans in razorpay checkout", e);
        }
      }
    }
  }, [isMockRazorpayOpen]);

  if (!isMockRazorpayOpen) return null;

  const handleLivePayment = async () => {
    setIsProcessing(true);
    try {
      await startRazorpayCheckout({
        amountRupees: activePlan.price,
        description: `Subscription for ${activePlan.name}`,
        prefill: {
          name: user?.name || 'Advocate',
          email: user?.email || '',
          contact: (user as any)?.phone || '',
        },
        onVerified: async () => {
          if (user?.email) {
            await sendPurchaseEmail(user.email, user.name || 'Advocate', activePlan.name);
          }
          upgradeToPro(activePlan.id);
          setIsMockRazorpayOpen(false);
          alert('Payment Successful! Your plan is now active.');
        },
      });
    } catch (e: any) {
      console.error('Razorpay open error:', e);
      alert(e?.message || 'Unable to start payment.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center z-[70] backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-sm rounded-xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
        <div className="bg-[#02042b] text-white px-5 py-4 flex justify-between items-center">
           <div className="font-bold text-lg tracking-wide flex items-center gap-2">
             Razorpay 
             <span className="text-[10px] font-bold bg-green-500 text-white px-1.5 py-0.5 rounded uppercase tracking-wider">Live</span>
           </div>
           <button onClick={() => setIsMockRazorpayOpen(false)} className="text-slate-400 hover:text-white transition-colors">
             <XIcon className="w-5 h-5"/>
           </button>
        </div>
        
        <div className="p-8 flex flex-col items-center text-center">
           <div className="w-14 h-14 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold text-2xl mb-4 shadow-inner">
             {user?.name?.charAt(0).toUpperCase() || 'U'}
           </div>
           <h3 className="text-slate-800 font-semibold text-lg mb-1">{user?.email}</h3>
           <p className="text-slate-500 text-sm mb-6">casemate Assistant - {activePlan.name}</p>
           
           <div className="text-4xl font-extrabold text-slate-900 mb-8 tracking-tight">₹ {activePlan.price}.00</div>

           {isProcessing ? (
             <div className="flex flex-col items-center text-blue-600 py-4">
               <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3"></div>
               <span className="text-sm font-semibold animate-pulse">Connecting to Razorpay Live...</span>
             </div>
           ) : (
             <div className="w-full space-y-3">
               <button 
                 onClick={handleLivePayment} 
                 className="w-full bg-[#3399cc] hover:bg-[#2b82ad] text-white font-semibold py-3.5 rounded-lg shadow-md transition-all transform hover:-translate-y-0.5"
               >
                 Pay Now (Live)
               </button>
               <button 
                 onClick={() => setIsMockRazorpayOpen(false)} 
                 className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-3.5 rounded-lg transition-colors"
               >
                 Cancel
               </button>
             </div>
           )}
        </div>
        
        <div className="bg-slate-50 py-3 text-center border-t border-slate-100">
          <p className="text-xs text-slate-400 font-medium flex items-center justify-center gap-1">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"></path></svg>
            Secured by Razorpay Live
          </p>
        </div>
      </div>
    </div>
  );
};