import React from 'react';
import { useAppContext } from '../context/AppContext';
import { XIcon } from './Icons';
import { translations } from '../utils/translations';

export const SettingsModal = () => {
  const { isSettingsOpen, setIsSettingsOpen, language, setLanguage, user } = useAppContext();

  if (!isSettingsOpen) return null;

  const t = translations[language] || translations['English'];
  const languages = ['English', 'Hindi'];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm p-4">
      <div className="bg-slate-900 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border border-slate-800">
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <h2 className="text-xl font-bold text-white">{t.settings}</h2>
          <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800 transition-colors">
            <XIcon className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1 space-y-8">
          {/* Language Section */}
          <section>
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">{t.appLang}</h3>
            <p className="text-sm text-slate-500 mb-4">{t.selectLang}</p>
            <select 
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full p-3 border border-slate-700 rounded-xl bg-slate-800 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              {languages.map(lang => (
                <option key={lang} value={lang}>{lang === 'Hindi' ? 'हिंदी' : lang}</option>
              ))}
            </select>
          </section>

          {/* Subscription Section */}
          <section>
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">{t.subAndBilling}</h3>
            
            <div className="border rounded-xl p-5 border-slate-700 bg-slate-800/50">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-bold text-lg text-white capitalize">
                    {user?.plan || 'Free'} {t.plan}
                  </div>
                  <div className="text-sm text-slate-400 mt-1">
                    {(!user?.plan || user?.plan === 'free') ? t.freeLimit : t.unlimitedAccess}
                  </div>
                </div>
                <span className="bg-blue-900/50 text-blue-400 border border-blue-800 text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide">
                  {t.active}
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};