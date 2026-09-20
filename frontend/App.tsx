import React from 'react';
import { useAppContext } from './context/AppContext';
import { AuthScreen } from './components/AuthScreen';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { SettingsModal } from './components/SettingsModal';
import { UpgradeModal } from './components/UpgradeModal';
import { AdminDashboard } from './components/AdminDashboard';
import { SubscriptionModal } from './components/SubscriptionModal';
import { MockRazorpay } from './components/MockRazorpay';
import { useNativeAppNavigation } from './utils/nativeNavigation';

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

  if (!user) {
    return <AuthScreen />;
  }

  if (user.role === 'admin') {
    return <AdminDashboard />;
  }

  return <AppShell />;
};

export default App;
