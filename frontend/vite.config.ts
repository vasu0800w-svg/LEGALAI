import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const firebaseRequire = createRequire(path.join(__dirname, 'node_modules/firebase/package.json'));
const firebasePkgs = [
  '@firebase/app',
  '@firebase/auth',
  '@firebase/firestore',
  '@firebase/storage',
  '@firebase/app-check',
  '@firebase/util',
  '@firebase/component',
  '@firebase/logger',
  '@firebase/webchannel-wrapper',
] as const;
const firebaseAliases: Record<string, string> = {};
for (const name of firebasePkgs) {
  try {
    firebaseAliases[name] = path.dirname(firebaseRequire.resolve(`${name}/package.json`));
  } catch {
    /* optional product not installed */
  }
}

export default defineConfig(({ mode }) => {
  loadEnv(mode, process.cwd(), '');
  return {
    base: '/',
    define: {
      'process.env.API_KEY': JSON.stringify('api-key-this-is-not-used-can-be-ignored!'),
    },
    server: {
      host: true,
      proxy: {
        '/api-proxy': 'http://127.0.0.1:5000',
        '/api/validate-chat-limits': 'http://127.0.0.1:5000',
        '/api/entitlements': 'http://127.0.0.1:5000',
        '/api/devices': 'http://127.0.0.1:5000',
        '/api/create-order': 'http://127.0.0.1:5000',
        '/api/verify-payment': 'http://127.0.0.1:5000',
        '/api/gemini': 'http://127.0.0.1:5000',
        '/api/custom-plan': 'http://127.0.0.1:5000',
        '/api/admin': 'http://127.0.0.1:5000',
        '/ws-proxy': { target: 'ws://127.0.0.1:5000', ws: true },
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      chunkSizeWarningLimit: 2000,
    },
    plugins: [react()],
    optimizeDeps: {
      include: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
    },
    resolve: {
      dedupe: ['firebase', ...firebasePkgs],
      alias: {
        '@': path.resolve(__dirname, '.'),
        ...firebaseAliases,
      },
    },
  };
});
