import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { XIcon } from './Icons';
import { BrandLogo } from './BrandLogo';
import { translations } from '../utils/translations';
import { auth, db, sendPasswordReset } from '../services/firebaseService';
import { sendWelcomeEmail } from '../services/emailService';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  sendEmailVerification,
  updateProfile,
  signOut,
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { ensureConfigWriteAuth } from '../services/adminConfigService';

export const AuthScreen = () => {
  const { setUser, language, setLanguage } = useAppContext();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const t = translations[language] || translations['English'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setIsLoading(true);
     
    // Dynamic Admin Bypass
    const adminCreds = JSON.parse(localStorage.getItem('casemate_admin_creds') || '{"email":"admin@casemate.com","password":"admin123"}');
     
    if (isLogin && email === adminCreds.email && password === adminCreds.password) {
      // Sign into Firebase with admin email/password so cloud writes work (no Anonymous needed)
      try {
        localStorage.setItem('casemate_admin_creds', JSON.stringify({ email: adminCreds.email, password: adminCreds.password }));
        const ok = await ensureConfigWriteAuth();
        if (!ok) {
          console.warn('Admin Firebase auth failed — enable Email/Password in Firebase Auth');
        }
      } catch (e) {
        console.warn('Admin Firebase auth failed', e);
      }
      setUser({
        id: 'admin-001',
        name: 'System Admin',
        email: adminCreds.email,
        plan: 'pro',
        role: 'admin'
      });
      setIsLoading(false);
      return;
    }

    try {
      if (isLogin) {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const firebaseUser = userCredential.user;

        // Email Verification Check
        if (!firebaseUser.emailVerified) {
          await signOut(auth);
          setError('Aapne apna email verify nahi kiya hai! Please apna inbox/spam check karein aur link par click karke verify karein.');
          setIsLoading(false);
          return;
        }

        // Enter app immediately — cloud history loads in AppContext (do not block on Firestore)
        setUser({
          id: firebaseUser.uid,
          name: firebaseUser.displayName || 'Advocate',
          email: firebaseUser.email || email,
          plan: 'free',
          role: 'user'
        });
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const firebaseUser = userCredential.user;

        if (name.trim()) {
          await updateProfile(firebaseUser, { displayName: name.trim() });
        }

        // Seed profile in background — never block signup on Firestore
        setDoc(doc(db, 'users_data', firebaseUser.uid), {
          name: name.trim() || 'Advocate',
          email: firebaseUser.email || email,
          plan: 'free',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }, { merge: true }).catch((cloudErr) => {
          console.error("Error creating cloud profile", cloudErr);
        });

        await sendEmailVerification(firebaseUser);
        
        try {
          await sendWelcomeEmail(email, name || 'Advocate');
        } catch (emailErr) {
          console.error("Welcome email failed", emailErr);
        }

        await signOut(auth);

        alert(`Verification email sent to ${email}!\nPlease check your inbox and verify your email before logging in.`);
         
        setIsLogin(true);
        setError('Verification email sent. Please verify and log in.');
      }
    } catch (err: any) {
      console.error("Auth error:", err);
      setError(err.message || t.invalidCreds || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setError('');
    setInfo('');
    const trimmed = email.trim();
    if (!trimmed) {
      setError(t.resetNeedEmail || 'Enter your email address first.');
      return;
    }
    setIsResetting(true);
    try {
      await sendPasswordReset(trimmed);
      setInfo(t.resetEmailSent || 'Password reset email sent. Check your inbox and spam folder.');
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/invalid-email' || code === 'auth/missing-email') {
        setError(t.resetNeedEmail || 'Enter a valid email address.');
      } else if (code === 'auth/too-many-requests') {
        setError(t.resetTooMany || 'Too many attempts. Please wait a few minutes and try again.');
      } else if (code === 'auth/user-not-found') {
        setInfo(t.resetEmailSent || 'Password reset email sent. Check your inbox and spam folder.');
      } else {
        setError(err?.message || 'Could not send reset email.');
      }
    } finally {
      setIsResetting(false);
    }
  };

  const fieldClass =
    'appearance-none rounded-lg relative block w-full px-3 py-3 border border-ink-border bg-ink-muted placeholder-band-mute text-band focus:outline-none focus:ring-1 focus:ring-white/40 focus:border-white/40 focus:z-10 sm:text-sm transition-colors';

  return (
    <div className="min-h-screen min-h-[100dvh] flex items-center justify-center legal-atmosphere py-12 px-4 sm:px-6 lg:px-8 relative app-safe-top app-safe-bottom overflow-y-auto">
      <div className="absolute top-4 right-4 animate-fade-in">
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="bg-ink-muted border border-ink-border text-band text-sm rounded-lg focus:ring-1 focus:ring-white/40 focus:border-white/40 block p-2 outline-none"
        >
          <option value="English">English</option>
          <option value="Hindi">हिंदी</option>
        </select>
      </div>

      <div className="max-w-md w-full space-y-8 bg-ink-soft/90 p-10 rounded-2xl border border-ink-border backdrop-blur-sm animate-fade-up">
        <div className="text-center">
          <div className="mx-auto mb-5 w-20 h-20 brand-ring flex items-center justify-center animate-mark-reveal">
            <BrandLogo size={72} className="rounded-full" />
          </div>
          <h2 className="mt-2 text-4xl font-display font-semibold tracking-wide text-band">
            {t.appTitle}
          </h2>
          <p className="mt-2 text-sm text-band-mute tracking-wide">
            {t.appSubtitle}
          </p>
        </div>
         
        {error && (
          <div className="bg-red-950/50 border border-red-500/40 text-red-200 px-4 py-3 rounded-lg text-sm text-center animate-fade-in">
            {error}
          </div>
        )}
        {info && (
          <div className="bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 px-4 py-3 rounded-lg text-sm text-center animate-fade-in">
            {info}
          </div>
        )}

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="rounded-md space-y-4">
            {!isLogin && (
              <div>
                <label className="sr-only">{t.fullName}</label>
                <input
                  type="text"
                  required
                  className={fieldClass}
                  placeholder={t.fullName}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            )}
            <div>
              <label className="sr-only">{t.email}</label>
              <input
                type="email"
                required
                className={fieldClass}
                placeholder={t.email}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="sr-only">{t.password}</label>
              <input
                type="password"
                required
                className={fieldClass}
                placeholder={t.password}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {isLogin && (
              <div className="text-right -mt-1">
                <button
                  type="button"
                  onClick={() => void handleForgotPassword()}
                  disabled={isResetting || isLoading}
                  className="text-sm text-band-mute hover:text-band font-medium transition-colors disabled:opacity-60"
                >
                  {isResetting ? (t.pleaseWait || 'Please wait...') : (t.forgotPassword || 'Forgot password?')}
                </button>
              </div>
            )}
          </div>

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="btn-band group relative w-full flex justify-center py-3 px-4 text-sm rounded-lg"
            >
              {isLoading ? 'Please wait...' : (isLogin ? t.signIn : t.createAccount)}
            </button>
          </div>
        </form>
         
        <div className="text-center mt-4">
          <button
            onClick={() => { setIsLogin(!isLogin); setError(''); setInfo(''); }}
            className="text-sm text-band-mute hover:text-band font-medium transition-colors"
          >
            {isLogin ? t.noAccount : t.hasAccount}
          </button>
        </div>
         
        <div className="text-center mt-6 pt-4 border-t border-ink-border">
          <button 
            onClick={() => setShowPrivacy(true)} 
            className="text-xs text-band-mute hover:text-band-dim transition-colors underline underline-offset-2"
          >
            {t.privacyPolicy}
          </button>
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
              {t.cancel || "Close"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
