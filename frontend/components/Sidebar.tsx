import React, { useState, useEffect, useMemo, memo } from 'react';
import { useAppContext } from '../context/AppContext';
import { PlusIcon, SettingsIcon, LogoutIcon, SparklesIcon, SearchIcon, TrashIcon, EditIcon, CheckIcon, XIcon } from './Icons';
import { BrandLogo } from './BrandLogo';
import { translations } from '../utils/translations';
import { hasUnlimitedAccess, DEFAULT_PLAN_PRICES } from '../utils/planLimits';
import { FreeUsageStrip } from './UsageMeter';
import { chatStartedAt, formatChatDay } from '../utils/chatLabel';
import { sendPasswordReset } from '../services/firebaseService';

const formatTime = (seconds: number) => {
  const m = Math.floor(Math.max(0, seconds) / 60);
  const s = Math.max(0, seconds) % 60;
  return `${m}m ${s}s`;
};

const UsageTimeBadge = memo(({ label }: { label: string }) => {
  const { subscribeUsageSeconds } = useAppContext();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => subscribeUsageSeconds(setSeconds), [subscribeUsageSeconds]);
  return (
    <span className={`text-xs px-2 py-1 rounded font-medium ${seconds < 300 ? 'bg-red-900/50 text-red-400' : 'bg-neutral-800 text-band-dim'}`}>
      {formatTime(seconds)} {label}
    </span>
  );
});

