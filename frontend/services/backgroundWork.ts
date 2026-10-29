import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';

type WorkKind = 'analysis' | 'draft';
type WorkStatus = 'ok' | 'fail' | 'cancel';

interface BackgroundWorkPlugin {
  start(options: { title: string; body: string }): Promise<void>;
  finish(options: { title: string; body: string }): Promise<void>;
  cancel(): Promise<void>;
}

const nativeWork = registerPlugin<BackgroundWorkPlugin>('BackgroundWork');

const appIsAway = async () => {
  if (Capacitor.isNativePlatform()) {
    try {
      const state = await App.getState();
      return !state.isActive;
    } catch {
      return document.hidden;
    }
  }
  return document.hidden;
};

const workingText = (kind: WorkKind, language: string) => {
  const hi = language === 'Hindi';
  if (kind === 'draft') return hi ? 'ड्राफ्ट बन रहा है… आप फ़ोन पर और काम कर सकते हैं।' : 'Writing your draft… you can use your phone.';
  return hi ? 'विश्लेषण चल रहा है… आप फ़ोन पर और काम कर सकते हैं।' : 'Analysing your papers… you can use your phone.';
};

const doneText = (status: WorkStatus, kind: WorkKind, language: string) => {
  const hi = language === 'Hindi';
  if (status === 'fail') {
    return {
      title: hi ? 'काम पूरा नहीं हुआ' : 'casemate could not finish',
      body: hi ? 'ऐप खोलकर फिर कोशिश करें।' : 'Open casemate and try again.',
    };
  }
  if (kind === 'draft') {
    return {
      title: hi ? 'ड्राफ्ट तैयार है' : 'Your draft is ready',
      body: hi ? 'casemate खोलकर ड्राफ्ट पढ़ें।' : 'Open casemate to read the draft.',
    };
  }
  return {
    title: hi ? 'विश्लेषण पूरा हुआ' : 'Analysis complete',
    body: hi ? 'casemate खोलकर विश्लेषण पढ़ें।' : 'Open casemate to read the analysis.',
  };
};

/** Shows a quiet ongoing notice and keeps the phone app awake while work runs. */
export const beginBackgroundWork = async (kind: WorkKind, language: string) => {
  if (Capacitor.getPlatform() === 'android') {
    try {
      await nativeWork.start({ title: 'casemate', body: workingText(kind, language) });
    } catch (err) {
      console.warn('[background] start failed', err);
    }
    return;
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    void Notification.requestPermission().catch(() => {});
  }
};

/** Notifies only when the advocate has left the app. */
export const endBackgroundWork = async (status: WorkStatus, kind: WorkKind, language: string) => {
  const away = status !== 'cancel' && (await appIsAway());
  if (Capacitor.getPlatform() === 'android') {
    try {
      if (!away) {
        await nativeWork.cancel();
        return;
      }
      const note = doneText(status, kind, language);
      await nativeWork.finish(note);
    } catch (err) {
      console.warn('[background] finish failed', err);
    }
    return;
  }
  if (!away || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const note = doneText(status, kind, language);
  try {
    new Notification(note.title, { body: note.body });
  } catch {
    /* the browser blocked it */
  }
};
