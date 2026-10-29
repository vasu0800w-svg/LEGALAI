import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

type SpeechListenPlugin = {
  available(): Promise<{ available: boolean }>;
  requestPermission(): Promise<{ granted: boolean }>;
  start(options: { language: string }): Promise<void>;
  stop(): Promise<void>;
  addListener(
    eventName: 'result',
    listenerFunc: (data: { text: string; isFinal: boolean }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'error',
    listenerFunc: (data: { error: string }) => void
  ): Promise<PluginListenerHandle>;
};

const native = registerPlugin<SpeechListenPlugin>('SpeechListen');

let handles: PluginListenerHandle[] = [];

export const isAndroidSpeechPlatform = () => Capacitor.getPlatform() === 'android';

export const nativeSpeechAvailable = async () => {
  if (!isAndroidSpeechPlatform()) return false;
  try {
    const result = await native.available();
    return !!result.available;
  } catch {
    return false;
  }
};

export const startNativeSpeech = async (opts: {
  language: string;
  onResult: (text: string, isFinal: boolean) => void;
  onError: (error: string) => void;
}) => {
  await stopNativeSpeech();
  handles = [
    await native.addListener('result', (data) => opts.onResult(data?.text || '', !!data?.isFinal)),
    await native.addListener('error', (data) => opts.onError(data?.error || 'error')),
  ];
  await native.start({ language: opts.language || 'en-IN' });
};

export const stopNativeSpeech = async () => {
  try {
    await native.stop();
  } catch {
    /* ignore */
  }
  const current = handles;
  handles = [];
  await Promise.all(current.map((handle) => handle.remove().catch(() => undefined)));
};
