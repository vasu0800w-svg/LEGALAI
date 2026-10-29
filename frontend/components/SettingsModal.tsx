import React, { useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { XIcon } from './Icons';
import { UserModeSwitch } from './UserModeSwitch';
import { translations } from '../utils/translations';
import { APP_LANGUAGES } from '../utils/languages';
import { userManual } from '../utils/userManual';
import { auth, sendPasswordReset } from '../services/firebaseService';
import { getPlanLimits, hasUnlimitedAccess, nextIstMidnightLabel, nextMonthResetLabel, istDateKey } from '../utils/planLimits';
import { PromoCodeForm } from './PromoCodeForm';
import { fetchDevices, revokeDevice, RegisteredDevice } from '../services/entitlementsService';
import { getDeviceId } from '../utils/deviceId';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth';
const SUPPORT_EMAIL = 'meetcasemate@gmail.com';
const PRIVACY_URL = 'https://meetcasemate.com/privacy';
const DELETION_URL = 'https://meetcasemate.com/privacy#data-deletion';
const TERMS_URL = 'https://meetcasemate.com/terms';
const REFUND_URL = 'https://meetcasemate.com/refund';

export const SettingsModal = () => {
  const {
    isSettingsOpen,
    setIsSettingsOpen,
    language,
    setLanguage,
    user,
    draftCount,
    usageSeconds,
    chatSessions,
    aiUsage,
    setIsSubscriptionModalOpen,
  } = useAppContext();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [devices, setDevices] = useState<RegisteredDevice[]>([]);
  const [devicesBusy, setDevicesBusy] = useState(false);
  const [devicesMsg, setDevicesMsg] = useState('');
  const t = translations[language] || translations['English'];

  useEffect(() => {
    if (!isSettingsOpen || !user?.id) return;
    let cancelled = false;
    void fetchDevices().then((list) => {
      if (!cancelled) setDevices(list);
    });
    return () => {
      cancelled = true;
    };
  }, [isSettingsOpen, user?.id]);

  const handleRevokeDevice = async (deviceId: string) => {
    setDevicesBusy(true);
    setDevicesMsg('');
    try {
      const next = await revokeDevice(deviceId);
      setDevices(next);
      setDevicesMsg(t.deviceRemoved || 'That device was removed. It can sign in again if a slot is free.');
    } catch (err: any) {
      setDevicesMsg(err?.message || 'Could not remove that device.');
    } finally {
      setDevicesBusy(false);
    }
  };

  if (!isSettingsOpen) return null;

  const openExternal = (url: string) => {
    // Capacitor WebView launches https URLs via system browser / Custom Tabs
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const contactSupport = () => {
    const subject = encodeURIComponent('casemate support request');
    const body = encodeURIComponent(
      `Name: ${user?.name || ''}\nEmail: ${user?.email || ''}\n\nDescribe your issue:\n`
    );
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMsg('');
    setPasswordError('');

    if (!newPassword || newPassword.length < 6) {
      setPasswordError(t.passwordTooShort || 'Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t.passwordMismatch || 'New passwords do not match.');
      return;
    }

    const firebaseUser = auth.currentUser;
    if (!firebaseUser || !firebaseUser.email) {
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
        setPasswordError(err?.message || 'Could not update password.');
      }
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const handleForgotPassword = async () => {
    setPasswordMsg('');
    setPasswordError('');
    const target = (auth.currentUser?.email || user?.email || '').trim();
    if (!target) {
      setPasswordError(t.resetNeedEmail || 'Enter your email address first.');
      return;
    }
    setIsResetting(true);
    try {
      await sendPasswordReset(target);
      setPasswordMsg(t.resetEmailSent || 'Password reset email sent. Check your inbox and spam folder.');
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/too-many-requests') {
        setPasswordError(t.resetTooMany || 'Too many attempts. Please wait a few minutes and try again.');
      } else if (code === 'auth/user-not-found') {
        setPasswordMsg(t.resetEmailSent || 'Password reset email sent. Check your inbox and spam folder.');
      } else {
        setPasswordError(err?.message || 'Could not send reset email.');
      }
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm p-4">
      <div className={`bg-ink-soft rounded-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border border-ink-border ${manualOpen ? 'max-w-lg' : 'max-w-md'}`}>
        <div className="flex items-center justify-between p-5 border-b border-ink-border">
          <h2 className="text-xl font-bold text-white">{manualOpen ? (t.userManual || 'User manual') : t.settings}</h2>
          <button onClick={() => { setManualOpen(false); setIsSettingsOpen(false); }} className="text-band-mute hover:text-white p-1 rounded-full hover:bg-ink-muted transition-colors">
            <XIcon className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1 space-y-8 custom-scrollbar">
          {manualOpen ? (
            <UserManualBody language={language} t={t} onBack={() => setManualOpen(false)} />
          ) : (
            <>
          <section>
            <h3 className="text-sm font-semibold text-band-dim uppercase tracking-wider mb-3">{t.accountProfile || 'Profile'}</h3>
            <div className="border rounded-xl p-5 border-ink-border bg-ink-muted/70 space-y-2">
              <p className="text-sm text-white"><span className="text-band-mute">{t.fullName}: </span>{user?.name || '—'}</p>
              <p className="text-sm text-white break-all"><span className="text-band-mute">{t.email}: </span>{user?.email || '—'}</p>
              <p className="text-xs text-band-mute mt-2">{t.privacyInfo || 'Chats, uploads, and billing stay on this account. Other users cannot open them.'}</p>
            </div>
          </section>

          {/* Language Section */}
          <section>
            <h3 className="text-sm font-semibold text-band-dim uppercase tracking-wider mb-3">{t.appLang}</h3>
            <p className="text-sm text-band-mute mb-4">{t.selectLang}</p>
            <select 
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full p-3 border border-ink-border rounded-xl bg-ink-muted text-white focus:ring-1 focus:ring-white/35 focus:border-white/40 outline-none"
            >
              {APP_LANGUAGES.map((lang) => (
                <option key={lang.id} value={lang.id}>{lang.native}</option>
              ))}
            </select>
          </section>

          {/* Advocate / Judge */}
          <section>
            <h3 className="text-sm font-semibold text-band-dim uppercase tracking-wider mb-3">{t.userModeSettingsTitle || 'Profile type'}</h3>
            <p className="text-sm text-band-mute mb-4">{t.userModeSettingsHint || 'Switching changes only the drafting format and templates. Your chats and plan stay the same.'}</p>
            <UserModeSwitch />
          </section>

          {/* Subscription Section */}
          <section>
            <h3 className="text-sm font-semibold text-band-dim uppercase tracking-wider mb-3">{t.subAndBilling}</h3>
            
            <div className="border rounded-xl p-5 border-ink-border bg-ink-muted/70">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-bold text-lg text-white capitalize">
                    {hasUnlimitedAccess(user?.email, user) ? 'Unlimited' : (user?.plan || 'Free')} {t.plan}
                  </div>
                  <div className="text-sm text-band-mute mt-1">
                    {user?.promoKind === '14d' && user.promoExpiresAt
                      ? `Unlimited until ${new Date(user.promoExpiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`
                      : hasUnlimitedAccess(user?.email, user) || (user?.plan && user.plan !== 'free') ? t.unlimitedAccess : t.freeLimit}
                  </div>
                </div>
                <span className="bg-white/10 text-band border border-ink-border text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide">
                  {t.active}
                </span>
              </div>
            </div>
            {!hasUnlimitedAccess(user?.email, user) && (
              <div className="mt-4">
                <PromoCodeForm />
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setIsSettingsOpen(false);
                setIsSubscriptionModalOpen(true);
              }}
              className="mt-4 w-full py-3 rounded-xl border border-ink-border bg-ink-muted/70 hover:bg-ink-muted text-white font-medium text-sm transition-colors"
            >
              {t.manageSubscription || 'Manage subscription'}
            </button>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-band-dim uppercase tracking-wider mb-3">{t.accountUsage || 'Usage and limits'}</h3>
            <UsageLimits user={user} draftCount={draftCount} usageSeconds={usageSeconds} chatCount={chatSessions.length} aiUsage={aiUsage} t={t} />
            <DeviceManager
              devices={devices}
              maxDevices={getPlanLimits(user?.plan, user?.email, user).maxDevices}
              unlimited={hasUnlimitedAccess(user?.email, user)}
              busy={devicesBusy}
              message={devicesMsg}
              onRevoke={handleRevokeDevice}
              t={t}
            />
          </section>

          {/* Change password */}
          <section>
            <h3 className="text-sm font-semibold text-band-dim uppercase tracking-wider mb-3">{t.changePassword || 'Change password'}</h3>
            <p className="text-sm text-band-mute mb-4">{t.changePasswordHint || 'Update the password for your signed-in account.'}</p>
            <form onSubmit={handleChangePassword} className="space-y-3">
              <PasswordRow
                id="settings-current-password"
                label={t.currentPassword || 'Current password'}
                autoComplete="current-password"
                value={currentPassword}
                onChange={setCurrentPassword}
                visible={showCurrentPassword}
                onToggle={() => setShowCurrentPassword((open) => !open)}
                showLabel={t.showPassword || 'Show'}
                hideLabel={t.hidePassword || 'Hide'}
              />
              <PasswordRow
                id="settings-new-password"
                label={t.newPassword || 'New password'}
                autoComplete="new-password"
                value={newPassword}
                onChange={setNewPassword}
                visible={showNewPassword}
                onToggle={() => setShowNewPassword((open) => !open)}
                showLabel={t.showPassword || 'Show'}
                hideLabel={t.hidePassword || 'Hide'}
              />
              <PasswordRow
                id="settings-confirm-password"
                label={t.confirmNewPassword || 'Confirm new password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                visible={showConfirmPassword}
                onToggle={() => setShowConfirmPassword((open) => !open)}
                showLabel={t.showPassword || 'Show'}
                hideLabel={t.hidePassword || 'Hide'}
              />
              {passwordError && <p className="text-xs text-red-400">{passwordError}</p>}
              {passwordMsg && <p className="text-xs text-green-400">{passwordMsg}</p>}
              <button
                type="submit"
                disabled={isUpdatingPassword}
                className="w-full py-3 rounded-xl bg-white text-black font-semibold text-sm hover:bg-neutral-200 disabled:opacity-60 transition-colors"
              >
                {isUpdatingPassword ? (t.pleaseWait || 'Please wait...') : (t.updatePassword || 'Update password')}
              </button>
            </form>
            <div className="mt-4 pt-4 border-t border-ink-border">
              <p className="text-sm text-band-mute mb-3">{t.resetEmailAccountHint || "We'll email a reset link to your signed-in address."}</p>
              <button
                type="button"
                onClick={() => void handleForgotPassword()}
                disabled={isResetting}
                className="w-full py-3 rounded-xl border border-ink-border bg-ink-muted/70 hover:bg-ink-muted text-white font-medium text-sm disabled:opacity-60 transition-colors"
              >
                {isResetting ? (t.pleaseWait || 'Please wait...') : (t.forgotPassword || 'Forgot password?')}
              </button>
            </div>
          </section>

          {/* Support & privacy */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-band-dim uppercase tracking-wider mb-1">{t.helpAndLegal || 'Help & legal'}</h3>
            <button
              type="button"
              onClick={() => setManualOpen(true)}
              className="w-full text-left px-4 py-3 rounded-xl border border-ink-border bg-ink-muted/70 hover:bg-ink-muted transition-colors"
            >
              <div className="text-sm font-medium text-white">{t.userManual || 'User manual'}</div>
              <div className="text-xs text-band-mute mt-0.5">{t.userManualHint || 'How to use casemate and the document editor'}</div>
            </button>
            <button
              type="button"
              onClick={contactSupport}
              className="w-full text-left px-4 py-3 rounded-xl border border-ink-border bg-ink-muted/70 hover:bg-ink-muted transition-colors"
            >
              <div className="text-sm font-medium text-white">{t.contactSupport || 'Contact support'}</div>
              <div className="text-xs text-band-mute mt-0.5">{SUPPORT_EMAIL}</div>
            </button>
            <button
              type="button"
              onClick={() => openExternal(PRIVACY_URL)}
              className="w-full text-left px-4 py-3 rounded-xl border border-ink-border bg-ink-muted/70 hover:bg-ink-muted transition-colors"
            >
              <div className="text-sm font-medium text-white">{t.privacyPolicy}</div>
              <div className="text-xs text-band-mute mt-0.5">{t.viewPrivacyPolicy || 'View our privacy policy'}</div>
            </button>
            <button
              type="button"
              onClick={() => openExternal(TERMS_URL)}
              className="w-full text-left px-4 py-3 rounded-xl border border-ink-border bg-ink-muted/70 hover:bg-ink-muted transition-colors"
            >
              <div className="text-sm font-medium text-white">{t.termsOfUse || 'Terms of use'}</div>
              <div className="text-xs text-band-mute mt-0.5">{t.viewTerms || 'Draft terms of use (needs legal review)'}</div>
            </button>
            <button
              type="button"
              onClick={() => openExternal(REFUND_URL)}
              className="w-full text-left px-4 py-3 rounded-xl border border-ink-border bg-ink-muted/70 hover:bg-ink-muted transition-colors"
            >
              <div className="text-sm font-medium text-white">{t.refundPolicy || 'Refunds and billing'}</div>
              <div className="text-xs text-band-mute mt-0.5">{t.viewRefund || 'Refund and cancellation information (needs legal review)'}</div>
            </button>
            <button
              type="button"
              onClick={() => openExternal(DELETION_URL)}
              className="w-full text-left px-4 py-3 rounded-xl border border-ink-border bg-ink-muted/70 hover:bg-ink-muted transition-colors"
            >
              <div className="text-sm font-medium text-white">{t.requestDataDeletion || 'Request data / account deletion'}</div>
              <div className="text-xs text-band-mute mt-0.5">{t.requestDataDeletionHint || 'How to delete your data or account'}</div>
            </button>
          </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const shortDeviceId = (id: string) => {
  if (!id || id.length < 10) return id || 'device';
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
};

const DeviceManager = ({
  devices,
  maxDevices,
  unlimited,
  busy,
  message,
  onRevoke,
  t,
}: {
  devices: RegisteredDevice[];
  maxDevices: number;
  unlimited: boolean;
  busy: boolean;
  message: string;
  onRevoke: (id: string) => void;
  t: Record<string, string>;
}) => {
  const currentId = getDeviceId();
  return (
    <div className="mt-4 border rounded-xl p-5 border-ink-border bg-ink-muted/70 space-y-3">
      <p className="text-sm font-medium text-white">{t.registeredDevices || 'Registered devices'}</p>
      <p className="text-xs text-band-mute">
        {t.devicesManageHint || 'Each install gets a random id stored on this device. Casemate does not fingerprint hardware. Unused slots free after 14 days.'}{' '}
        {unlimited ? (t.unlimitedLabel || 'Unlimited') : `${devices.length} / ${maxDevices}`}
      </p>
      {devices.length === 0 ? (
        <p className="text-sm text-band-mute">{t.noOtherDevices || 'No other devices are registered yet. This phone is counted the next time you use AI.'}</p>
      ) : (
        <ul className="space-y-2">
          {devices.map((d) => {
            const current = d.current || d.id === currentId;
            return (
              <li key={d.id} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-white">
                    {shortDeviceId(d.id)}
                    {current ? ` · ${t.thisDevice || 'This device'}` : ''}
                  </p>
                  <p className="text-xs text-band-mute">
                    {t.lastUsed || 'Last used'} {d.lastSeen ? new Date(d.lastSeen).toLocaleString('en-IN') : '—'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRevoke(d.id)}
                  className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border border-ink-border text-white hover:bg-ink-muted disabled:opacity-50"
                >
                  {t.removeDevice || 'Remove'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {message ? <p className="text-xs text-band-mute">{message}</p> : null}
    </div>
  );
};

const formatRemain = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}m ${rest}s`;
};

const UsageLimits = ({
  user,
  draftCount,
  usageSeconds,
  chatCount,
  aiUsage,
  t,
}: {
  user: { plan?: string; email?: string; promoKind?: string | null; promoExpiresAt?: number | null } | null | undefined;
  draftCount: number;
  usageSeconds: number;
  chatCount: number;
  aiUsage: { day?: string; dayRequests?: number } | null;
  t: Record<string, string>;
}) => {
  const unlimited = hasUnlimitedAccess(user?.email, user);
  const limits = getPlanLimits(user?.plan, user?.email, user);
  const paid = Boolean(user?.plan && user.plan !== 'free');
  const drafts = unlimited || !Number.isFinite(limits.draftLimit)
    ? (t.unlimitedLabel || 'Unlimited')
    : `${draftCount} / ${limits.draftLimit}`;
  const chats = unlimited || !Number.isFinite(limits.chatSessionLimit)
    ? (t.unlimitedLabel || 'Unlimited')
    : `${chatCount} / ${limits.chatSessionLimit}`;
  const time = unlimited || paid || !limits.dailySeconds
    ? (t.noDailyTimer || 'No daily timer on this plan')
    : formatRemain(usageSeconds);
  const usedToday = aiUsage?.day === istDateKey() ? Number(aiUsage.dayRequests || 0) : 0;
  const dailyAi = unlimited || paid || !Number.isFinite(limits.dailyAiRequests)
    ? (t.unlimitedLabel || 'Unlimited')
    : `${usedToday} / ${limits.dailyAiRequests}`;

  return (
    <div className="border rounded-xl p-5 border-ink-border bg-ink-muted/70 space-y-3">
      <p className="text-sm text-white"><span className="text-band-mute">{t.draftsUsed || 'Drafts this month'}: </span>{drafts}</p>
      <p className="text-sm text-white"><span className="text-band-mute">{t.dailyAiUsed || 'AI requests today'}: </span>{dailyAi}</p>
      <p className="text-sm text-white"><span className="text-band-mute">{t.dailyTimeLeft || 'Daily time remaining'}: </span>{time}</p>
      <p className="text-sm text-white"><span className="text-band-mute">{t.chatsUsed || 'Saved chats'}: </span>{chats}</p>
      <p className="text-xs text-band-mute">
        {t.usageResetHint || 'Daily allowances reset at midnight IST'}: {nextIstMidnightLabel()}. {t.monthlyResetHint || 'Drafts and monthly AI reset on'} {nextMonthResetLabel()}.
      </p>
      <p className="text-xs text-band-mute">
        {t.photosPerChat || 'Photos per chat'}: {unlimited || paid ? (t.unlimitedLabel || 'Unlimited') : limits.maxPhotosPerChat}
      </p>
      <div className="pt-2 border-t border-ink-border">
        <p className="text-sm font-medium text-white">{t.registeredDevices || 'Registered devices'}</p>
        <p className="text-sm text-band-mute mt-1">
          {t.devicesHint || 'How many devices may use this account at the same time.'}{' '}
          {unlimited ? (t.unlimitedLabel || 'Unlimited') : `Up to ${limits.maxDevices}`}
        </p>
      </div>
    </div>
  );
};

const PasswordRow = ({
  id,
  label,
  autoComplete,
  value,
  onChange,
  visible,
  onToggle,
  showLabel,
  hideLabel,
}: {
  id: string;
  label: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  showLabel: string;
  hideLabel: string;
}) => (
  <div>
    <label htmlFor={id} className="block text-xs font-medium text-band-dim mb-1.5">{label}</label>
    <div className="relative">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        required
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full p-3 pr-16 border border-ink-border rounded-xl bg-ink-muted text-white text-sm outline-none focus:border-white/40"
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-band-mute hover:text-white"
        aria-pressed={visible}
      >
        {visible ? hideLabel : showLabel}
      </button>
    </div>
  </div>
);

const UserManualBody = ({
  language,
  t,
  onBack,
}: {
  language: string;
  t: any;
  onBack: () => void;
}) => {
  const manual = userManual[language] || userManual.English;
  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-band-dim hover:text-white"
      >
        ← {t.userManualBack || 'Back to settings'}
      </button>
      <p className="text-sm text-band-mute leading-relaxed">{manual.intro}</p>
      {manual.sections.map((section) => (
        <section key={section.title}>
          <h3 className="text-sm font-semibold text-white mb-2">{section.title}</h3>
          <div className="space-y-2">
            {section.paragraphs.map((p) => (
              <p key={p.slice(0, 48)} className="text-sm text-band-mute leading-relaxed">{p}</p>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};
