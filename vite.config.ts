import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const basePath = process.env.BASE_PATH || '/'

// https://vite.dev/config/
export default defineConfig({
  base: basePath,
  plugins: [react()],
  server: {
    proxy: {
      '/api/auth': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
      },
      '/api/forge': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
      },
      '/api/anthropic': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/anthropic/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('anthropic-version', '2023-06-01');
          });
        },
      },
      '/api/gemini': {
        target: 'https://generativelanguage.googleapis.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/gemini/, ''),
      },
      '/api/openrouter': {
        target: 'https://openrouter.ai/api',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/openrouter/, ''),
      },
    },
  },
})
