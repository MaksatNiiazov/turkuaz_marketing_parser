import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5178,
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:8040',
        changeOrigin: true,
      },
      '/identity-api': {
        target: process.env.VITE_IDENTITY_PROXY_TARGET || 'http://localhost:8020',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/identity-api/, '/api/v1'),
      },
    },
  },
});
