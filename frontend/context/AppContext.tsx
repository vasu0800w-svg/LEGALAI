import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, ChatSession, Message } from '../types';
import { db } from '../services/firebaseService';
import { doc, getDoc, setDoc } from 'firebase/firestore';

interface AppContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  chatSessions: ChatSession[];
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  createNewSession: () => void;
  addMessageToActiveSession: (message: Message) => void;
  updateMessageText: (messageId: string, newText: string) => void;
  deleteChatSession: (sessionId: string) => void;
  renameChatSession: (sessionId: string, newTitle: string) => void;
  usageSeconds: number;
  isTimeUp: boolean;
  language: string;
  setLanguage: (lang: string) => void;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (isOpen: boolean) => void;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
  isSubscriptionModalOpen: boolean;
  setIsSubscriptionModalOpen: (isOpen: boolean) => void;
  isMockRazorpayOpen: boolean;
  setIsMockRazorpayOpen: (isOpen: boolean) => void;
  upgradeToPro: () => void;
  logout: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const loadState = <T,>(key: string, defaultValue: T): T => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : defaultValue;
  } catch (e) {
    console.error(`Error loading ${key} from localStorage`, e);
    return defaultValue;
  }
};

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const initialUser = loadState<User | null>('casemate_current_user', null);
  
  const [user, setUserState] = useState<User | null>(initialUser);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>(() => initialUser ? loadState(`casemate_chats_${initialUser.id}`, []) : []);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => initialUser ? loadState(`casemate_active_session_${initialUser.id}`, null) : null);
  const [usageSeconds, setUsageSeconds] = useState(() => initialUser ? loadState(`casemate_usage_${initialUser.id}`, 3600) : 3600);
  const [isTimeUp, setIsTimeUp] = useState(() => initialUser ? loadState(`casemate_timeup_${initialUser.id}`, false) : false);
  const [language, setLanguage] = useState(() => loadState('casemate_lang', 'English'));
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] = useState(false);
  const [isMockRazorpayOpen, setIsMockRazorpayOpen] = useState(false);

  // User login hone par Firestore se chats AUR user profile (plan) fetch karna
  useEffect(() => {
    const fetchCloudData = async () => {
      if (user && user.id) {
        try {
          const docRef = doc(db, 'users_data', user.id);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.chatSessions) {
              setChatSessions(data.chatSessions);
            }
            // Agar cloud par plan pro hai, toh user state ko bhi pro update kar do
            if (data.plan && data.plan !== user.plan) {
              setUserState(prev => prev ? { ...prev, plan: data.plan, subscriptionExpiryDate: data.subscriptionExpiryDate } : null);
            }
          }
        } catch (error) {
          console.error("Error fetching from Firestore:", error);
        }
      }
    };
    fetchCloudData();
  }, [user?.id]);

  // Chat sessions ya User profile change hote hi Firestore par save karna
  useEffect(() => {
    const saveCloudData = async () => {
      if (user && user.id) {
        try {
          const docRef = doc(db, 'users_data', user.id);
          await setDoc(docRef, { 
            userId: user.id,
            email: user.email,
            name: user.name,
            plan: user.plan,
            subscriptionExpiryDate: user.subscriptionExpiryDate || null,
            chatSessions: chatSessions, 
            updatedAt: Date.now() 
          }, { merge: true });
        } catch (error) {
          console.error("Error saving to Firestore:", error);
        }
      }
    };
    saveCloudData();
  }, [chatSessions, user]);

  // Automatic Downgrade Logic
  useEffect(() => {
    if (user && user.plan === 'pro' && user.subscriptionExpiryDate && Date.now() > user.subscriptionExpiryDate) {
      const downgradedUser = { ...user, plan: 'free' as const };
      delete downgradedUser.subscriptionExpiryDate;
      setUserState(downgradedUser);
      
      const usersDb = JSON.parse(localStorage.getItem('casemate_users_db') || '[]');
      const updatedDb = usersDb.map((u: any) => u.id === user.id ? { ...u, plan: 'free', subscriptionExpiryDate: undefined } : u);
      localStorage.setItem('casemate_users_db', JSON.stringify(updatedDb));
    }
  }, [user]);

  const handleSetUser = (newUser: User | null) => {
    setUserState(newUser);
    if (newUser) {
      setChatSessions(loadState(`casemate_chats_${newUser.id}`, []));
      setActiveSessionId(loadState(`casemate_active_session_${newUser.id}`, null));
      setUsageSeconds(loadState(`casemate_usage_${newUser.id}`, 3600));
      setIsTimeUp(loadState(`casemate_timeup_${newUser.id}`, false));
    } else {
      setChatSessions([]);
      setActiveSessionId(null);
      setUsageSeconds(3600);
      setIsTimeUp(false);
    }
  };

  const logout = () => {
    handleSetUser(null);
  };

  // LocalStorage Sync
  useEffect(() => { localStorage.setItem('casemate_current_user', JSON.stringify(user)); }, [user]);
  useEffect(() => { if (user) localStorage.setItem(`casemate_chats_${user.id}`, JSON.stringify(chatSessions)); }, [chatSessions, user]);
  useEffect(() => { if (user) localStorage.setItem(`casemate_active_session_${user.id}`, JSON.stringify(activeSessionId)); }, [activeSessionId, user]);
  useEffect(() => { if (user) localStorage.setItem(`casemate_usage_${user.id}`, JSON.stringify(usageSeconds)); }, [usageSeconds, user]);
  useEffect(() => { if (user) localStorage.setItem(`casemate_timeup_${user.id}`, JSON.stringify(isTimeUp)); }, [isTimeUp, user]);
  useEffect(() => { localStorage.setItem('casemate_lang', JSON.stringify(language)); }, [language]);

  // Timer for Free Tier
  useEffect(() => {
    let timer: number;
    if (user?.plan === 'free' && !isTimeUp) {
      timer = window.setInterval(() => {
        setUsageSeconds((prev: number) => {
          if (prev <= 1) {
            setIsTimeUp(true);
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [user, isTimeUp]);

  const createNewSession = () => {
    const newSession: ChatSession = {
      id: Date.now().toString(),
      title: 'New Case Analysis',
      messages: [],
      updatedAt: Date.now(),
    };
    setChatSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
  };

  const addMessageToActiveSession = (message: Message) => {
    setChatSessions((prev) =>
      prev.map((session) => {
        if (session.id === activeSessionId) {
          let title = session.title;
          if (session.messages.length === 0 && message.role === 'user') {
            title = message.text.slice(0, 30) + (message.text.length > 30 ? '...' : '');
          }
          return {
            ...session,
            title,
            messages: [...session.messages, message],
            updatedAt: Date.now(),
          };
        }
        return session;
      })
    );
  };

  const updateMessageText = (messageId: string, newText: string) => {
    setChatSessions((prev) =>
      prev.map((session) => {
        if (session.id === activeSessionId) {
          return {
            ...session,
            messages: session.messages.map((msg) =>
              msg.id === messageId ? { ...msg, text: newText } : msg
            ),
            updatedAt: Date.now(),
          };
        }
        return session;
      })
    );
  };

  const deleteChatSession = (sessionId: string) => {
    setChatSessions((prev) => {
      const updated = prev.filter(s => s.id !== sessionId);
      if (activeSessionId === sessionId) {
        setActiveSessionId(updated.length > 0 ? updated[0].id : null);
      }
      return updated;
    });
  };

  const renameChatSession = (sessionId: string, newTitle: string) => {
    setChatSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId ? { ...session, title: newTitle } : session
      )
    );
  };

  const upgradeToPro = async () => {
    if (user) {
      const expiryDate = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const updatedUser = { ...user, plan: 'pro' as const, subscriptionExpiryDate: expiryDate };
      setUserState(updatedUser);
      setIsTimeUp(false);
      
      // Firestore par turant update save kar do taaki saare devices mein sync ho jaye
      try {
        const docRef = doc(db, 'users_data', user.id);
        await setDoc(docRef, {
          plan: 'pro',
          subscriptionExpiryDate: expiryDate,
          updatedAt: Date.now()
        }, { merge: true });
      } catch (e) {
        console.error("Error updating pro plan to cloud:", e);
      }
      
      const usersDb = JSON.parse(localStorage.getItem('casemate_users_db') || '[]');
      const updatedDb = usersDb.map((u: any) => u.id === user.id ? { ...u, plan: 'pro', subscriptionExpiryDate: expiryDate } : u);
      localStorage.setItem('casemate_users_db', JSON.stringify(updatedDb));
    }
  };

  return (
    <AppContext.Provider
      value={{
        user,
        setUser: handleSetUser,
        chatSessions,
        activeSessionId,
        setActiveSessionId,
        createNewSession,
        addMessageToActiveSession,
        updateMessageText,
        deleteChatSession,
        renameChatSession,
        usageSeconds,
        isTimeUp,
        language,
        setLanguage,
        isSettingsOpen,
        setIsSettingsOpen,
        isSidebarOpen,
        setIsSidebarOpen,
        isSubscriptionModalOpen,
        setIsSubscriptionModalOpen,
        isMockRazorpayOpen,
        setIsMockRazorpayOpen,
        upgradeToPro,
        logout
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};