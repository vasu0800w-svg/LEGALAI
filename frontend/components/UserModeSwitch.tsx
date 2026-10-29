import React from 'react';
import { useAppContext } from '../context/AppContext';
import { translations } from '../utils/translations';
import { UserMode } from '../types';

/**
 * Advocate / Judge picker. Used on the login page and in Settings.
 * It only changes the drafting format and templates; everything else is shared.
 */
export const UserModeSwitch = ({ showHint = true }: { showHint?: boolean }) => {
  const { userMode, setUserMode, language } = useAppContext();
  const t = translations[language] || translations['English'];

  const options: { id: UserMode; label: string; hint: string }[] = [
    { id: 'advocate', label: t.userModeAdvocate || 'Advocate', hint: t.userModeAdvocateHint || '' },
    { id: 'judge', label: t.userModeJudge || 'Judge', hint: t.userModeJudgeHint || '' },
  ];
  const active = options.find((o) => o.id === userMode) || options[0];

  return (
    <div>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t.userModeTitle || 'I am a'}>
        {options.map((option) => {
          const selected = option.id === userMode;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setUserMode(option.id)}
              className={`py-2 rounded-lg text-sm font-medium transition-colors ${
                selected ? 'bg-white text-black' : 'border border-ink-border text-band-mute hover:text-band'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {showHint && active.hint && (
        <p className="mt-2 text-xs text-band-mute text-center">{active.hint}</p>
      )}
    </div>
  );
};
