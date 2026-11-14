import { defineConfig } from 'vite';

// In development the game server runs separately on :8787; Vite forwards the API and WebSocket to it.
export default defineConfig({
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