export const Sidebar = () => {
  const { 
    user, 
    chatSessions, 
    activeSessionId, 
    setActiveSessionId, 
    createNewSession,
    deleteChatSession,
    renameChatSession,
    setIsSettingsOpen,
    setIsSubscriptionModalOpen,
    isSidebarOpen,
    setIsSidebarOpen,
    language,
    userMode,
    logout,
    subscriptionPlans,
  } = useAppContext();

  const t = translations[language] || translations['English'];
  const plans = subscriptionPlans.length > 0 ? subscriptionPlans : [
    { id: 'basic', name: 'Basic Plan', price: DEFAULT_PLAN_PRICES.basic },
    { id: 'pro', name: 'Pro Plan', price: DEFAULT_PLAN_PRICES.pro },
    { id: 'annual', name: 'Annual Plan', price: DEFAULT_PLAN_PRICES.annual }
  ];
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [resetMsg, setResetMsg] = useState('');
  const [resetError, setResetError] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const hideFooterWhileSearching = isSearchFocused || searchQuery.trim().length > 0;

  const filteredSessions = useMemo(() => {
    const mine = chatSessions.filter((session) => (session.userMode === 'judge' ? 'judge' : 'advocate') === userMode);
    const q = searchQuery.toLowerCase();
    if (!q) return mine;
    return mine.filter((session) =>
      session.title.toLowerCase().includes(q) || (session.caseDate || '').toLowerCase().includes(q)
    );
  }, [chatSessions, searchQuery, userMode]);

  const closeSidebar = () => setIsSidebarOpen(false);

  const handleStartRename = (e: React.MouseEvent, session: { id: string, title: string }) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setNewTitle(session.title);
  };

  const handleSaveRename = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (newTitle.trim() && renameChatSession) {
      renameChatSession(sessionId, newTitle.trim());
    }
    setEditingSessionId(null);
  };

  const handleSelectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    closeSidebar();
  };

  const handleNewChat = () => {
    createNewSession();
    closeSidebar();
  };

  const handleDelete = (e: React.MouseEvent, sessionId: string, title: string) => {
    e.stopPropagation();
    const ok = window.confirm(`Delete “${title || 'this chat'}”? This cannot be undone.`);
    if (!ok) return;
    deleteChatSession(sessionId);
  };

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 w-[min(18rem,86vw)] max-w-sm bg-ink-soft text-band-dim flex flex-col h-full border-r border-ink-border shadow-2xl transition-transform duration-300 ease-out ${
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none'
      }`}
      aria-hidden={!isSidebarOpen}
    >
      <div className="w-full flex flex-col h-full min-h-0">
        <div className="app-safe-top p-4 flex items-center gap-3 text-band border-b border-ink-border flex-shrink-0">
          <div className="brand-ring w-9 h-9 flex items-center justify-center flex-shrink-0">
            <BrandLogo size={32} className="rounded-full" />
          </div>
          <span className="font-display text-2xl font-semibold tracking-wide flex-1">casemate</span>
          <button
            type="button"
            onClick={closeSidebar}
            className="p-2 rounded-lg text-band-mute hover:text-white hover:bg-ink-muted transition-colors"
            aria-label="Close sidebar"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 pb-2 flex-shrink-0">
          <button 
            onClick={handleNewChat}
            className="w-full flex items-center gap-2 bg-ink-muted hover:bg-neutral-800 text-white py-2.5 px-4 rounded-lg transition-colors font-medium text-sm border border-ink-border"
          >
            <PlusIcon className="w-4 h-4" />
            {t.newChat}
          </button>
        </div>

        <div className="px-4 pb-2 flex-shrink-0">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-band-mute">
              <SearchIcon className="w-3.5 h-3.5" />
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
              placeholder="Search chats..."
              className="w-full bg-ink-muted/80 border border-ink-border text-white text-xs rounded-lg pl-8 pr-8 py-2 outline-none focus:border-white/40 transition-colors placeholder-band-mute"
            />
            {searchQuery.trim().length > 0 && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-band-mute hover:text-white"
                aria-label="Clear search"
              >
                <XIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        
        <div className="flex-1 min-h-0 overflow-y-auto px-3 space-y-1 custom-scrollbar">
          <div className="text-xs font-semibold text-band-mute mb-2 px-2 uppercase tracking-wider mt-1">{t.recentCases}</div>
          {filteredSessions.length === 0 ? (
            <div className="text-sm text-band-mute px-2 italic">
              {filteredSessions.length === 0 ? t.noRecentCases : "No matching chats found"}
            </div>
          ) : (
            filteredSessions.map(session => (
              <div 
                key={session.id}
                onClick={() => handleSelectSession(session.id)}
                className={`group flex items-center justify-between w-full px-3 py-2.5 rounded-lg text-base font-semibold transition-colors cursor-pointer ${
                  activeSessionId === session.id 
                    ? 'bg-ink-muted text-white' 
                    : 'hover:bg-ink-muted/70 text-band-dim'
                }`}
              >
                {editingSessionId === session.id ? (
                  <div className="flex items-center gap-1 flex-1 pr-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      className="w-full bg-ink-soft border border-white/40 text-white text-xs rounded px-2 py-1 outline-none"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (newTitle.trim() && renameChatSession) renameChatSession(session.id, newTitle.trim());
                          setEditingSessionId(null);
                        } else if (e.key === 'Escape') {
                          setEditingSessionId(null);
                        }
                      }}
                    />
                    <button 
                      onClick={(e) => handleSaveRename(e, session.id)} 
                      className="text-green-400 hover:text-green-300 p-1"
                      title="Save"
                    >
                      <CheckIcon className="w-3.5 h-3.5" />
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setEditingSessionId(null); }} 
                      className="text-band-mute hover:text-band-dim p-1"
                      title="Cancel"
                    >
                      <XIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 pr-2 text-left">
                      <span className="block truncate text-base font-semibold">
                        {session.title}
                        {session.messages.some((m) => m.isDocument) ? (
                          <span className="ml-1 text-[10px] font-medium text-amber-400 uppercase">Draft</span>
                        ) : null}
                      </span>
                      <span className="block truncate text-[11px] font-medium text-band-mute">
                        {session.caseDate || formatChatDay(chatStartedAt(session), language)}
                      </span>
                    </span>
                    <div className="flex items-center gap-0.5 flex-shrink-0 opacity-100">
                      <button 
                        onClick={(e) => handleStartRename(e, session)}
                        className="text-band-mute hover:text-white p-1.5 rounded transition-colors"
                        title="Rename Chat"
                        aria-label="Rename chat"
                      >
                        <EditIcon className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        onClick={(e) => handleDelete(e, session.id, session.title)}
                        className="text-band-mute hover:text-red-400 p-1.5 rounded transition-colors"
                        title="Delete Chat"
                        aria-label="Delete chat"
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        {!hideFooterWhileSearching && (
        <div className="p-4 border-t border-ink-border space-y-3 bg-ink-soft/80 flex-shrink-0 app-safe-bottom">
          <div className="flex items-center justify-between px-2 py-1 text-sm bg-ink-muted/70 rounded-lg border border-ink-border/50">
            <span className="text-band-mute">{t.plan}: <span className={`font-medium capitalize ${hasUnlimitedAccess(user?.email, user) || (user?.plan && user?.plan !== 'free') ? 'text-yellow-400' : 'text-white'}`}>{hasUnlimitedAccess(user?.email, user) ? 'Unlimited' : (user?.plan || 'free')}</span></span>
            {!hasUnlimitedAccess(user?.email, user) && (!user?.plan || user?.plan === 'free') && (
              <UsageTimeBadge label={t.left} />
            )}
          </div>
          <FreeUsageStrip compact />
          
          <button 
            onClick={() => { setIsSettingsOpen(true); closeSidebar(); }} 
            className="w-full flex items-center gap-2 px-2 py-2 hover:bg-ink-muted rounded-lg transition-colors text-sm text-band-dim"
          >
            <SettingsIcon className="w-4 h-4" />
            {t.settings}
          </button>

          <button 
            onClick={() => { setIsSubscriptionModalOpen(true); closeSidebar(); }} 
            className="w-full flex flex-col gap-1 px-3 py-2.5 bg-yellow-500/10 hover:bg-yellow-500/20 rounded-xl transition-colors border border-yellow-500/30 text-yellow-400 mt-1"
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <SparklesIcon className="w-4 h-4" />
              <span>{hasUnlimitedAccess(user?.email, user) || (user?.plan && user.plan !== 'free') ? 'Manage plan' : 'Upgrade Plan'}</span>
            </div>
            <div className="text-[10px] text-band-mute text-left pl-6 truncate">
              {plans.map(p => `${p.name} ₹${p.price}`).join(' • ')}
            </div>
          </button>

          <div className="rounded-xl border border-ink-border/70 bg-ink-muted/40 overflow-hidden">
            <button
              type="button"
              onClick={() => setAccountOpen((v) => !v)}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-ink-muted transition-colors text-left"
              aria-expanded={accountOpen}
            >
              <div className="w-8 h-8 bg-white text-ink rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">
                {user?.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 truncate text-sm">
                <div className="text-white font-medium truncate">{user?.name}</div>
                <div className="text-xs text-band-mute truncate">{user?.email}</div>
              </div>
              <svg className={`w-4 h-4 text-band-mute flex-shrink-0 transition-transform ${accountOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
            {accountOpen && (
              <div className="border-t border-ink-border">
                <button
                  type="button"
                  disabled={isResetting}
                  onClick={async () => {
                    setResetMsg('');
                    setResetError('');
                    const target = (user?.email || '').trim();
                    if (!target) {
                      setResetError(t.resetNeedEmail || 'Enter your email address first.');
                      return;
                    }
                    setIsResetting(true);
                    try {
                      await sendPasswordReset(target);
                      setResetMsg(t.resetEmailSent || 'Password reset email sent. Check your inbox and spam folder.');
                    } catch (err: any) {
                      const code = err?.code || '';
                      if (code === 'auth/too-many-requests') {
                        setResetError(t.resetTooMany || 'Too many attempts. Please wait a few minutes and try again.');
                      } else if (code === 'auth/user-not-found') {
                        setResetMsg(t.resetEmailSent || 'Password reset email sent. Check your inbox and spam folder.');
                      } else {
                        setResetError(err?.message || 'Could not send reset email.');
                      }
                    } finally {
                      setIsResetting(false);
                    }
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-ink-muted transition-colors text-sm text-band-dim hover:text-white disabled:opacity-60"
                >
                  {isResetting ? (t.pleaseWait || 'Please wait...') : (t.forgotPassword || 'Forgot password?')}
                </button>
                {resetError && <p className="px-3 pb-2 text-[11px] text-red-400">{resetError}</p>}
                {resetMsg && <p className="px-3 pb-2 text-[11px] text-green-400">{resetMsg}</p>}
                <button
                  type="button"
                  onClick={() => { setIsSettingsOpen(true); closeSidebar(); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-ink-muted transition-colors text-sm text-band-dim hover:text-white"
                >
                  {t.changePassword || 'Change password'}
                </button>
                <button
                  type="button"
                  onClick={logout}
                  className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-ink-muted transition-colors text-sm text-red-400 hover:text-red-300"
                >
                  <LogoutIcon className="w-4 h-4" />
                  {t.logout}
                </button>
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    </aside>
  );
};
