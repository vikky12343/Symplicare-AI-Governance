import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    /* The API runs on its own origin. Proxying in development keeps cookies
       first-party, so the session behaves exactly as it will in production
       behind a single hostname. */
    proxy: {
      '/api': {
        target: process.env.API_ORIGIN ?? 'http://localhost:4000',
        changeOrigin: false,
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
