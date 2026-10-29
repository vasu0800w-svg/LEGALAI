import React, { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useAppContext } from './context/AppContext';
import { bumpSiteStat } from './services/siteStatsService';
import { AuthScreen } from './components/AuthScreen';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { SettingsModal } from './components/SettingsModal';
import { UpgradeModal } from './components/UpgradeModal';
import { AdminDashboard } from './components/AdminDashboard';
import { SubscriptionModal } from './components/SubscriptionModal';
import { MockRazorpay } from './components/MockRazorpay';
import { LandingPage } from './components/LandingPage';
import { useNativeAppNavigation } from './utils/nativeNavigation';
import { THEME_INK_DARK } from './utils/theme';

const packagedForAndroid = import.meta.env.VITE_APP_TARGET === 'android';

class SiteErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[casemate] website render failed', error, info.componentStack);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const AppShell = () => {
  const {
    isSidebarOpen,
    setIsSidebarOpen,
    isSettingsOpen,
    setIsSettingsOpen,
    isSubscriptionModalOpen,
    setIsSubscriptionModalOpen,
    isUpgradeModalOpen,
    setIsUpgradeModalOpen,
    isMockRazorpayOpen,
    setIsMockRazorpayOpen,
  } = useAppContext();

  useNativeAppNavigation({
    isSidebarOpen,
    setIsSidebarOpen,
    isSettingsOpen,
    setIsSettingsOpen,
    isSubscriptionModalOpen,
    setIsSubscriptionModalOpen,
    isUpgradeModalOpen,
    setIsUpgradeModalOpen,
    isMockRazorpayOpen,
    setIsMockRazorpayOpen,
  });

  return (
    <div className="relative z-[1] flex h-full w-full max-h-full app-bottom-glow overflow-hidden font-sans selection:bg-white/20 selection:text-white">
      {/* Dimmed backdrop — tap chat area to close sidebar (ChatGPT-style) */}
      {isSidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] animate-fade-in"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <Sidebar />

      <main className="flex-1 flex flex-col min-w-0 min-h-0 relative overflow-hidden z-0">
        <ChatArea />
      </main>

      <SettingsModal />
      <UpgradeModal />
      <SubscriptionModal />
      <MockRazorpay />
    </div>
  );
};

const App = () => {
  const { user } = useAppContext();
  const [authMode, setAuthMode] = useState<'login' | 'signup' | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    void StatusBar.setBackgroundColor({ color: THEME_INK_DARK }).catch(() => {});
  }, []);

  useEffect(() => {
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const key = 'casemate_visit_day';
    try {
      if (localStorage.getItem(key) === day) return;
    } catch {
      return;
    }
    void bumpSiteStat('visits').then((ok) => {
      if (!ok) return;
      try { localStorage.setItem(key, day); } catch { /* ignore */ }
    });
  }, []);

  if (!user) {
    if (packagedForAndroid || Capacitor.isNativePlatform()) {
      return <AuthScreen />;
    }
    if (!authMode) {
      return (
        <SiteErrorBoundary fallback={<AuthScreen />}>
          <LandingPage onSignIn={() => setAuthMode('login')} onStart={() => setAuthMode('signup')} />
        </SiteErrorBoundary>
      );
    }
    return <AuthScreen startInSignup={authMode === 'signup'} onBack={() => setAuthMode(null)} />;
  }

  if (user.role === 'admin') {
    return <AdminDashboard />;
  }

  return <AppShell />;
};

export default App;
