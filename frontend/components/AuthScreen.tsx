import React, { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { XIcon } from './Icons';
import { BrandLogo } from './BrandLogo';
import { UserModeSwitch } from './UserModeSwitch';
import { translations } from '../utils/translations';
import { APP_LANGUAGES } from '../utils/languages';
import { auth, db } from '../services/firebaseService';
import {
  confirmResetOtp,
  sendEmailOtp,
  sendResetOtp,
  toE164Phone,
  verifyEmailOtp,
} from '../services/authOtpService';
import {
  ConfirmationResult,
  RecaptchaVerifier,
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  updateProfile,
  signOut,
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { bumpSiteStat } from '../services/siteStatsService';
import { sendWelcomeEmailOnce } from '../services/emailService';
import { isAdminEmail } from '../utils/adminIdentity';

type Step = 'form' | 'email-otp' | 'phone-otp' | 'reset';
type Channel = 'email' | 'phone';

type AuthScreenProps = {
  startInSignup?: boolean;
  onBack?: () => void;
};

export const AuthScreen = ({ startInSignup = false, onBack }: AuthScreenProps = {}) => {
  const { setUser, language, setLanguage } = useAppContext();
  const [isLogin, setIsLogin] = useState(!startInSignup);
  const [channel, setChannel] = useState<Channel>('email');
  const [step, setStep] = useState<Step>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);

  const t = translations[language] || translations['English'];

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  useEffect(() => () => {
    recaptchaRef.current?.clear();
    recaptchaRef.current = null;
  }, []);

  const fieldClass =
    'appearance-none rounded-lg relative block w-full px-3 py-3 border border-ink-border bg-ink-muted placeholder-band-mute text-band focus:outline-none focus:ring-1 focus:ring-white/40 focus:border-white/40 focus:z-10 sm:text-sm transition-colors';

  const enterApp = (firebaseUser: { uid: string; displayName: string | null; email: string | null; phoneNumber: string | null }, displayName?: string) => {
    const shownName = displayName || firebaseUser.displayName || 'Advocate';
    const address = firebaseUser.email || (email.includes('@') ? email.trim() : '');
    const admin = isAdminEmail(address || firebaseUser.email);
    setUser({
      id: firebaseUser.uid,
      name: admin ? (shownName === 'Advocate' ? 'System Admin' : shownName) : shownName,
      email: address || firebaseUser.phoneNumber || email,
      plan: admin ? 'pro' : 'free',
      role: admin ? 'admin' : 'user',
    });
    if (!admin && address.includes('@')) void sendWelcomeEmailOnce(firebaseUser.uid, address, shownName);
  };

  const resetNotice = () => {
    setError('');
    setInfo('');
  };

  const startCooldown = () => setResendIn(60);

  const getVerifier = (size: 'invisible' | 'normal') => {
    if (!recaptchaRef.current) {
      recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', { size });
    }
    return recaptchaRef.current;
  };

  const clearVerifier = () => {
    try {
      recaptchaRef.current?.clear();
    } catch {
      /* a failed widget can already be gone */
    }
    recaptchaRef.current = null;
  };

  const sendPhoneCode = async (attempt: 'invisible' | 'normal' = 'invisible') => {
    resetNotice();
    let e164 = '';
    try {
      e164 = toE164Phone(phone);
    } catch {
      setError(t.phoneInvalid || 'Enter a 10-digit mobile number.');
      return;
    }
    setIsLoading(true);
    try {
      if (attempt === 'normal') clearVerifier();
      const confirmation = await signInWithPhoneNumber(auth, e164, getVerifier(attempt));
      confirmationRef.current = confirmation;
      setStep('phone-otp');
      setCode('');
      setInfo(t.otpPhoneSent || 'We sent a 6-digit SMS code. Enter it below.');
      startCooldown();
    } catch (err: any) {
      clearVerifier();
      const firebaseCode = err?.code || '';
      const checkFailed = firebaseCode === 'auth/captcha-check-failed' || firebaseCode === 'auth/invalid-app-credential';
      if (attempt === 'invisible' && checkFailed) {
        setInfo(language === 'Hindi'
          ? 'नीचे दिया चेक पूरा करें। उसके बाद कोड भेजा जाएगा।'
          : 'Complete the check below. The SMS code is sent after that.');
        setIsLoading(false);
        await sendPhoneCode('normal');
        return;
      }
      if (firebaseCode === 'auth/invalid-phone-number') {
        setError(t.phoneInvalid || 'Enter a 10-digit mobile number.');
      } else if (firebaseCode === 'auth/too-many-requests' || firebaseCode === 'auth/quota-exceeded') {
        setError(t.resetTooMany || 'Too many attempts. Please wait a few minutes and try again.');
      } else if (firebaseCode === 'auth/operation-not-allowed') {
        setError('Phone sign-in is not available yet. Use email for now.');
      } else if (checkFailed) {
        setError(language === 'Hindi'
          ? 'सुरक्षा चेक पूरा नहीं हुआ, इसलिए SMS नहीं गया।'
          : 'The safety check did not finish, so no SMS was sent.');
      } else {
        setError(err?.message || 'Could not send the SMS code.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetNotice();

    if (step === 'email-otp') {
      await verifyEmailCode();
      return;
    }
    if (step === 'phone-otp') {
      await verifyPhoneCode();
      return;
    }
    if (step === 'reset') {
      await finishPasswordReset();
      return;
    }
    if (channel === 'phone') {
      await sendPhoneCode();
      return;
    }

    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError(t.invalidEmail || 'Enter a valid email address.');
      return;
    }
    if (!isLogin && !name.trim()) {
      setError(t.fullName || 'Enter your name.');
      return;
    }
    if (!isLogin && password.length < 6) {
      setError(t.passwordTooShort || 'Password must be at least 6 characters.');
      return;
    }

    setIsLoading(true);
    if (!isLogin && isAdminEmail(email)) {
      setError('This account cannot be created here.');
      setIsLoading(false);
      return;
    }

    try {
      if (isLogin && isAdminEmail(email)) {
        const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
        const firebaseUser = userCredential.user;
        if (!isAdminEmail(firebaseUser.email)) {
          await signOut(auth);
          setError(t.invalidCreds || 'Could not sign in.');
          setIsLoading(false);
          return;
        }
        enterApp(firebaseUser, 'System Admin');
        setIsLoading(false);
        return;
      }
      if (isLogin) {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const firebaseUser = userCredential.user;
        if (!firebaseUser.emailVerified) {
          await sendEmailOtp(await firebaseUser.getIdToken());
          setStep('email-otp');
          setCode('');
          setInfo(t.otpEmailSent);
          startCooldown();
          setIsLoading(false);
          return;
        }
        enterApp(firebaseUser);
        void bumpSiteStat('logins');
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const firebaseUser = userCredential.user;
        if (name.trim()) {
          await updateProfile(firebaseUser, { displayName: name.trim() });
        }
        setDoc(doc(db, 'users_data', firebaseUser.uid), {
          name: name.trim() || 'Advocate',
          email: firebaseUser.email || email,
          plan: 'free',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }, { merge: true }).catch((cloudErr) => {
          console.error('Error creating cloud profile', cloudErr);
        });
        void bumpSiteStat('signups');
        await sendEmailOtp(await firebaseUser.getIdToken());
        setStep('email-otp');
        setCode('');
        setInfo(t.otpEmailSent);
        startCooldown();
      }
    } catch (err: any) {
      console.error('Auth error:', err);
      const firebaseCode = err?.code || '';
      if (firebaseCode === 'auth/email-already-in-use') setError(t.emailInUse || 'Email is already in use.');
      else if (firebaseCode === 'auth/invalid-email') setError(t.invalidEmail || 'Enter a valid email address.');
      else if (firebaseCode === 'auth/weak-password') setError(t.passwordTooShort || 'Password must be at least 6 characters.');
      else if (firebaseCode === 'auth/too-many-requests') setError(t.tooManyRequests || t.resetTooMany || 'Too many attempts. Please wait a few minutes and try again.');
      else if (firebaseCode === 'auth/network-request-failed') setError(t.networkError || 'Could not reach the sign-in service. Check your connection and try again.');
      else if (firebaseCode === 'auth/user-disabled') setError(t.userDisabled || 'This account is disabled. Contact support.');
      else if (firebaseCode === 'auth/invalid-credential' || firebaseCode === 'auth/wrong-password' || firebaseCode === 'auth/user-not-found') {
        setError(t.invalidCreds || 'Invalid email or password.');
      } else setError(t.invalidCreds || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  const verifyEmailCode = async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) {
      setError(t.otpWrong || 'That code is wrong or expired.');
      setStep('form');
      return;
    }
    setIsLoading(true);
    try {
      const result = await verifyEmailOtp(await firebaseUser.getIdToken(), code);
      if (!result.alreadyVerified) {
        await firebaseUser.reload();
      }
      enterApp(firebaseUser, name.trim() || firebaseUser.displayName || 'Advocate');
      if (isLogin) void bumpSiteStat('logins');
    } catch (err: any) {
      setError(err?.message || t.otpWrong);
    } finally {
      setIsLoading(false);
    }
  };

  const verifyPhoneCode = async () => {
    if (!confirmationRef.current) {
      setError(t.otpWrong || 'That code is wrong or expired.');
      setStep('form');
      return;
    }
    setIsLoading(true);
    try {
      const result = await confirmationRef.current.confirm(code.trim());
      const firebaseUser = result.user;
      const isNew = Boolean(getAdditionalUserInfo(result)?.isNewUser);
      const shownName = name.trim() || firebaseUser.displayName || 'Advocate';
      if (name.trim()) {
        await updateProfile(firebaseUser, { displayName: name.trim() }).catch(() => {});
      }
      const profile: Record<string, unknown> = {
        phone: firebaseUser.phoneNumber || toE164Phone(phone),
        updatedAt: Date.now(),
      };
      if (isNew) {
        profile.name = shownName;
        profile.email = firebaseUser.email || '';
        profile.plan = 'free';
        profile.createdAt = Date.now();
      }
      setDoc(doc(db, 'users_data', firebaseUser.uid), profile, { merge: true }).catch((cloudErr) => {
        console.error('Error creating cloud profile', cloudErr);
      });
      enterApp(firebaseUser, shownName);
      void bumpSiteStat(isNew ? 'signups' : 'logins');
    } catch (err: any) {
      setError(err?.message || t.otpWrong);
    } finally {
      setIsLoading(false);
    }
  };

  const finishPasswordReset = async () => {
    if (newPassword.length < 6) {
      setError('Use at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t.passwordMismatch || 'Passwords do not match.');
      return;
    }
    setIsLoading(true);
    try {
      await confirmResetOtp(email.trim(), code, newPassword);
      setPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setCode('');
      setStep('form');
      setIsLogin(true);
      setInfo(t.passwordUpdated);
    } catch (err: any) {
      setError(err?.message || t.otpWrong);
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    resetNotice();
    const trimmed = email.trim();
    if (!trimmed) {
      setError(t.resetNeedEmail || 'Enter your email address first.');
      return;
    }
    setIsLoading(true);
    try {
      await sendResetOtp(trimmed);
      setStep('reset');
      setCode('');
      setInfo(t.otpEmailSent);
      startCooldown();
    } catch (err: any) {
      setError(err?.message || 'Could not send the code.');
    } finally {
      setIsLoading(false);
    }
  };

  const resendEmailCode = async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser || resendIn > 0) return;
    resetNotice();
    setIsLoading(true);
    try {
      await sendEmailOtp(await firebaseUser.getIdToken(true));
      setInfo(t.otpEmailSent);
      startCooldown();
    } catch (err: any) {
      setError(err?.message || t.waitForCode);
    } finally {
      setIsLoading(false);
    }
  };

  const backToForm = async () => {
    resetNotice();
    setCode('');
    setStep('form');
    confirmationRef.current = null;
    if (auth.currentUser && !auth.currentUser.emailVerified && channel === 'email') {
      await signOut(auth).catch(() => {});
    }
  };

  const switchChannel = (next: Channel) => {
    setChannel(next);
    setStep('form');
    resetNotice();
    setCode('');
  };

  const submitLabel = () => {
    if (isLoading) return t.pleaseWait || 'Please wait...';
    if (step === 'email-otp' || step === 'phone-otp') return t.verifyCode || 'Verify';
    if (step === 'reset') return language === 'Hindi' ? 'पासवर्ड बदलें' : 'Reset password';
    if (channel === 'phone') return t.sendCode || 'Send code';
    return isLogin ? t.signIn : t.createAccount;
  };

  return (
    <div className="min-h-screen min-h-[100dvh] w-full flex justify-center sm:items-center legal-atmosphere px-4 sm:px-6 lg:px-8 relative overflow-y-auto overflow-x-hidden">
      <div id="recaptcha-container" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2" />
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="absolute z-10 text-sm text-band-mute hover:text-band"
          style={{ top: 'max(0.75rem, env(safe-area-inset-top, 0px))', left: 'max(0.75rem, env(safe-area-inset-left, 0px))' }}
        >
          Back
        </button>
      )}
      <div
        className="absolute z-10 animate-fade-in flex flex-col items-end gap-2"
        style={{ top: 'max(0.75rem, env(safe-area-inset-top, 0px))', right: 'max(0.75rem, env(safe-area-inset-right, 0px))' }}
      >
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="bg-ink-muted border border-ink-border text-band text-sm rounded-lg focus:ring-1 focus:ring-white/40 focus:border-white/40 block p-2 outline-none"
        >
          {APP_LANGUAGES.map((lang) => (
            <option key={lang.id} value={lang.id}>{lang.native}</option>
          ))}
        </select>
      </div>

      <div className="max-w-md w-full mt-[4.25rem] mb-5 sm:my-12 space-y-5 sm:space-y-8 bg-ink-soft/90 p-5 sm:p-10 rounded-2xl border border-ink-border backdrop-blur-sm animate-fade-up">
        <div className="text-center">
          <div className="mx-auto mb-4 sm:mb-5 w-16 h-16 sm:w-20 sm:h-20 brand-ring flex items-center justify-center animate-mark-reveal">
            <BrandLogo size={64} className="rounded-full sm:hidden" />
            <BrandLogo size={72} className="rounded-full hidden sm:block" />
          </div>
          <h2 className="mt-1 sm:mt-2 text-3xl sm:text-4xl font-display font-semibold tracking-wide text-band">
            {t.appTitle}
          </h2>
          <p className="mt-2 text-sm text-band-mute tracking-wide">
            {t.appSubtitle}
          </p>
        </div>

        {error && (
          <div role="alert" aria-live="assertive" className="bg-red-950/50 border border-red-500/40 text-red-200 px-4 py-3 rounded-lg text-sm text-center animate-fade-in">
            {error}
          </div>
        )}
        {info && (
          <div role="status" aria-live="polite" className="bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 px-4 py-3 rounded-lg text-sm text-center animate-fade-in">
            {info}
          </div>
        )}

        {step === 'form' && (
          <div>
            <p className="mb-2 text-xs uppercase tracking-wider text-band-mute text-center">
              {t.userModeTitle || 'I am a'}
            </p>
            <UserModeSwitch />
          </div>
        )}

        {step === 'form' && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => switchChannel('email')}
              className={`py-2 rounded-lg text-sm font-medium transition-colors ${channel === 'email' ? 'bg-white text-black' : 'border border-ink-border text-band-mute'}`}
            >
              {t.useEmail || 'Email'}
            </button>
            <button
              type="button"
              onClick={() => switchChannel('phone')}
              className={`py-2 rounded-lg text-sm font-medium transition-colors ${channel === 'phone' ? 'bg-white text-black' : 'border border-ink-border text-band-mute'}`}
            >
              {t.usePhone || 'Phone'}
            </button>
          </div>
        )}

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="rounded-md space-y-4">
            {step === 'form' && channel === 'email' && (
              <>
                {!isLogin && (
                  <div>
                    <label htmlFor="auth-name" className="block text-xs font-medium text-band-dim mb-1.5">{t.fullName}</label>
                    <input id="auth-name" type="text" required autoComplete="name" className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                )}
                <div>
                  <label htmlFor="auth-email" className="block text-xs font-medium text-band-dim mb-1.5">{t.email}</label>
                  <input id="auth-email" type="email" required autoComplete="email" className={fieldClass} value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="auth-password" className="block text-xs font-medium text-band-dim mb-1.5">{t.password}</label>
                  <div className="relative">
                    <input
                      id="auth-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete={isLogin ? 'current-password' : 'new-password'}
                      className={`${fieldClass} pr-16`}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((open) => !open)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-band-mute hover:text-band"
                      aria-pressed={showPassword}
                    >
                      {showPassword ? (t.hidePassword || 'Hide') : (t.showPassword || 'Show')}
                    </button>
                  </div>
                </div>
                {isLogin && (
                  <div className="text-right -mt-1">
                    <button
                      type="button"
                      onClick={() => void handleForgotPassword()}
                      disabled={isLoading}
                      className="text-sm text-band-mute hover:text-band font-medium transition-colors disabled:opacity-60"
                    >
                      {t.forgotPassword || 'Forgot password?'}
                    </button>
                  </div>
                )}
              </>
            )}

            {step === 'form' && channel === 'phone' && (
              <>
                {!isLogin && (
                  <div>
                    <label htmlFor="auth-phone-name" className="block text-xs font-medium text-band-dim mb-1.5">{t.fullName}</label>
                    <input id="auth-phone-name" type="text" required autoComplete="name" className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                )}
                <div>
                  <label htmlFor="auth-phone" className="block text-xs font-medium text-band-dim mb-1.5">{t.phoneNumber || '10-digit mobile number'}</label>
                  <input
                    id="auth-phone"
                    type="tel"
                    required
                    inputMode="tel"
                    autoComplete="tel"
                    className={fieldClass}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </>
            )}

            {(step === 'email-otp' || step === 'phone-otp' || step === 'reset') && (
              <div>
                <label htmlFor="auth-otp" className="block text-xs font-medium text-band-dim mb-1.5">{t.enterOtp || '6-digit code'}</label>
                <input
                  id="auth-otp"
                  type="text"
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className={fieldClass}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              </div>
            )}

            {step === 'reset' && (
              <>
                <div>
                  <label htmlFor="auth-new-password" className="block text-xs font-medium text-band-dim mb-1.5">{t.newPassword || 'New password'}</label>
                  <div className="relative">
                    <input id="auth-new-password" type={showNewPassword ? 'text' : 'password'} required autoComplete="new-password" className={`${fieldClass} pr-16`} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                    <button type="button" onClick={() => setShowNewPassword((open) => !open)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-band-mute hover:text-band" aria-pressed={showNewPassword}>
                      {showNewPassword ? (t.hidePassword || 'Hide') : (t.showPassword || 'Show')}
                    </button>
                  </div>
                </div>
                <div>
                  <label htmlFor="auth-confirm-password" className="block text-xs font-medium text-band-dim mb-1.5">{t.confirmPassword || 'Confirm new password'}</label>
                  <div className="relative">
                    <input id="auth-confirm-password" type={showConfirmPassword ? 'text' : 'password'} required autoComplete="new-password" className={`${fieldClass} pr-16`} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                    <button type="button" onClick={() => setShowConfirmPassword((open) => !open)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-band-mute hover:text-band" aria-pressed={showConfirmPassword}>
                      {showConfirmPassword ? (t.hidePassword || 'Hide') : (t.showPassword || 'Show')}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <button type="submit" disabled={isLoading} className="btn-band group relative w-full flex justify-center py-3 px-4 text-sm rounded-lg">
            {submitLabel()}
          </button>
        </form>

        {step === 'email-otp' && (
          <div className="flex items-center justify-between text-sm">
            <button type="button" onClick={() => void resendEmailCode()} disabled={isLoading || resendIn > 0} className="text-band-mute hover:text-band disabled:opacity-60">
              {resendIn > 0 ? `${t.resendCode} (${resendIn})` : (t.resendCode || 'Resend code')}
            </button>
            <button type="button" onClick={() => void backToForm()} className="text-band-mute hover:text-band">
              {t.backToSignIn || 'Back to sign in'}
            </button>
          </div>
        )}

        {step === 'phone-otp' && (
          <div className="flex items-center justify-between text-sm">
            <button type="button" onClick={() => void sendPhoneCode()} disabled={isLoading || resendIn > 0} className="text-band-mute hover:text-band disabled:opacity-60">
              {resendIn > 0 ? `${t.resendCode} (${resendIn})` : (t.resendCode || 'Resend code')}
            </button>
            <button type="button" onClick={() => void backToForm()} className="text-band-mute hover:text-band">
              {t.backToSignIn || 'Back to sign in'}
            </button>
          </div>
        )}

        {step === 'reset' && (
          <div className="text-center">
            <button type="button" onClick={() => void backToForm()} className="text-sm text-band-mute hover:text-band">
              {t.backToSignIn || 'Back to sign in'}
            </button>
          </div>
        )}

        {step === 'form' && (
          <div className="text-center mt-4">
            <button
              onClick={() => { setIsLogin(!isLogin); resetNotice(); }}
              className="text-sm text-band-mute hover:text-band font-medium transition-colors"
            >
              {isLogin ? t.noAccount : t.hasAccount}
            </button>
          </div>
        )}

        <div className="text-center mt-6 pt-4 border-t border-ink-border space-y-2">
          <button
            type="button"
            onClick={() => setShowPrivacy(true)}
            className="text-xs text-band-mute hover:text-band-dim transition-colors underline underline-offset-2"
          >
            {t.privacyPolicy}
          </button>
          <div className="text-xs text-band-mute">
            <a href="https://meetcasemate.com/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-band">{t.privacyPolicy}</a>
            {' · '}
            <a href="https://meetcasemate.com/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-band">{t.termsOfUse || 'Terms of use'}</a>
          </div>
        </div>
      </div>

      {showPrivacy && (
        <div className="fixed inset-0 bg-ink/85 flex items-center justify-center z-[100] backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-ink-soft p-8 rounded-2xl max-w-md w-full relative border border-ink-border animate-fade-up">
            <button
              onClick={() => setShowPrivacy(false)}
              className="absolute top-4 right-4 text-band-mute hover:text-band transition-colors"
            >
              <XIcon className="w-6 h-6" />
            </button>
            <h2 className="text-2xl font-display font-semibold text-band mb-4">{t.privacyPolicyTitle}</h2>
            <p className="text-band-dim text-sm leading-relaxed">
              {t.privacyPolicyContent}
            </p>
            <button
              onClick={() => setShowPrivacy(false)}
              className="btn-band-outline mt-6 w-full py-3 rounded-xl font-medium"
            >
              {t.cancel || 'Close'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
