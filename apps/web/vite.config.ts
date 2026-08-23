/* Vite loads .env into import.meta.env for the application, but not into
   process.env for this config file, so API_ORIGIN below would be ignored
   without this. Development only — a built bundle contains no hostname at
   all, because the browser calls /api on whatever origin served the page. */
import 'dotenv/config';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';
const isRemoteApi = !/^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(apiOrigin);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    /* The API runs on its own origin. Proxying in development keeps cookies
       first-party, so the session behaves exactly as it will in production
       behind a single hostname.

       Point API_ORIGIN at a deployed API in apps/web/.env to develop the
       front end against it:
         API_ORIGIN=https://symplicare-ai-governance-backend.onrender.com */
    proxy: {
      '/api': {
        target: apiOrigin,
        /* A remote host routes on the Host header — Render would not know
           which service a request with "localhost:5173" belongs to. Left
           alone for a local API so the origin stays exactly as it will be in
           production, behind a single hostname. */
        changeOrigin: isRemoteApi,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
  /* Vitest's options live on the same object; the Vite config type does not
     know about them. @ts-expect-error rather than @ts-ignore so this comment
     itself fails the build if it ever stops being needed. */
  // @ts-expect-error -- vitest extends the Vite config at runtime
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    /* The Playwright specs are driven by Playwright, not vitest. */
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
  },
});
