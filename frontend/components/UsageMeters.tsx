import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { IncreaseChatLimitModal } from './IncreaseChatLimitModal';
import { chatLimitProximity } from '../utils/planLimits';
import {
  countCasePhotos,
  getPlanLimits,
  getSessionCharCount,
  hasUnlimitedAccess,
  istDateKey,
  nextIstMidnightLabel,
  nextMonthResetLabel,
} from '../utils/planLimits';

const Meter = ({
  label,
  used,
  limit,
  hint,
}: {
  label: string;
  used: number;
  limit: number;
  hint?: string;
}) => {
  const infinite = !Number.isFinite(limit);
  const pct = infinite ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return (
    <div>
      <div className="flex justify-between gap-2 text-sm">
        <span className="text-band-mute">{label}</span>
        <span className="text-band">
          {infinite ? 'Fair use' : `${used.toLocaleString('en-IN')} / ${limit.toLocaleString('en-IN')}`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-ink-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${pct >= 90 ? 'bg-amber-400' : 'bg-white/70'}`}
          style={{ width: infinite ? '8%' : `${pct}%` }}
        />
      </div>
      {hint ? <p className="text-[11px] text-band-mute mt-1">{hint}</p> : null}
    </div>
  );
};

export const UsageMeters = ({ deviceCount }: { deviceCount?: number } = {}) => {
  const { user, draftCount, aiUsage, chatSessions, activeSessionId } = useAppContext();
  const [chatLimitOpen, setChatLimitOpen] = useState(false);
  if (!user) return null;
  const unlimited = hasUnlimitedAccess(user.email, user);
  const limits = getPlanLimits(user.plan, user.email, user);
  const session = chatSessions.find((s) => s.id === activeSessionId);
  const chars = session ? getSessionCharCount(session.messages) : 0;
  const proximity = chatLimitProximity(chars, limits.maxSessionChars);
  const photos = session ? countCasePhotos(session.messages) : 0;
  const day = istDateKey();
  const usedToday = aiUsage?.day === day ? Number(aiUsage.dayRequests || 0) : 0;
  const devices = limits.maxDevices;

  if (unlimited) {
    return <p className="text-sm text-band-mute">This account has unlimited access. Fair-use meters do not apply.</p>;
  }

  return (
    <div className="space-y-4">
      <Meter
        label="Characters in this chat"
        used={chars}
        limit={limits.maxSessionChars}
        hint={Number.isFinite(limits.maxSessionChars) ? 'Extra capacity applies to every chat for the rest of this calendar month.' : undefined}
      />
      {!unlimited && Number.isFinite(limits.maxSessionChars) ? (
        <button
          type="button"
          onClick={() => setChatLimitOpen(true)}
          className="w-full py-2 rounded-xl border border-ink-border text-sm text-band"
        >
          Increase Chat Limit
        </button>
      ) : null}
      <IncreaseChatLimitModal
        open={chatLimitOpen}
        reason={proximity === 'reached' ? 'reached' : 'near'}
        usedChars={chars}
        onClose={() => setChatLimitOpen(false)}
      />
      <Meter
        label="Photos in this chat"
        used={photos}
        limit={limits.maxPhotosPerChat}
        hint={`Up to ${Number.isFinite(limits.maxPhotosPerUpload) ? limits.maxPhotosPerUpload : '—'} photos per upload.`}
      />
      <Meter
        label="Drafts this month"
        used={typeof aiUsage?.monthDrafts === 'number' ? aiUsage.monthDrafts : draftCount}
        limit={limits.draftLimit}
        hint={`Resets ${nextMonthResetLabel()}.`}
      />
      <Meter
        label="AI requests today"
        used={usedToday}
        limit={limits.dailyAiRequests}
        hint={`Resets at ${nextIstMidnightLabel()}.`}
      />
      <Meter
        label="Device allowance"
        used={Math.max(0, Number(deviceCount) || 0)}
        limit={devices}
        hint={`Up to ${devices} devices. Unused slots free after 14 days.`}
      />
    </div>
  );
};
