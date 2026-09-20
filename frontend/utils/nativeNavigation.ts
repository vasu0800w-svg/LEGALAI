import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

type NavHandlers = {
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  isSubscriptionModalOpen: boolean;
  setIsSubscriptionModalOpen: (open: boolean) => void;
  isUpgradeModalOpen: boolean;
  setIsUpgradeModalOpen: (open: boolean) => void;
  isMockRazorpayOpen: boolean;
  setIsMockRazorpayOpen: (open: boolean) => void;
};

/** Stable for the life of the JS process (survives React StrictMode remounts). */
let processColdStart: boolean | null = null;

/** Document editor overlay — Android back should close it first. */
let documentEditorCloser: (() => boolean) | null = null;

export const registerDocumentEditorCloser = (fn: (() => boolean) | null) => {
  documentEditorCloser = fn;
};

/**
 * True on first launch after the WebView/process was killed (swipe away / force stop).
 * False when the same process is still alive (background → foreground, or remount).
 */
export function consumeColdStart(): boolean {
  if (processColdStart !== null) return processColdStart;
  try {
    const already = sessionStorage.getItem('casemate_process') === '1';
    sessionStorage.setItem('casemate_process', '1');
    processColdStart = !already;
  } catch {
    processColdStart = true;
  }
  return processColdStart;
}

/**
 * Android back: close overlays first (sidebar / modals), then minimize app.
 */
export function useNativeAppNavigation(h: NavHandlers) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let remove: (() => void) | undefined;

    CapApp.addListener('backButton', ({ canGoBack }) => {
      if (documentEditorCloser?.()) return;
      if (h.isMockRazorpayOpen) {
        h.setIsMockRazorpayOpen(false);
        return;
      }
      if (h.isUpgradeModalOpen) {
        h.setIsUpgradeModalOpen(false);
        return;
      }
      if (h.isSubscriptionModalOpen) {
        h.setIsSubscriptionModalOpen(false);
        return;
      }
      if (h.isSettingsOpen) {
        h.setIsSettingsOpen(false);
        return;
      }
      if (h.isSidebarOpen) {
        h.setIsSidebarOpen(false);
        return;
      }
      if (canGoBack) {
        window.history.back();
        return;
      }
      CapApp.minimizeApp().catch(() => {
        /* ignore */
      });
    }).then((handle) => {
      remove = () => handle.remove();
    });

    return () => {
      remove?.();
    };
  }, [
    h.isSidebarOpen,
    h.isSettingsOpen,
    h.isSubscriptionModalOpen,
    h.isUpgradeModalOpen,
    h.isMockRazorpayOpen,
    h.setIsSidebarOpen,
    h.setIsSettingsOpen,
    h.setIsSubscriptionModalOpen,
    h.setIsUpgradeModalOpen,
    h.setIsMockRazorpayOpen,
  ]);
}
