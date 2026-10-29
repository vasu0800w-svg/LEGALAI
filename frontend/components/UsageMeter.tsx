import React, { useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import {
  getPlanLimits,
  getSessionCharCount,
  hasUnlimitedAccess,
  nextIstMidnightLabel,
  nextMonthResetLabel,
  istDateKey,
} from '../utils/planLimits';

const formatTime = (seconds: number) => {
  const m = Math.floor(Math.max(0, seconds) / 60);
  const s = Math.max(0, seconds) % 60;
  return `${m}m ${s}s`;
};

export const FreeUsageStrip = ({ compact = false }: { compact?: boolean }) => {
  const { user, draftCount, aiUsage, chatSessions, activeSessionId, language, subscribeUsageSeconds } = useAppContext();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => subscribeUsageSeconds(setSeconds), [subscribeUsageSeconds]);

  if (!user || hasUnlimitedAccess(user.email, user) || (user.plan && user.plan !== 'free')) return null;

  const tHi = language === 'Hindi';
  const limits = getPlanLimits(user.plan, user.email, user);
  const day = istDateKey();
  const usedToday = aiUsage?.day === day ? Number(aiUsage.dayRequests || 0) : 0;
  const dailyLeft = Number.isFinite(limits.dailyAiRequests)
    ? Math.max(0, limits.dailyAiRequests - usedToday)
    : null;
  const session = chatSessions.find((s) => s.id === activeSessionId);
  const chars = session ? getSessionCharCount(session.messages) : 0;
  const draftsLeft = Number.isFinite(limits.draftLimit)
    ? Math.max(0, limits.draftLimit - draftCount)
    : null;

  const line = compact
    ? tHi
      ? `आज ${dailyLeft ?? '—'} AI बचे · ड्राफ्ट ${draftsLeft ?? '—'}`
      : `${dailyLeft ?? '—'} AI left today · ${draftsLeft ?? '—'} drafts`
    : tHi
      ? `आज ${dailyLeft ?? '—'} / ${limits.dailyAiRequests} AI अनुरोध बचे। ड्राफ्ट ${draftCount}/${limits.draftLimit}। दैनिक सीमा मध्यरात्रि IST पर रीसेट (${nextIstMidnightLabel()})। मासिक ${nextMonthResetLabel()}।`
      : `${dailyLeft ?? '—'} of ${limits.dailyAiRequests} AI requests left today. Drafts ${draftCount}/${limits.draftLimit}. Daily reset at ${nextIstMidnightLabel()}. Monthly drafts reset ${nextMonthResetLabel()}.`;

  return (
    <p className={`text-[11px] leading-snug ${seconds < 300 ? 'text-amber-300' : 'text-band-mute'}`}>
      {limits.dailySeconds > 0 ? `${formatTime(seconds)} · ` : ''}
      {line}
      {session && Number.isFinite(limits.maxSessionChars) ? (
        tHi
          ? ` · इस चैट में ${chars.toLocaleString('en-IN')}/${limits.maxSessionChars.toLocaleString('en-IN')} अक्षर`
          : ` · ${chars.toLocaleString('en-IN')}/${limits.maxSessionChars.toLocaleString('en-IN')} characters in this chat`
      ) : null}
    </p>
  );
};
