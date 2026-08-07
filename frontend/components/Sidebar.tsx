import React, { useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { PlusIcon, SettingsIcon, ScaleIcon, LogoutIcon, SparklesIcon, SearchIcon, TrashIcon, EditIcon, CheckIcon, XIcon } from './Icons';
import { translations } from '../utils/translations';

interface PlanConfig {
  id: string;
  name: string;
  price: number;
}

export const Sidebar = () => {
  const { 
    user, 
    chatSessions, 
    activeSessionId, 
    setActiveSessionId, 
    createNewSession,
    deleteChatSession,
    renameChatSession,
    usageSeconds,
    setIsSettingsOpen,
    setIsSubscriptionModalOpen,
    isSidebarOpen,
    language,
    logout
  } = useAppContext();

  const t = translations[language] || translations['English'];
  const [plans, setPlans] = useState<PlanConfig[]>([
    { id: 'basic', name: 'Basic Plan', price: 699 },
    { id: 'pro', name: 'Pro Plan', price: 1299 },
    { id: 'annual', name: 'Annual Plan', price: 4999 }
  ]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');

  // Load dynamic plans set from Admin Panel
  useEffect(() => {
    const savedPlans = localStorage.getItem('casemate_subscription_plans');
    if (savedPlans) {
      try {
        setPlans(JSON.parse(savedPlans));
      } catch (e) {
        console.error("Error loading plans in sidebar", e);
      }
    }
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  // Filter sessions based on search query
  const filteredSessions = chatSessions.filter(session => 
    session.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

  return (
    <div className={`${isSidebarOpen ? 'w-64' : 'w-0'} bg-slate-900 text-slate-300 flex flex-col h-full border-r border-slate-800 flex-shrink-0 transition-all duration-300 overflow-hidden`}>
      <div className="w-64 flex flex-col h-full">
        <div className="p-4 flex items-center gap-3 text-white font-bold text-lg border-b border-slate-800">
          <ScaleIcon className="w-6 h-6 text-blue-400" />
          casemate
        </div>

        <div className="p-4 pb-2">
          <button 
            onClick={createNewSession} 
            className="w-full flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white py-2.5 px-4 rounded-lg transition-colors font-medium text-sm border border-slate-700"
          >
            <PlusIcon className="w-4 h-4" />
            {t.newChat}
          </button>
        </div>

        {/* Search Bar for Chat History */}
        <div className="px-4 pb-2">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <SearchIcon className="w-3.5 h-3.5" />
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chats..."
              className="w-full bg-slate-800/60 border border-slate-700/80 text-white text-xs rounded-lg pl-8 pr-3 py-2 outline-none focus:border-blue-500 transition-colors placeholder-slate-500"
            />
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto px-3 space-y-1 custom-scrollbar">
          <div className="text-xs font-semibold text-slate-500 mb-2 px-2 uppercase tracking-wider mt-1">{t.recentCases}</div>
          {filteredSessions.length === 0 ? (
            <div className="text-sm text-slate-500 px-2 italic">
              {chatSessions.length === 0 ? t.noRecentCases : "No matching chats found"}
            </div>
          ) : (
            filteredSessions.map(session => (
              <div 
                key={session.id}
                onClick={() => setActiveSessionId(session.id)}
                className={`group flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                  activeSessionId === session.id 
                    ? 'bg-slate-800 text-white font-medium' 
                    : 'hover:bg-slate-800/50 text-slate-400'
                }`}
              >
                {editingSessionId === session.id ? (
                  <div className="flex items-center gap-1 flex-1 pr-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      className="w-full bg-slate-900 border border-blue-500 text-white text-xs rounded px-2 py-1 outline-none"
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
                      className="text-slate-400 hover:text-slate-200 p-1"
                      title="Cancel"
                    >
                      <XIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="truncate flex-1 pr-2">{session.title}</span>
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                      <button 
                        onClick={(e) => handleStartRename(e, session)}
                        className="text-slate-400 hover:text-white p-1 rounded transition-colors"
                        title="Rename Chat"
                      >
                        <EditIcon className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (deleteChatSession) deleteChatSession(session.id);
                        }}
                        className="text-slate-400 hover:text-red-400 p-1 rounded transition-colors"
                        title="Delete Chat"
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

        <div className="p-4 border-t border-slate-800 space-y-3 bg-slate-900/50">
          <div className="flex items-center justify-between px-2 py-1 text-sm bg-slate-800/50 rounded-lg border border-slate-700/50">
            <span className="text-slate-400">{t.plan}: <span className={`font-medium capitalize ${user?.plan && user?.plan !== 'free' ? 'text-yellow-400' : 'text-white'}`}>{user?.plan || 'free'}</span></span>
            {(!user?.plan || user?.plan === 'free') && (
              <span className={`text-xs px-2 py-1 rounded font-medium ${usageSeconds < 300 ? 'bg-red-900/50 text-red-400' : 'bg-slate-700 text-slate-300'}`}>
                {formatTime(usageSeconds)} {t.left}
              </span>
            )}
          </div>
          
          <button 
            onClick={() => setIsSettingsOpen(true)} 
            className="w-full flex items-center gap-2 px-2 py-2 hover:bg-slate-800 rounded-lg transition-colors text-sm text-slate-300"
          >
            <SettingsIcon className="w-4 h-4" />
            {t.settings}
          </button>

          <button 
            onClick={() => setIsSubscriptionModalOpen(true)} 
            className="w-full flex flex-col gap-1 px-3 py-2.5 bg-yellow-500/10 hover:bg-yellow-500/20 rounded-xl transition-colors border border-yellow-500/30 text-yellow-400 mt-1"
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <SparklesIcon className="w-4 h-4" />
              <span>Upgrade Plan</span>
            </div>
            <div className="text-[10px] text-slate-400 text-left pl-6 truncate">
              {plans.map(p => `${p.name} ₹${p.price}`).join(' • ')}
            </div>
          </button>

          <button 
            onClick={logout} 
            className="w-full flex items-center gap-2 px-2 py-2 hover:bg-slate-800 rounded-lg transition-colors text-sm text-red-400 hover:text-red-300 mt-1"
          >
            <LogoutIcon className="w-4 h-4" />
            {t.logout}
          </button>
          
          <div className="flex items-center gap-3 px-2 pt-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-inner">
              {user?.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 truncate text-sm">
              <div className="text-white font-medium truncate">{user?.name}</div>
              <div className="text-xs text-slate-500 truncate">{user?.email}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};