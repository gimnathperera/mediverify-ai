import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Resolve workspace packages (@mediverify/shared) to their TypeScript sources.
  resolve: { conditions: ['@mediverify/source', ...defaultClientConditions] },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.API_URL ?? 'http://localhost:3001', changeOrigin: false },
    },
  },
  build: {
    // Source maps would publish the full frontend source from nginx. Opt in for local debugging
    // builds with VITE_SOURCEMAP=true; production images ship none.
    sourcemap: process.env.VITE_SOURCEMAP === 'true',
    chunkSizeWarningLimit: 600,
  },
});
