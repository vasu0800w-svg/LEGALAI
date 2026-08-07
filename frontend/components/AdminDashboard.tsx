import React, { useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { UsersIcon, ActivityIcon, LogoutIcon, ScaleIcon, SettingsIcon, XIcon, EditIcon, PlusIcon } from './Icons';
import { translations } from '../utils/translations';
import { saveCloudAdminConfig } from '../services/adminConfigService';

interface UserStats {
  id: string;
  name: string;
  email: string;
  plan: string;
  totalChats: number;
  totalDocs: number;
  timeLeft: number;
  isBlocked?: boolean;
}

interface PlanConfig {
  id: string;
  name: string;
  price: number;
  features: string[];
}

export const AdminDashboard = () => {
  const { logout, language } = useAppContext();
  const t = translations[language] || translations['English'];
  const [stats, setStats] = useState<UserStats[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showPlansModal, setShowPlansModal] = useState(false);
  const [showKeysModal, setShowKeysModal] = useState(false);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);

  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  // Dynamic Plans with customizable features & add/remove support
  const [plans, setPlans] = useState<PlanConfig[]>([
    { id: 'basic', name: 'Basic Plan', price: 699, features: ['Unlimited chat analysis', 'Standard document export'] },
    { id: 'pro', name: 'Pro Plan', price: 1299, features: ['Unlimited chat analysis', 'Priority AI processing', 'Advanced DOCX/PDF export'] },
    { id: 'annual', name: 'Annual Plan', price: 4999, features: ['All Pro features', '24/7 VIP Support', 'Custom templates access'] }
  ]);

  // API, Payment, Firebase & EmailJS Keys State
  const [keysConfig, setKeysConfig] = useState({
    geminiApiKey: '',
    razorpayKeyId: '',
    razorpayKeySecret: '',
    firebaseApiKey: '',
    firebaseProjectId: '',
    authDomain: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
    emailServiceId: '',
    emailPublicKey: '',
    welcomeTemplateId: '',
    purchaseTemplateId: '',
    expiryTemplateId: ''
  });

  // Announcement State
  const [announcementText, setAnnouncementText] = useState('');

  useEffect(() => {
    loadUsers();

    // Load credentials
    const creds = JSON.parse(localStorage.getItem('casemate_admin_creds') || '{"email":"admin@casemate.com","password":"admin123"}');
    setAdminEmail(creds.email);
    setAdminPassword(creds.password);

    // Load plans
    const savedPlans = localStorage.getItem('casemate_subscription_plans');
    if (savedPlans) {
      try { setPlans(JSON.parse(savedPlans)); } catch (e) { console.error(e); }
    }

    // Load API/Payment, Firebase & EmailJS Keys
    const savedKeys = localStorage.getItem('casemate_api_keys');
    if (savedKeys) {
      try { setKeysConfig(JSON.parse(savedKeys)); } catch (e) { console.error(e); }
    }

    // Load Announcement
    const savedAnnouncement = localStorage.getItem('casemate_announcement') || '';
    setAnnouncementText(savedAnnouncement);
  }, []);

  const loadUsers = () => {
    const usersDb = JSON.parse(localStorage.getItem('casemate_users_db') || '[]');
    const blockedUsers = JSON.parse(localStorage.getItem('casemate_blocked_users') || '[]');
    
    const userStats = usersDb.map((u: any) => {
      const chats = JSON.parse(localStorage.getItem(`casemate_chats_${u.id}`) || '[]');
      const usage = JSON.parse(localStorage.getItem(`casemate_usage_${u.id}`) || '3600');
      
      let docCount = 0;
      chats.forEach((c: any) => {
        c.messages.forEach((m: any) => {
          if (m.isDocument) docCount++;
        });
      });

      return {
        id: u.id,
        name: u.name,
        email: u.email,
        plan: u.plan || 'free',
        totalChats: chats.length,
        totalDocs: docCount,
        timeLeft: usage,
        isBlocked: blockedUsers.includes(u.id)
      };
    });
    setStats(userStats);
  };

  const toggleBlockUser = (userId: string) => {
    let blockedUsers = JSON.parse(localStorage.getItem('casemate_blocked_users') || '[]');
    if (blockedUsers.includes(userId)) {
      blockedUsers = blockedUsers.filter((id: string) => id !== userId);
    } else {
      blockedUsers.push(userId);
    }
    localStorage.setItem('casemate_blocked_users', JSON.stringify(blockedUsers));
    loadUsers();
  };

  const handleSaveCreds = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('casemate_admin_creds', JSON.stringify({ email: adminEmail, password: adminPassword }));
    setShowSettings(false);
    alert("Admin credentials updated successfully.");
  };

  const handleSavePlans = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('casemate_subscription_plans', JSON.stringify(plans));
    setShowPlansModal(false);
    alert("Subscription plans updated successfully.");
  };

  const handleSaveKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 1. LocalStorage mein save karo
    localStorage.setItem('casemate_api_keys', JSON.stringify(keysConfig));
    
    // 2. Firestore par bhi sync karo taaki saare devices/phones par cloud se load ho sake
    try {
      await saveCloudAdminConfig('api_keys', {
        geminiApiKey: keysConfig.geminiApiKey,
        razorpayKeyId: keysConfig.razorpayKeyId,
        razorpayKeySecret: keysConfig.razorpayKeySecret
      });

      await saveCloudAdminConfig('email_keys', {
        serviceId: keysConfig.emailServiceId,
        publicKey: keysConfig.emailPublicKey,
        welcomeTemplateId: keysConfig.welcomeTemplateId,
        purchaseTemplateId: keysConfig.purchaseTemplateId,
        expiryTemplateId: keysConfig.expiryTemplateId
      });
    } catch (err) {
      console.error("Error saving keys to cloud:", err);
    }

    setShowKeysModal(false);
    alert("API, Payment, Firebase & EmailJS keys updated successfully to Cloud & Local!");
  };

  const handleSaveAnnouncement = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('casemate_announcement', announcementText);
    setShowAnnouncementModal(false);
    alert("Global announcement broadcasted successfully.");
  };

  const addPlan = () => {
    const newPlan: PlanConfig = {
      id: `plan_${Date.now()}`,
      name: 'New Plan',
      price: 999,
      features: ['Feature 1', 'Feature 2']
    };
    setPlans([...plans, newPlan]);
  };

  const removePlan = (index: number) => {
    const updated = plans.filter((_, i) => i !== index);
    setPlans(updated);
  };

  const totalUsers = stats.length;
  const paidUsers = stats.filter(s => s.plan && s.plan !== 'free').length;
  const freeUsers = totalUsers - paidUsers;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 flex flex-col font-sans relative">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center border border-slate-700">
            <ScaleIcon className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{t.adminDashboard}</h1>
            <p className="text-xs text-slate-400">Complete Master Control Panel</p>
          </div>
        </div>
        
        {/* Quick Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button 
            onClick={() => setShowPlansModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 rounded-lg text-xs font-medium transition-colors"
          >
            <EditIcon className="w-4 h-4" /> Plans
          </button>
          <button 
            onClick={() => setShowKeysModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-lg text-xs font-medium transition-colors"
          >
            <SettingsIcon className="w-4 h-4" /> API & Keys
          </button>
          <button 
            onClick={() => setShowAnnouncementModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-medium transition-colors"
          >
            <EditIcon className="w-4 h-4" /> Broadcast
          </button>
          <button 
            onClick={() => setShowSettings(true)}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors"
            title="Settings"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>
          <button 
            onClick={logout}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-red-400 rounded-lg border border-slate-700 transition-colors"
            title="Logout"
          >
            <LogoutIcon className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex items-center gap-4 shadow-sm">
            <div className="w-12 h-12 bg-blue-900/30 rounded-full flex items-center justify-center border border-blue-800/50">
              <UsersIcon className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400 font-medium">{t.totalUsers}</p>
              <p className="text-3xl font-bold text-white">{totalUsers}</p>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex items-center gap-4 shadow-sm">
            <div className="w-12 h-12 bg-yellow-900/30 rounded-full flex items-center justify-center border border-yellow-800/50">
              <ActivityIcon className="w-6 h-6 text-yellow-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400 font-medium">Paid Users</p>
              <p className="text-3xl font-bold text-white">{paidUsers}</p>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex items-center gap-4 shadow-sm">
            <div className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center border border-slate-700">
              <UsersIcon className="w-6 h-6 text-slate-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400 font-medium">{t.freeUsers}</p>
              <p className="text-3xl font-bold text-white">{freeUsers}</p>
            </div>
          </div>
        </div>

        {/* Users Table & Management */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 bg-slate-800/30 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Registered Users & Control</h2>
            <span className="text-xs text-slate-400">Manage user status & access</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-800/50 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-6 py-4 font-medium">{t.userName}</th>
                  <th className="px-6 py-4 font-medium">{t.email}</th>
                  <th className="px-6 py-4 font-medium">{t.plan}</th>
                  <th className="px-6 py-4 font-medium">Activity</th>
                  <th className="px-6 py-4 font-medium">Status Control</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {stats.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-slate-500 italic">
                      No users registered yet.
                    </td>
                  </tr>
                ) : (
                  stats.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 font-medium text-white">{user.name}</td>
                      <td className="px-6 py-4 text-slate-400">{user.email}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
                          user.plan !== 'free' ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-800/50' : 'bg-slate-800 text-slate-300 border border-slate-700'
                        }`}>
                          {user.plan}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-400 text-xs">
                        Chats: {user.totalChats} | Docs: {user.totalDocs}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => toggleBlockUser(user.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            user.isBlocked 
                              ? 'bg-green-600/20 text-green-400 border border-green-500/30 hover:bg-green-600/30' 
                              : 'bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30'
                          }`}
                        >
                          {user.isBlocked ? 'Unblock User' : 'Block User'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* 1. Manage Plans Modal with Add/Remove & Features */}
      {showPlansModal && (
        <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center z-[100] backdrop-blur-sm p-4">
          <div className="bg-slate-900 p-8 rounded-3xl max-w-xl w-full shadow-2xl relative border border-slate-800 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <button onClick={() => setShowPlansModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <XIcon className="w-6 h-6" />
            </button>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-white">Manage Subscription Plans</h2>
                <p className="text-xs text-slate-400">Add, remove or customize plans and their features.</p>
              </div>
              <button 
                type="button"
                onClick={addPlan}
                className="flex items-center gap-1 bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-2 rounded-xl font-medium transition-colors"
              >
                <PlusIcon className="w-4 h-4" /> Add Plan
              </button>
            </div>
            
            <form onSubmit={handleSavePlans} className="space-y-4">
              {plans.map((p, index) => (
                <div key={p.id || index} className="bg-slate-800/50 p-4 rounded-2xl border border-slate-800 space-y-3 relative">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-purple-400">Package {index + 1}</span>
                    {plans.length > 1 && (
                      <button 
                        type="button" 
                        onClick={() => removePlan(index)}
                        className="text-red-400 hover:text-red-300 text-xs font-medium px-2 py-1 bg-red-950/30 rounded border border-red-900/50 transition-colors"
                      >
                        Remove Plan
                      </button>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Plan Name</label>
                      <input
                        type="text"
                        required
                        className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none"
                        value={p.name}
                        onChange={(e) => {
                          const updated = [...plans];
                          updated[index].name = e.target.value;
                          setPlans(updated);
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Price (₹)</label>
                      <input
                        type="number"
                        required
                        className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none"
                        value={p.price}
                        onChange={(e) => {
                          const updated = [...plans];
                          updated[index].price = Number(e.target.value);
                          setPlans(updated);
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Features (Comma-separated)</label>
                    <input
                      type="text"
                      placeholder="Feature 1, Feature 2, Feature 3"
                      className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none"
                      defaultValue={Array.isArray(p.features) ? p.features.join(', ') : ''}
                      onBlur={(e) => {
                        const updated = [...plans];
                        updated[index].features = e.target.value.split(',').map(f => f.trim()).filter(Boolean);
                        setPlans(updated);
                      }}
                    />
                  </div>
                </div>
              ))}
              <button type="submit" className="mt-4 w-full bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-xl font-medium transition-colors">
                Save Plans & Features
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 2. API, Razorpay, Firebase & EmailJS Keys Modal */}
      {showKeysModal && (
        <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center z-[100] backdrop-blur-sm p-4">
          <div className="bg-slate-900 p-8 rounded-3xl max-w-lg w-full shadow-2xl relative border border-slate-800 max-h-[90vh] overflow-y-auto">
            <button onClick={() => setShowKeysModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <XIcon className="w-6 h-6" />
            </button>
            <h2 className="text-xl font-bold text-white mb-2">API, Payment, Firebase & EmailJS Keys</h2>
            <p className="text-xs text-slate-400 mb-6">Manage Gemini AI, Razorpay, Firebase, and EmailJS configuration.</p>
            
            <form onSubmit={handleSaveKeys} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1 text-blue-400 font-semibold">Gemini AI API Key</label>
                <input
                  type="text"
                  placeholder="AQ..."
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-blue-500/50 text-white text-sm outline-none"
                  value={keysConfig.geminiApiKey}
                  onChange={(e) => setKeysConfig({...keysConfig, geminiApiKey: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Razorpay Key ID</label>
                <input
                  type="text"
                  placeholder="rzp_live_..."
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none"
                  value={keysConfig.razorpayKeyId}
                  onChange={(e) => setKeysConfig({...keysConfig, razorpayKeyId: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Razorpay Key Secret</label>
                <input
                  type="password"
                  placeholder="Secret key"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none"
                  value={keysConfig.razorpayKeySecret}
                  onChange={(e) => setKeysConfig({...keysConfig, razorpayKeySecret: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Firebase API Key</label>
                <input
                  type="text"
                  placeholder="AIzaSy..."
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none"
                  value={keysConfig.firebaseApiKey}
                  onChange={(e) => setKeysConfig({...keysConfig, firebaseApiKey: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Firebase Project ID</label>
                <input
                  type="text"
                  placeholder="casemate-78759"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none"
                  value={keysConfig.firebaseProjectId}
                  onChange={(e) => setKeysConfig({...keysConfig, firebaseProjectId: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Auth Domain</label>
                <input
                  type="text"
                  placeholder="casemate-78759.firebaseapp.com"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none"
                  value={keysConfig.authDomain}
                  onChange={(e) => setKeysConfig({...keysConfig, authDomain: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Storage Bucket</label>
                <input
                  type="text"
                  placeholder="casemate-78759.firebasestorage.app"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none"
                  value={keysConfig.storageBucket}
                  onChange={(e) => setKeysConfig({...keysConfig, storageBucket: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Messaging Sender ID</label>
                <input
                  type="text"
                  placeholder="556075485433"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none"
                  value={keysConfig.messagingSenderId}
                  onChange={(e) => setKeysConfig({...keysConfig, messagingSenderId: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">App ID</label>
                <input
                  type="text"
                  placeholder="1:556075485433:web:..."
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none"
                  value={keysConfig.appId}
                  onChange={(e) => setKeysConfig({...keysConfig, appId: e.target.value})}
                />
              </div>

              {/* EmailJS Fields */}
              <div className="border-t border-slate-800 pt-4 mt-4 space-y-4">
                <h3 className="text-sm font-semibold text-amber-400">EmailJS Configuration</h3>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">EmailJS Service ID</label>
                  <input
                    type="text"
                    placeholder="service_xxxxx"
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none"
                    value={keysConfig.emailServiceId}
                    onChange={(e) => setKeysConfig({...keysConfig, emailServiceId: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">EmailJS Public Key</label>
                  <input
                    type="text"
                    placeholder="Public key string"
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none"
                    value={keysConfig.emailPublicKey}
                    onChange={(e) => setKeysConfig({...keysConfig, emailPublicKey: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Welcome Email Template ID</label>
                  <input
                    type="text"
                    placeholder="template_xxxxx"
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none"
                    value={keysConfig.welcomeTemplateId}
                    onChange={(e) => setKeysConfig({...keysConfig, welcomeTemplateId: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Plan Purchase Email Template ID</label>
                  <input
                    type="text"
                    placeholder="template_xxxxx"
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none"
                    value={keysConfig.purchaseTemplateId}
                    onChange={(e) => setKeysConfig({...keysConfig, purchaseTemplateId: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Expiry Alert Email Template ID</label>
                  <input
                    type="text"
                    placeholder="template_xxxxx"
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none"
                    value={keysConfig.expiryTemplateId}
                    onChange={(e) => setKeysConfig({...keysConfig, expiryTemplateId: e.target.value})}
                  />
                </div>
              </div>

              <button type="submit" className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-medium transition-colors">
                Save All Keys
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 3. Global Broadcast Announcement Modal */}
      {showAnnouncementModal && (
        <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center z-[100] backdrop-blur-sm p-4">
          <div className="bg-slate-900 p-8 rounded-3xl max-w-md w-full shadow-2xl relative border border-slate-800">
            <button onClick={() => setShowAnnouncementModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <XIcon className="w-6 h-6" />
            </button>
            <h2 className="text-xl font-bold text-white mb-2">Broadcast Announcement</h2>
            <p className="text-xs text-slate-400 mb-6">This message will appear with animation on all users' home screens.</p>
            
            <form onSubmit={handleSaveAnnouncement} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Announcement Message</label>
                <textarea
                  rows={3}
                  required
                  placeholder="e.g., New AI features added! Update your app..."
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none resize-none"
                  value={announcementText}
                  onChange={(e) => setAnnouncementText(e.target.value)}
                />
              </div>
              <button type="submit" className="mt-4 w-full bg-amber-600 hover:bg-amber-700 text-white py-3 rounded-xl font-medium transition-colors">
                Publish Announcement
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Admin Credentials Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center z-[100] backdrop-blur-sm p-4">
          <div className="bg-slate-900 p-8 rounded-3xl max-w-md w-full shadow-2xl relative border border-slate-800">
            <button onClick={() => setShowSettings(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <XIcon className="w-6 h-6" />
            </button>
            <h2 className="text-xl font-bold text-white mb-6">{t.changeAdminCreds}</h2>
            
            <form onSubmit={handleSaveCreds} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">{t.newAdminEmail}</label>
                <input
                  type="email"
                  required
                  className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white outline-none"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">{t.newAdminPassword}</label>
                <input
                  type="text"
                  required
                  className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white outline-none"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                />
              </div>
              <button type="submit" className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-medium transition-colors">
                {t.updateCreds}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};