import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Allow the sandbox preview host (and any other host) to reach the dev server.
    allowedHosts: true,
    proxy: {
      // Browser never talks to localhost:54321 directly; in local dev the
      // Supabase-compatible API is proxied under /supabase.
      '/supabase': {
        target: 'http://127.0.0.1:54321',
        changeOrigin: true,
        // supabase-js calls <url>/rest/v1/...; local PostgREST serves at the root.
        rewrite: (p) => p.replace(/^\/supabase\/rest\/v1/, '').replace(/^\/supabase/, ''),
      },
      '/local-storage': {
        target: 'http://127.0.0.1:54322',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/local-storage/, ''),
      },
    },
  },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/ },
            { name: 'vendor-supabase', test: /node_modules[\\/]@supabase[\\/]/ },
            { name: 'vendor-i18n', test: /node_modules[\\/](i18next|react-i18next|i18next-browser-languagedetector)[\\/]/ },
          ],
        },
      },
    },
  },
})
