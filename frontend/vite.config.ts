import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    return {
      define: {
        // This is just generic value for the GEMINI API key.
        // This is not used at all, and can be ignored!
        'process.env.API_KEY' : JSON.stringify('api-key-this-is-not-used-can-be-ignored!'),
      },
      server: {
        host: true, // Phone ya local network par access karne ke liye zaroori hai
        proxy: {
          // Target your Node.js backend using your laptop's network IP for phone compatibility
          '/api-proxy': 'http://10.173.142.120:5000',
          '/ws-proxy': { target: 'ws://10.173.142.120:5000', ws: true },
        },
      },
      plugins: react(),
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});