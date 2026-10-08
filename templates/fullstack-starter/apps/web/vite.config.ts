import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // The preview is served from a sandbox host, not localhost.
    allowedHosts: true,
    proxy: {
      '/api': `http://localhost:${process.env.API_PORT ?? 3001}`,
    },
  },
});
