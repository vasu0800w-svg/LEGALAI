import React, { useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { LogoutIcon, SettingsIcon, XIcon, EditIcon, PlusIcon } from './Icons';
import { BrandLogo } from './BrandLogo';
import { translations } from '../utils/translations';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { auth } from '../services/firebaseService';
import { saveAppConfig, getAppConfig, saveCloudAdminConfig, saveAppConfigDetailed, CloudLegalTemplate, ensureConfigWriteAuth, verifyAdminSession } from '../services/adminConfigService';
import { ADMIN_EMAIL } from '../utils/adminIdentity';
import { PLAN_FEATURES, DEFAULT_PLAN_PRICES, UNLIMITED_EMAIL_LIST, isUnlimitedEmail, sanitizeSubscriptionPlans, sanitizeFreePlanLimits, DEFAULT_FREE_PLAN_LIMITS, applyFreePlanConfig, PlanLimits } from '../utils/planLimits';
import { subscribeUserDirectory, DirectoryUser } from '../services/userDirectoryService';
import { subscribeSiteStats, SiteStats } from '../services/siteStatsService';
import { PREDEFINED_TEMPLATES } from '../utils/templates';

interface UserStats {
  id: string;
  name: string;
  email: string;
  plan: string;
  lastSeen: number;
  createdAt: number;
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
  const [siteStats, setSiteStats] = useState<SiteStats>({ visits: 0, logins: 0, signups: 0 });
  const [siteStatsError, setSiteStatsError] = useState('');
  const [directoryError, setDirectoryError] = useState('');
  const [directoryReady, setDirectoryReady] = useState(false);
  const [promo14, setPromo14] = useState('');
  const [promoAlways, setPromoAlways] = useState('');
  const [promoNote, setPromoNote] = useState('');
  const [promoSaving, setPromoSaving] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [showSettings, setShowSettings] = useState(false);
  const [showPlansModal, setShowPlansModal] = useState(false);
  const [showKeysModal, setShowKeysModal] = useState(false);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [isSavingCloud, setIsSavingCloud] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  // Dynamic Plans with customizable features & add/remove support
  const [plans, setPlans] = useState<PlanConfig[]>([
    { id: 'basic', name: 'Casemate Basic', price: DEFAULT_PLAN_PRICES.basic, features: [...PLAN_FEATURES.basic] },
    { id: 'pro', name: 'Casemate Pro', price: DEFAULT_PLAN_PRICES.pro, features: [...PLAN_FEATURES.pro] },
    { id: 'annual', name: 'Annual Plan', price: DEFAULT_PLAN_PRICES.annual, features: [...PLAN_FEATURES.annual] }
  ]);
  const [freeLimits, setFreeLimits] = useState<PlanLimits>(DEFAULT_FREE_PLAN_LIMITS);

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
    const tick = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    let unsubDirectory = () => {};
    let unsubSiteStats = () => {};
    let cancelled = false;
    try {
      localStorage.removeItem('casemate_admin_creds');
    } catch {
      /* ignore */
    }

    void (async () => {
      const started = Date.now();
      while (!auth.currentUser && Date.now() - started < 4000) {
        await new Promise((r) => setTimeout(r, 150));
        if (cancelled) return;
      }
      const ok = await verifyAdminSession();
      if (!cancelled && !ok) void logout();
    })();

    void ensureConfigWriteAuth()
      .then((ok) => {
        if (cancelled) return;
        if (!ok) {
          setDirectoryError('Admin Firebase sign-in failed. Log out, then sign in again with the admin email and password that exist in Firebase Authentication.');
          setSiteStatsError('Admin Firebase sign-in failed, so visit and login counts cannot load.');
          setDirectoryReady(true);
          return;
        }
        unsubSiteStats = subscribeSiteStats((next, error) => {
          setSiteStats(next);
          setSiteStatsError(error || '');
        });
        void getAppConfig<{ code14?: string; codeAlways?: string }>('promo_codes').then((data) => {
          if (cancelled) return;
          setPromo14(String(data?.code14 || ''));
          setPromoAlways(String(data?.codeAlways || ''));
        }).catch(() => {});
        unsubDirectory = subscribeUserDirectory((users: DirectoryUser[], error) => {
          setDirectoryReady(true);
          if (error) {
            setDirectoryError(error);
            return;
          }
          setDirectoryError('');
          setStats(users);
        });
      })
      .catch(() => {
        if (cancelled) return;
        setDirectoryError('Could not load live users.');
        setDirectoryReady(true);
      });

    // Load plans — prefer cloud so admin phone matches all users
    (async () => {
      const cloudPlans = await getAppConfig<{ plans?: PlanConfig[]; freeLimits?: PlanLimits }>('plans');
      if (cloudPlans?.freeLimits) {
        const cleanedFree = sanitizeFreePlanLimits(cloudPlans.freeLimits);
        setFreeLimits(cleanedFree);
        applyFreePlanConfig(cleanedFree);
      }
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

    return () => {
      cancelled = true;
      unsubDirectory();
      unsubSiteStats();
    };
  }, [logout]);

  const formatLastSeen = (ts: number) => {
    if (!ts) return 'Not yet';
    const diff = nowTick - ts;
    if (diff < 2 * 60 * 1000) return 'Online now';
    if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / 60000))} min ago`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} hr ago`;
    return new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  };

  const handleSaveCreds = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordMsg('');
    if (!newPassword || newPassword.length < 6) {
      setPasswordError(t.passwordTooShort || 'Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t.passwordMismatch || 'New passwords do not match.');
      return;
    }
    const firebaseUser = auth.currentUser;
    if (!firebaseUser?.email) {
      setPasswordError(t.passwordNeedLogin || 'Please sign out and sign in again, then try changing password.');
      return;
    }
    setIsUpdatingPassword(true);
    try {
      const credential = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
      await reauthenticateWithCredential(firebaseUser, credential);
      await updatePassword(firebaseUser, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMsg(t.passwordUpdated || 'Password updated successfully.');
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setPasswordError(t.wrongCurrentPassword || 'Current password is incorrect.');
      } else if (code === 'auth/weak-password') {
        setPasswordError(t.passwordTooShort || 'Password must be at least 6 characters.');
      } else if (code === 'auth/requires-recent-login') {
        setPasswordError(t.passwordNeedLogin || 'Please sign out and sign in again, then try changing password.');
      } else {
        setPasswordError('Could not update password.');
      }
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const handleSavePlans = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingCloud(true);
    try {
      const cleaned = sanitizeSubscriptionPlans(plans);
      const cleanedFree = sanitizeFreePlanLimits(freeLimits);
      setPlans(cleaned);
      setFreeLimits(cleanedFree);
      applyFreePlanConfig(cleanedFree);
      localStorage.setItem('casemate_subscription_plans', JSON.stringify(cleaned));
      const result = await saveAppConfigDetailed('plans', { plans: cleaned, freeLimits: cleanedFree });
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
  const usingNow = stats.filter((s) => nowTick - s.lastSeen < 5 * 60 * 1000).length;
  const activeToday = stats.filter((s) => nowTick - s.lastSeen < 24 * 60 * 60 * 1000).length;
  const activeWeek = stats.filter((s) => nowTick - s.lastSeen < 7 * 24 * 60 * 60 * 1000).length;
  const istDay = new Date(nowTick).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const joinedToday = stats.filter((s) => s.createdAt && new Date(s.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === istDay).length;
  const paidUsers = stats.filter((s) => s.plan && s.plan !== 'free' && s.plan !== 'unlimited').length;
  const freeUsers = stats.filter((s) => !s.plan || s.plan === 'free').length;
  const unlimitedUsers = stats.filter((s) => s.plan === 'unlimited' || isUnlimitedEmail(s.email)).length;
  const seenEmails = new Set(stats.map((s) => s.email.trim().toLowerCase()));
  const checkoutKey = String((import.meta as any).env?.VITE_RAZORPAY_KEY_ID || '');
  const checkoutLive = checkoutKey.startsWith('rzp_live_');

  const statCards = [
    { label: 'Website visits', value: siteStats.visits, hint: 'One count per browser each day' },
    { label: 'Successful logins', value: siteStats.logins, hint: 'Verified email sign-ins' },
    { label: 'Accounts created', value: siteStats.signups, hint: 'New sign-ups' },
    { label: t.totalUsers || 'Accounts', value: totalUsers, hint: 'Signed-in accounts on record' },
    { label: 'Using now', value: usingNow, hint: 'Active in the last 5 minutes' },
    { label: 'Active today', value: activeToday, hint: 'Opened the app today' },
    { label: 'Active this week', value: activeWeek, hint: 'Opened the app in 7 days' },
    { label: 'Joined today', value: joinedToday, hint: 'New accounts seen today' },
    { label: 'Paid plans', value: paidUsers, hint: 'Basic, Pro, or Annual' },
    { label: 'Free plans', value: freeUsers, hint: 'Still on the free plan' },
    { label: 'Unlimited access', value: unlimitedUsers, hint: 'Tester emails with no limits' },
  ];

  return (
    <div className="h-full min-h-0 overflow-y-auto custom-scrollbar bg-ink text-band-dim flex flex-col font-sans relative">
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
        <div className={`rounded-xl border px-4 py-3 text-sm ${checkoutLive ? 'border-green-500/40 bg-green-950/40 text-green-100' : 'border-amber-500/50 bg-amber-950/50 text-amber-100'}`}>
          {checkoutLive
            ? 'Razorpay checkout on this website is Live. In the Razorpay dashboard, switch the top toggle from Test to Live. Real payments stay hidden while Test is selected.'
            : 'Razorpay checkout on this website is still Test. Put your rzp_live_ key in frontend/.env as VITE_RAZORPAY_KEY_ID and the matching secret on the API server, then deploy again.'}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((card) => (
            <div key={card.label} className="bg-ink-soft border border-ink-border rounded-2xl p-5 shadow-sm">
              <p className="text-xs text-band-mute font-medium">{card.label}</p>
              <p className="text-3xl font-bold text-white mt-1">{card.value}</p>
              <p className="text-[11px] text-band-mute mt-1">{card.hint}</p>
            </div>
          ))}
        </div>

        {siteStatsError && (
          <div className="rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            Visit and login counts failed: {siteStatsError}
          </div>
        )}

        <p className="text-xs text-band-mute -mt-2">
          Visits, logins, and sign-ups start from the next time someone opens the site. “Using now” means the app was open in the last 5 minutes.
        </p>

        {directoryError && (
          <div className="rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            Live user list failed: {directoryError}
          </div>
        )}

        <div className="bg-ink-soft border border-ink-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-ink-border bg-ink-muted/40">
            <h2 className="text-lg font-semibold text-white">Unlimited tester access</h2>
            <p className="text-xs text-band-mute mt-1">These emails skip draft, timer, and fair-use limits once they sign up with this address.</p>
          </div>
          <ul className="divide-y divide-ink-border/80">
            {UNLIMITED_EMAIL_LIST.map((email) => {
              const joined = seenEmails.has(email);
              return (
                <li key={email} className="px-6 py-3 flex items-center justify-between gap-3 text-sm">
                  <span className="text-white truncate">{email}</span>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${joined ? 'text-green-300 border-green-500/40 bg-green-950/40' : 'text-band-mute border-ink-border bg-ink-muted'}`}>
                    {joined ? 'Has opened the app' : 'Not signed in yet'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="bg-ink-soft border border-ink-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-ink-border bg-ink-muted/40">
            <h2 className="text-lg font-semibold text-white">Promo codes</h2>
            <p className="text-xs text-band-mute mt-1">These do not change the unlimited email list above. The 14-day code lasts 14 days from the time it is entered. Changing the always code turns off unlimited for people who used the previous always code. People already inside their 14 days keep those days.</p>
          </div>
          <form
            className="px-6 py-4 space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setPromoSaving(true);
              setPromoNote('');
              const saved = await saveAppConfigDetailed('promo_codes', {
                code14: promo14.trim().toUpperCase().replace(/\s+/g, ''),
                codeAlways: promoAlways.trim().toUpperCase().replace(/\s+/g, ''),
              });
              setPromoSaving(false);
              setPromoNote(saved.ok ? 'Promo codes saved.' : (saved.error || 'Could not save promo codes.'));
            }}
          >
            <label className="block text-sm text-band-mute">
              14-day unlimited
              <input value={promo14} onChange={(e) => setPromo14(e.target.value)} className="mt-1 w-full rounded-xl border border-ink-border bg-ink px-4 py-3 text-white outline-none" />
            </label>
            <label className="block text-sm text-band-mute">
              Always unlimited
              <input value={promoAlways} onChange={(e) => setPromoAlways(e.target.value)} className="mt-1 w-full rounded-xl border border-ink-border bg-ink px-4 py-3 text-white outline-none" />
            </label>
            <button type="submit" disabled={promoSaving || !promo14.trim() || !promoAlways.trim()} className="rounded-xl bg-white text-black px-4 py-2 text-sm font-semibold disabled:opacity-60">
              {promoSaving ? 'Saving…' : 'Save promo codes'}
            </button>
            {promoNote && <p className="text-sm text-band-mute">{promoNote}</p>}
          </form>
        </div>

        {/* Users Table & Management */}
        <div className="bg-ink-soft border border-ink-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-ink-border bg-ink-muted/40 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Who is using casemate</h2>
            <span className="text-xs text-band-mute">{directoryReady ? 'Live from every device' : 'Loading…'}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-muted/70 text-band-mute border-b border-ink-border">
                <tr>
                  <th className="px-6 py-4 font-medium">{t.userName}</th>
                  <th className="px-6 py-4 font-medium">{t.email}</th>
                  <th className="px-6 py-4 font-medium">{t.plan}</th>
                  <th className="px-6 py-4 font-medium">Last active</th>
                  <th className="px-6 py-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-border/80">
                {stats.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-band-mute italic">
                      {directoryReady ? 'No one has opened the app since live tracking started.' : 'Loading users…'}
                    </td>
                  </tr>
                ) : (
                  stats.map((user) => {
                    const online = nowTick - user.lastSeen < 5 * 60 * 1000;
                    const unlimited = user.plan === 'unlimited' || isUnlimitedEmail(user.email);
                    return (
                    <tr key={user.id} className="hover:bg-ink-muted/40 transition-colors">
                      <td className="px-6 py-4 font-medium text-white">{user.name}</td>
                      <td className="px-6 py-4 text-band-mute">{user.email}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
                          unlimited || user.plan !== 'free' ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-800/50' : 'bg-ink-muted text-band-dim border border-ink-border'
                        }`}>
                          {unlimited ? 'unlimited' : user.plan}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-band-mute text-xs">
                        {formatLastSeen(user.lastSeen)}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-xs font-medium ${online ? 'text-green-400' : 'text-band-mute'}`}>
                          {online ? 'Using now' : 'Away'}
                        </span>
                      </td>
                    </tr>
                    );
                  })
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
              <div className="bg-ink-muted/70 p-4 rounded-2xl border border-ink-border space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-band-dim">Free plan limits</p>
                <p className="text-xs text-band-mute">These apply to every free account. Changing them updates the website and the app. Do not cut an allowance without checking cost.</p>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    ['draftLimit', 'Drafts / month'],
                    ['dailyAiRequests', 'AI requests / day'],
                    ['dailySeconds', 'Daily seconds (0 = off)'],
                    ['maxPhotosPerChat', 'Photos / chat'],
                    ['maxPhotosPerUpload', 'Photos / upload'],
                    ['maxMessageChars', 'Chars / message'],
                    ['maxSessionChars', 'Chars / chat'],
                    ['monthlyAiRequests', 'AI requests / month'],
                    ['monthlyImages', 'Images / month'],
                    ['chatSessionLimit', 'Saved chats'],
                    ['maxDevices', 'Devices'],
                  ] as Array<[keyof PlanLimits, string]>).map(([key, label]) => (
                    <label key={key} className="block text-xs font-medium text-band-mute">
                      {label}
                      <input
                        type="number"
                        min={0}
                        className="mt-1 w-full px-3 py-2 rounded-xl bg-ink-muted border border-ink-border text-white text-sm outline-none"
                        value={Number.isFinite(freeLimits[key] as number) ? Number(freeLimits[key]) : 0}
                        onChange={(e) => setFreeLimits((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                      />
                    </label>
                  ))}
                </div>
              </div>
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
          <div className="bg-ink-soft p-8 rounded-3xl max-w-lg w-full shadow-2xl relative border border-ink-border max-h-[90vh] overflow-y-auto custom-scrollbar">
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
                  readOnly
                  className="w-full px-4 py-3 rounded-xl bg-ink-muted border border-ink-border text-band-mute outline-none"
                  value={ADMIN_EMAIL}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-band-mute mb-1">{t.currentPassword}</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  className="w-full px-4 py-3 rounded-xl bg-ink-muted border border-ink-border text-white outline-none"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-band-mute mb-1">{t.newPassword}</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  className="w-full px-4 py-3 rounded-xl bg-ink-muted border border-ink-border text-white outline-none"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-band-mute mb-1">{t.confirmNewPassword}</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  className="w-full px-4 py-3 rounded-xl bg-ink-muted border border-ink-border text-white outline-none"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              {passwordError && <p className="text-xs text-red-400">{passwordError}</p>}
              {passwordMsg && <p className="text-xs text-green-400">{passwordMsg}</p>}
              <button
                type="submit"
                disabled={isUpdatingPassword}
                className="mt-6 w-full bg-white text-black hover:bg-neutral-200 py-3 rounded-xl font-medium transition-colors disabled:opacity-60"
              >
                {t.updatePassword || t.updateCreds}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};