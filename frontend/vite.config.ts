import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
        '/api/create-order': 'http://127.0.0.1:5000',
        '/api/verify-payment': 'http://127.0.0.1:5000',
        '/api/gemini': 'http://127.0.0.1:5000',
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
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
