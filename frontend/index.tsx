import './vertex-ai-proxy-interceptor.js';
import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import App from './App';
import { AppProvider } from './context/AppContext';
import { lockOriginalAppearance, THEME_INK_DARK } from './utils/theme';

async function initNativeShell() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: THEME_INK_DARK });
  } catch (e) {
    console.info('StatusBar unavailable', e);
  }
  try {
    await SplashScreen.hide();
  } catch (e) {
    console.info('SplashScreen unavailable', e);
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
);

lockOriginalAppearance();
initNativeShell();