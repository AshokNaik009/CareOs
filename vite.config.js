import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const web = resolve(__dirname, 'web');

// Pages: /, /patient.html, /provider.html, /privacy.html (also served at /privacy).
// In dev, /api (including the SSE stream) goes to the Node server. Use 127.0.0.1: the server
// binds IPv4 only and "localhost" can resolve to ::1.
export default defineConfig({
  root: web,
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    // The ElevenLabs SDK (with LiveKit) is ~630 kB; only the patient and provider pages load it.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          if (id.includes('node_modules/')) return 'voice-sdk';
        },
      },
      input: {
        index: resolve(web, 'index.html'),
        patient: resolve(web, 'patient.html'),
        provider: resolve(web, 'provider.html'),
        privacy: resolve(web, 'privacy.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.PORT || 3000}`, changeOrigin: true } },
  },
});
