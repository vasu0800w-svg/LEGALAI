import React, { useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { UsersIcon, ActivityIcon, LogoutIcon, SettingsIcon, XIcon, EditIcon, PlusIcon } from './Icons';
import { BrandLogo } from './BrandLogo';
import { translations } from '../utils/translations';
import { saveAppConfig, getAppConfig, saveCloudAdminConfig, saveAppConfigDetailed, CloudLegalTemplate, ensureConfigWriteAuth } from '../services/adminConfigService';
import { PLAN_FEATURES, DEFAULT_PLAN_PRICES, sanitizeSubscriptionPlans } from '../utils/planLimits';
import { PREDEFINED_TEMPLATES } from '../utils/templates';

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
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [isSavingCloud, setIsSavingCloud] = useState(false);

  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  // Dynamic Plans with customizable features & add/remove support
  const [plans, setPlans] = useState<PlanConfig[]>([
    { id: 'basic', name: 'Basic Plan', price: DEFAULT_PLAN_PRICES.basic, features: [...PLAN_FEATURES.basic] },
    { id: 'pro', name: 'Pro Plan', price: DEFAULT_PLAN_PRICES.pro, features: [...PLAN_FEATURES.pro] },
    { id: 'annual', name: 'Annual Plan', price: DEFAULT_PLAN_PRICES.annual, features: [...PLAN_FEATURES.annual] }
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

  // Template selector entries (synced to all phones)
  const [editableTemplates, setEditableTemplates] = useState<CloudLegalTemplate[]>([
    { id: 'bail', name: 'Bail Application', content: PREDEFINED_TEMPLATES.bail },
    { id: 'notice', name: 'Legal Notice', content: PREDEFINED_TEMPLATES.notice },
    { id: 'divorce', name: 'Divorce Petition', content: PREDEFINED_TEMPLATES.divorce },
    { id: 'nda', name: 'NDA', content: PREDEFINED_TEMPLATES.nda },
  ]);

  useEffect(() => {
    loadUsers();

    // Ensure Firebase Auth so cloud writes succeed (email/password admin account)
    void ensureConfigWriteAuth().catch((e) => console.warn('Admin Firebase auth failed', e));

    // Load credentials
    const creds = JSON.parse(localStorage.getItem('casemate_admin_creds') || '{"email":"admin@casemate.com","password":"admin123"}');
    setAdminEmail(creds.email);
    setAdminPassword(creds.password);

    // Load plans — prefer cloud so admin phone matches all users
    (async () => {
      const cloudPlans = await getAppConfig<{ plans?: PlanConfig[] }>('plans');
      if (cloudPlans?.plans && Array.isArray(cloudPlans.plans) && cloudPlans.plans.length > 0) {
        const cleaned = sanitizeSubscriptionPlans(cloudPlans.plans);
        setPlans(cleaned);
        localStorage.setItem('casemate_subscription_plans', JSON.stringify(cleaned));
      } else {
        const savedPlans = localStorage.getItem('casemate_subscription_plans');
        if (savedPlans) {
          try {
            const parsed: PlanConfig[] = JSON.parse(savedPlans);
            const cleaned = sanitizeSubscriptionPlans(parsed);
            setPlans(cleaned);
            localStorage.setItem('casemate_subscription_plans', JSON.stringify(cleaned));
          } catch (e) { console.error(e); }
        }
      }

      const cloudAnn = await getAppConfig<{ text?: string }>('announcement');
      if (typeof cloudAnn?.text === 'string') {
        setAnnouncementText(cloudAnn.text);
        localStorage.setItem('casemate_announcement', cloudAnn.text);
      } else {
        setAnnouncementText(localStorage.getItem('casemate_announcement') || '');
      }

      const cloudTemplates = await getAppConfig<{ templates?: CloudLegalTemplate[] }>('templates');
      if (cloudTemplates?.templates && Array.isArray(cloudTemplates.templates) && cloudTemplates.templates.length > 0) {
        setEditableTemplates(cloudTemplates.templates);
        localStorage.setItem('casemate_cloud_templates', JSON.stringify(cloudTemplates.templates));
      } else {
        try {
          const saved = localStorage.getItem('casemate_cloud_templates');
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) setEditableTemplates(parsed);
          }
        } catch { /* ignore */ }
      }
    })();

    // Load API/Payment, Firebase & EmailJS Keys
    const savedKeys = localStorage.getItem('casemate_api_keys');
    if (savedKeys) {
      try { setKeysConfig(JSON.parse(savedKeys)); } catch (e) { console.error(e); }
    }
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

  const handleSavePlans = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingCloud(true);
    try {
      const cleaned = sanitizeSubscriptionPlans(plans);
      setPlans(cleaned);
      localStorage.setItem('casemate_subscription_plans', JSON.stringify(cleaned));
      const result = await saveAppConfigDetailed('plans', { plans: cleaned });
      setShowPlansModal(false);
      alert(result.ok ? 'Subscription plans updated on all devices.' : (result.error || 'Cloud save failed.'));
    } finally {
      setIsSavingCloud(false);
    }
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

  const handleSaveAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingCloud(true);
    try {
      localStorage.setItem('casemate_announcement', announcementText);
      const result = await saveAppConfigDetailed('announcement', { text: announcementText });
      setShowAnnouncementModal(false);
      alert(result.ok ? 'Announcement broadcast to all devices.' : (result.error || 'Cloud save failed.'));
    } finally {
      setIsSavingCloud(false);
    }
  };

  const handleSaveTemplates = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = editableTemplates
      .map((t) => ({
        id: String(t.id || '').trim(),
        name: String(t.name || '').trim(),
        content: String(t.content || '').trim(),
      }))
      .filter((t) => t.id && t.name && t.content);
    if (cleaned.length === 0) {
      alert('Add at least one template with id, name, and content.');
      return;
    }
    setIsSavingCloud(true);
    try {
      localStorage.setItem('casemate_cloud_templates', JSON.stringify(cleaned));
      const result = await saveAppConfigDetailed('templates', { templates: cleaned });
      setShowTemplatesModal(false);
      alert(result.ok ? 'Templates updated on all devices.' : (result.error || 'Cloud save failed.'));
    } finally {
      setIsSavingCloud(false);
    }
  };

  const addTemplate = () => {
    setEditableTemplates((prev) => [
      ...prev,
      {
        id: `tpl_${Date.now()}`,
        name: 'New Template',
        content: '[CENTER]**[U]TITLE[/U]**[/CENTER]\n\n1. ...\n[INSERT FACTS]\n',
      },
    ]);
  };

  const removeTemplate = (index: number) => {
    setEditableTemplates((prev) => prev.filter((_, i) => i !== index));
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
    <div className="min-h-screen bg-ink text-band-dim flex flex-col font-sans relative">
      {/* Header */}
      <header className="bg-ink-soft border-b border-ink-border px-6 py-4 flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 brand-ring flex items-center justify-center">
            <BrandLogo size={36} className="rounded-full" />
          </div>
          <div>
            <h1 className="text-xl font-display font-semibold tracking-wide text-band">{t.adminDashboard}</h1>
            <p className="text-xs text-band-mute">Complete Master Control Panel</p>
          </div>
        </div>
        
        {/* Quick Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button 
            onClick={() => setShowPlansModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 text-band-dim border border-ink-border rounded-lg text-xs font-medium transition-colors"
          >
            <EditIcon className="w-4 h-4" /> Plans
          </button>
          <button 
            onClick={() => setShowKeysModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 text-band-dim border border-ink-border rounded-lg text-xs font-medium transition-colors"
          >
            <SettingsIcon className="w-4 h-4" /> API & Keys
          </button>
          <button 
            onClick={() => setShowTemplatesModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-medium transition-colors"
          >
            <EditIcon className="w-4 h-4" /> Templates
          </button>
          <button 
            onClick={() => setShowAnnouncementModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-medium transition-colors"
          >
            <EditIcon className="w-4 h-4" /> Broadcast
          </button>
          <button 
            onClick={() => setShowSettings(true)}
            className="p-2 bg-ink-muted hover:bg-neutral-800 text-band-dim rounded-lg border border-ink-border transition-colors"
            title="Settings"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>
          <button 
            onClick={logout}
            className="p-2 bg-ink-muted hover:bg-neutral-800 text-red-400 rounded-lg border border-ink-border transition-colors"
            title="Logout"
          >
            <LogoutIcon className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-ink-soft border border-ink-border rounded-2xl p-6 flex items-center gap-4 shadow-sm">
            <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center border border-ink-border">
              <UsersIcon className="w-6 h-6 text-band-dim" />
            </div>
            <div>
              <p className="text-sm text-band-mute font-medium">{t.totalUsers}</p>
              <p className="text-3xl font-bold text-white">{totalUsers}</p>
            </div>
          </div>
          <div className="bg-ink-soft border border-ink-border rounded-2xl p-6 flex items-center gap-4 shadow-sm">
            <div className="w-12 h-12 bg-yellow-900/30 rounded-full flex items-center justify-center border border-yellow-800/50">
              <ActivityIcon className="w-6 h-6 text-yellow-400" />
            </div>
            <div>
              <p className="text-sm text-band-mute font-medium">Paid Users</p>
              <p className="text-3xl font-bold text-white">{paidUsers}</p>
            </div>
          </div>
          <div className="bg-ink-soft border border-ink-border rounded-2xl p-6 flex items-center gap-4 shadow-sm">
            <div className="w-12 h-12 bg-ink-muted rounded-full flex items-center justify-center border border-ink-border">
              <UsersIcon className="w-6 h-6 text-band-mute" />
            </div>
            <div>
              <p className="text-sm text-band-mute font-medium">{t.freeUsers}</p>
              <p className="text-3xl font-bold text-white">{freeUsers}</p>
            </div>
          </div>
        </div>

        {/* Users Table & Management */}
        <div className="bg-ink-soft border border-ink-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-ink-border bg-ink-muted/40 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Registered Users & Control</h2>
            <span className="text-xs text-band-mute">Manage user status & access</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-muted/70 text-band-mute border-b border-ink-border">
                <tr>
                  <th className="px-6 py-4 font-medium">{t.userName}</th>
                  <th className="px-6 py-4 font-medium">{t.email}</th>
                  <th className="px-6 py-4 font-medium">{t.plan}</th>
                  <th className="px-6 py-4 font-medium">Activity</th>
                  <th className="px-6 py-4 font-medium">Status Control</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-border/80">
                {stats.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-band-mute italic">
                      No users registered yet.
                    </td>
                  </tr>
                ) : (
                  stats.map((user) => (
                    <tr key={user.id} className="hover:bg-ink-muted/40 transition-colors">
                      <td className="px-6 py-4 font-medium text-white">{user.name}</td>
                      <td className="px-6 py-4 text-band-mute">{user.email}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
                          user.plan !== 'free' ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-800/50' : 'bg-ink-muted text-band-dim border border-ink-border'
                        }`}>
                          {user.plan}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-band-mute text-xs">
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
        <div className="fixed inset-0 bg-ink/85 flex items-center justify-center z-[100] backdrop-blur-sm p-4">
          <div className="bg-ink-soft p-8 rounded-3xl max-w-xl w-full shadow-2xl relative border border-ink-border max-h-[90vh] overflow-y-auto custom-scrollbar">
            <button onClick={() => setShowPlansModal(false)} className="absolute top-4 right-4 text-band-mute hover:text-white">
              <XIcon className="w-6 h-6" />
            </button>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-white">Manage Subscription Plans</h2>
                <p className="text-xs text-band-mute">Add, remove or customize plans and their features.</p>
              </div>
              <button 
                type="button"
                onClick={addPlan}
                className="flex items-center gap-1 bg-white text-black hover:bg-neutral-200 text-xs px-3 py-2 rounded-xl font-medium transition-colors"
              >
                <PlusIcon className="w-4 h-4" /> Add Plan
              </button>
            </div>
            
            <form onSubmit={handleSavePlans} className="space-y-4">
              {plans.map((p, index) => (
                <div key={p.id || index} className="bg-ink-muted/70 p-4 rounded-2xl border border-ink-border space-y-3 relative">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-band-dim">Package {index + 1}</span>
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
                      <label className="block text-xs font-medium text-band-mute mb-1">Plan Name</label>
                      <input
                        type="text"
                        required
                        className="w-full px-3 py-2 rounded-xl bg-ink-muted border border-ink-border text-white text-sm outline-none"
                        value={p.name}
                        onChange={(e) => {
                          const updated = [...plans];
                          updated[index] = { ...updated[index], name: e.target.value };
                          setPlans(updated);
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-band-mute mb-1">Price (₹)</label>
                      <input
                        type="number"
                        required
                        min={1}
                        className="w-full px-3 py-2 rounded-xl bg-ink-muted border border-ink-border text-white text-sm outline-none"
                        value={p.price}
                        onChange={(e) => {
                          const updated = [...plans];
                          updated[index] = { ...updated[index], price: Number(e.target.value) };
                          setPlans(updated);
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-band-mute mb-1">Features (Comma-separated)</label>
                      <input
                        type="text"
                        placeholder="Feature 1, Feature 2, Feature 3"
                        className="w-full px-3 py-2 rounded-xl bg-ink-muted border border-ink-border text-white text-sm outline-none"
                        value={Array.isArray(p.features) ? p.features.join(', ') : ''}
                        onChange={(e) => {
                          const updated = [...plans];
                          updated[index] = {
                            ...updated[index],
                            features: e.target.value.split(',').map((f) => f.trimStart()),
                          };
                          setPlans(updated);
                        }}
                      />
                  </div>
                </div>
              ))}
              <button type="submit" disabled={isSavingCloud} className="mt-4 w-full bg-white text-black hover:bg-neutral-200 py-3 rounded-xl font-medium transition-colors disabled:opacity-60">
                {isSavingCloud ? 'Saving to all devices…' : 'Save Plans & Features'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 2. API, Razorpay, Firebase & EmailJS Keys Modal */}
      {showKeysModal && (
        <div className="fixed inset-0 bg-ink/85 flex items-center justify-center z-[100] backdrop-blur-sm p-4">
          <div className="bg-ink-soft p-8 rounded-3xl max-w-lg w-full shadow-2xl relative border border-ink-border max-h-[90vh] overflow-y-auto">
            <button onClick={() => setShowKeysModal(false)} className="absolute top-4 right-4 text-band-mute hover:text-white">
              <XIcon className="w-6 h-6" />
            </button>
            <h2 className="text-xl font-bold text-white mb-2">API, Payment, Firebase & EmailJS Keys</h2>
            <p className="text-xs text-band-mute mb-6">Manage Gemini AI, Razorpay, Firebase, and EmailJS configuration.</p>
            
            <form onSubmit={handleSaveKeys} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-band-mute mb-1 text-band-dim font-semibold">Gemini AI API Key</label>
                <input
                  type="text"
                  placeholder="AQ..."
                  className="w-full px-3 py-2.5 rounded-xl bg-ink-muted border border-white/30 text-white text-sm outline-none"
                  value={keysConfig.geminiApiKey}
                  onChange={(e) => setKeysConfig({...keysConfig, geminiApiKey: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-band-mute mb-1">Razorpay Key ID</label>
                <input
                  type="text"
                  placeholder="rzp_live_..."
                  className="w-full px-3 py-2.5 rounded-xl bg-ink-muted border border-ink-border text-white text-sm outline-none"
                  value={keysConfig.razorpayKeyId}
                  onChange={(e) => setKeysConfig({...keysConfig, razorpayKeyId: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-band-mute mb-1">Razorpay Key Secret</label>
                <input
                  type="password"
                  placeholder="Secret key"
                  className="w-full px-3 py-2.5 rounded-xl bg-ink-muted border border-ink-border text-white text-sm outline-none"
                  value={keysConfig.razorpayKeySecret}
                  onChange={(e) => setKeysConfig({...keysConfig, razorpayKeySecret: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-band-mute mb-1">Firebase API Key</label>
                <input
                  type="text"
                  placeholder="AIzaSy..."
                  className="w-full px-3 py-2.5 rounded-xl bg-ink-muted border border-ink-border text-white text-sm outline-none"
                  value={keysConfig.firebaseApiKey}
                  onChange={(e) => setKeysConfig({...keysConfig, firebaseApiKey: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-band-mute mb-1">Firebase Project ID</label>
                <input
                  type="text"
                  placeholder="legalai-78759"
                  className="w-full px-3 py-2.5 rounded-xl bg-ink-muted border border-ink-border text-white text-sm outline-none"
                  value={keysConfig.firebaseProjectId}
                  onChange={(e) => setKeysConfig({...keysConfig, firebaseProjectId: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-band-mute mb-1">Auth Domain</label>
                <input
                  type="text"
                  placeholder="legalai-78759.firebaseapp.com"
                  className="w-full px-3 py-2.5 rounded-xl bg-ink-muted border border-ink-border text-white text-sm outline-none"
                  value={keysConfig.authDomain}
                  onChange={(e) => setKeysConfig({...keysConfig, authDomain: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-band-mute mb-1">Storage Bucket</label>
                <input
                  type="text"
                  placeholder="legalai-78759.firebasestorage.app"
                  className="w-full px-3 py-2.5 rounded-xl bg-ink-muted border border-ink-border text-white text-sm outline-none"
                  value={keysConfig.storageBucket}
                  onChange={(e) => setKeysConfig({...keysConfig, storageBucket: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-band-mute mb-1">Messaging Sender ID</label>
                <input
                  type="text"
                  placeholder="556075485433"
                  className="w-full px-3 py-2.5 rounded-xl bg-ink-muted border border-ink-border text-white text-sm outline-none"
                  value={keysConfig.messagingSenderId}
                  onChange={(e) => setKeysConfig({...keysConfig, messagingSenderId: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-band-mute mb-1">App ID</label>
                <input
                  type="text"
                  placeholder="1:556075485433:web:..."
                  className="w-full px-3 py-2.5 rounded-xl bg-ink-muted border border-ink-border text-white text-sm outline-none"
                  value={keysConfig.appId}
                  onChange={(e) => setKeysConfig({...keysConfig, appId: e.target.value})}
                />
              </div>

              {/* EmailJS Fields */}
              <div className="border-t border-ink-border pt-4 mt-4 space-y-4">
                <h3 className="text-sm font-semibold text-amber-400">EmailJS Configuration</h3>
                <div>
                  <label className="block text-xs font-medium text-band-mute mb-1">EmailJS Service ID</label>
                  <input
                    type="text"
                    placeholder="service_xxxxx"
                    className="w-full px-3 py-2.5 rounded-xl bg-ink-muted border border-ink-border text-white text-sm outline-none"
                    value={keysConfig.emailServiceId}
                    onChange={(e) => setKeysConfig({...keysConfig, emailServiceId: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-band-mute mb-1">EmailJS Public Key</label>
                  <input
                    type="text"
                    placeholder="Public key string"
                    className="w-full px-3 py-2.5 rounded-xl bg-ink-muted border border-ink-border text-white text-sm outline-none"
                    value={keysConfig.emailPublicKey}
                    onChange={(e) => setKeysConfig({...keysConfig, emailPublicKey: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-band-mute mb-1">Welcome Email Template ID</label>
                  <input
                    type="text"
                    placeholder="template_xxxxx"
                    className="w-full px-3 py-2.5 rounded-xl bg-ink-muted border border-ink-border text-white text-sm outline-none"
                    value={keysConfig.welcomeTemplateId}
                    onChange={(e) => setKeysConfig({...keysConfig, welcomeTemplateId: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-band-mute mb-1">Plan Purchase Email Template ID</label>
                  <input
                    type="text"
                    placeholder="template_xxxxx"
                    className="w-full px-3 py-2.5 rounded-xl bg-ink-muted border border-ink-border text-white text-sm outline-none"
                    value={keysConfig.purchaseTemplateId}
                    onChange={(e) => setKeysConfig({...keysConfig, purchaseTemplateId: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-band-mute mb-1">Expiry Alert Email Template ID</label>
                  <input
                    type="text"
                    placeholder="template_xxxxx"
                    className="w-full px-3 py-2.5 rounded-xl bg-ink-muted border border-ink-border text-white text-sm outline-none"
                    value={keysConfig.expiryTemplateId}
                    onChange={(e) => setKeysConfig({...keysConfig, expiryTemplateId: e.target.value})}
                  />
                </div>
              </div>

              <button type="submit" className="mt-4 w-full bg-white text-black hover:bg-neutral-200 py-3 rounded-xl font-medium transition-colors">
                Save All Keys
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 3. Global Broadcast Announcement Modal */}
      {showAnnouncementModal && (
        <div className="fixed inset-0 bg-ink/85 flex items-center justify-center z-[100] backdrop-blur-sm p-4">
          <div className="bg-ink-soft p-8 rounded-3xl max-w-md w-full shadow-2xl relative border border-ink-border">
            <button onClick={() => setShowAnnouncementModal(false)} className="absolute top-4 right-4 text-band-mute hover:text-white">
              <XIcon className="w-6 h-6" />
            </button>
            <h2 className="text-xl font-bold text-white mb-2">Broadcast Announcement</h2>
            <p className="text-xs text-band-mute mb-6">This message will appear with animation on all users' home screens.</p>
            
            <form onSubmit={handleSaveAnnouncement} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-band-mute mb-1">Announcement Message</label>
                <textarea
                  rows={3}
                  required
                  placeholder="e.g., New AI features added! Update your app..."
                  className="w-full px-3 py-2.5 rounded-xl bg-ink-muted border border-ink-border text-white text-sm outline-none resize-none"
                  value={announcementText}
                  onChange={(e) => setAnnouncementText(e.target.value)}
                />
              </div>
              <button type="submit" disabled={isSavingCloud} className="mt-4 w-full bg-amber-600 hover:bg-amber-700 text-white py-3 rounded-xl font-medium transition-colors disabled:opacity-60">
                {isSavingCloud ? 'Publishing…' : 'Publish Announcement'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 4. Templates for in-app selector */}
      {showTemplatesModal && (
        <div className="fixed inset-0 bg-ink/85 flex items-center justify-center z-[100] backdrop-blur-sm p-4">
          <div className="bg-ink-soft p-8 rounded-3xl max-w-xl w-full shadow-2xl relative border border-ink-border max-h-[90vh] overflow-y-auto custom-scrollbar">
            <button onClick={() => setShowTemplatesModal(false)} className="absolute top-4 right-4 text-band-mute hover:text-white">
              <XIcon className="w-6 h-6" />
            </button>
            <div className="flex items-start justify-between gap-3 mb-2 pr-8">
              <div>
                <h2 className="text-xl font-bold text-white">Document Templates</h2>
                <p className="text-xs text-band-mute mt-1">These appear in the app template selector for every user.</p>
              </div>
              <button
                type="button"
                onClick={addTemplate}
                className="flex items-center gap-1 bg-white text-black hover:bg-neutral-200 text-xs px-3 py-2 rounded-xl font-medium transition-colors"
              >
                <PlusIcon className="w-4 h-4" /> Add
              </button>
            </div>

            <form onSubmit={handleSaveTemplates} className="space-y-4 mt-4">
              {editableTemplates.map((tpl, index) => (
                <div key={`${tpl.id}-${index}`} className="bg-ink-muted/70 p-4 rounded-2xl border border-ink-border space-y-3 relative">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-400">Template {index + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeTemplate(index)}
                      className="text-red-400 hover:text-red-300 text-xs"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-band-mute mb-1">ID (unique key)</label>
                      <input
                        type="text"
                        required
                        value={tpl.id}
                        onChange={(e) => {
                          const next = [...editableTemplates];
                          next[index] = { ...next[index], id: e.target.value };
                          setEditableTemplates(next);
                        }}
                        className="w-full px-3 py-2 rounded-xl bg-ink-soft border border-ink-border text-white text-sm outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-band-mute mb-1">Display Name</label>
                      <input
                        type="text"
                        required
                        value={tpl.name}
                        onChange={(e) => {
                          const next = [...editableTemplates];
                          next[index] = { ...next[index], name: e.target.value };
                          setEditableTemplates(next);
                        }}
                        className="w-full px-3 py-2 rounded-xl bg-ink-soft border border-ink-border text-white text-sm outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-band-mute mb-1">Template Content</label>
                    <textarea
                      rows={6}
                      required
                      value={tpl.content}
                      onChange={(e) => {
                        const next = [...editableTemplates];
                        next[index] = { ...next[index], content: e.target.value };
                        setEditableTemplates(next);
                      }}
                      className="w-full px-3 py-2 rounded-xl bg-ink-soft border border-ink-border text-white text-sm outline-none resize-y font-mono"
                    />
                  </div>
                </div>
              ))}
              <button type="submit" className="mt-2 w-full bg-white text-black hover:bg-neutral-200 py-3 rounded-xl font-medium transition-colors">
                Save Templates to All Devices
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Admin Credentials Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-ink/85 flex items-center justify-center z-[100] backdrop-blur-sm p-4">
          <div className="bg-ink-soft p-8 rounded-3xl max-w-md w-full shadow-2xl relative border border-ink-border">
            <button onClick={() => setShowSettings(false)} className="absolute top-4 right-4 text-band-mute hover:text-white">
              <XIcon className="w-6 h-6" />
            </button>
            <h2 className="text-xl font-bold text-white mb-6">{t.changeAdminCreds}</h2>
            
            <form onSubmit={handleSaveCreds} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-band-mute mb-1">{t.newAdminEmail}</label>
                <input
                  type="email"
                  required
                  className="w-full px-4 py-3 rounded-xl bg-ink-muted border border-ink-border text-white outline-none"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-band-mute mb-1">{t.newAdminPassword}</label>
                <input
                  type="text"
                  required
                  className="w-full px-4 py-3 rounded-xl bg-ink-muted border border-ink-border text-white outline-none"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                />
              </div>
              <button type="submit" className="mt-6 w-full bg-white text-black hover:bg-neutral-200 py-3 rounded-xl font-medium transition-colors">
                {t.updateCreds}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};