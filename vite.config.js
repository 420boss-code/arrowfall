import { defineConfig } from 'vite';

// In development the game server runs separately on :8787; Vite forwards the API and WebSocket to it.
// `npm run build:static` makes the offline edition (VITE_OFFLINE=1): relative paths so it runs from any
// folder or static host (itch.io, Netlify, Cloudflare Pages, GitHub Pages…), and no server needed.
const OFFLINE = process.env.VITE_OFFLINE === '1';
export default defineConfig({
  base: OFFLINE ? './' : '/',
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200, outDir: OFFLINE ? 'dist-static' : 'dist' },
});
