import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { XIcon } from './Icons';
import { translations } from '../utils/translations';
import { userManual } from '../utils/userManual';
import { auth, sendPasswordReset } from '../services/firebaseService';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth';
const SUPPORT_EMAIL = 'casemateyour@gmail.com';
const PRIVACY_URL = 'https://legalai-78759.web.app/privacy';
const DELETION_URL = 'https://legalai-78759.web.app/privacy#data-deletion';

export const SettingsModal = () => {
  const { isSettingsOpen, setIsSettingsOpen, language, setLanguage, user } = useAppContext();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  if (!isSettingsOpen) return null;

  const t = translations[language] || translations['English'];
  const languages = ['English', 'Hindi'];

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
          {/* Language Section */}
          <section>
            <h3 className="text-sm font-semibold text-band-dim uppercase tracking-wider mb-3">{t.appLang}</h3>
            <p className="text-sm text-band-mute mb-4">{t.selectLang}</p>
            <select 
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full p-3 border border-ink-border rounded-xl bg-ink-muted text-white focus:ring-1 focus:ring-white/35 focus:border-white/40 outline-none"
            >
              {languages.map(lang => (
                <option key={lang} value={lang}>{lang === 'Hindi' ? 'हिंदी' : lang}</option>
              ))}
            </select>
          </section>

          {/* Subscription Section */}
          <section>
            <h3 className="text-sm font-semibold text-band-dim uppercase tracking-wider mb-3">{t.subAndBilling}</h3>
            
            <div className="border rounded-xl p-5 border-ink-border bg-ink-muted/70">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-bold text-lg text-white capitalize">
                    {user?.plan || 'Free'} {t.plan}
                  </div>
                  <div className="text-sm text-band-mute mt-1">
                    {(!user?.plan || user?.plan === 'free') ? t.freeLimit : t.unlimitedAccess}
                  </div>
                </div>
                <span className="bg-white/10 text-band border border-ink-border text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide">
                  {t.active}
                </span>
              </div>
            </div>
          </section>

          {/* Change password */}
          <section>
            <h3 className="text-sm font-semibold text-band-dim uppercase tracking-wider mb-3">{t.changePassword || 'Change password'}</h3>
            <p className="text-sm text-band-mute mb-4">{t.changePasswordHint || 'Update the password for your signed-in account.'}</p>
            <form onSubmit={handleChangePassword} className="space-y-3">
              <input
                type="password"
                required
                autoComplete="current-password"
                placeholder={t.currentPassword || 'Current password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full p-3 border border-ink-border rounded-xl bg-ink-muted text-white text-sm outline-none focus:border-white/40"
              />
              <input
                type="password"
                required
                autoComplete="new-password"
                placeholder={t.newPassword || 'New password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full p-3 border border-ink-border rounded-xl bg-ink-muted text-white text-sm outline-none focus:border-white/40"
              />
              <input
                type="password"
                required
                autoComplete="new-password"
                placeholder={t.confirmNewPassword || 'Confirm new password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full p-3 border border-ink-border rounded-xl bg-ink-muted text-white text-sm outline-none focus:border-white/40"
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
