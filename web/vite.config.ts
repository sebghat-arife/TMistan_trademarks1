import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

/**
 * Environment variables.
 *
 * The app reads the PUBLIC Supabase settings at build time. Two naming styles
 * are accepted so the same variables work on Railway/Render/Vercel and locally:
 *
 *   SUPABASE_URL             or VITE_SUPABASE_URL
 *   SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY
 *
 * Only these are ever inlined into the browser bundle. Anything else — in
 * particular SUPABASE_SERVICE_ROLE_KEY — is never read here, so it cannot leak
 * into client JavaScript even if it is present in the build environment.
 */
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const supabaseUrl = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? ''
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? ''
  const localStorageBase = env.VITE_LOCAL_STORAGE_BASE ?? ''

  if (publishableKey && /^sb_secret_|"role"\s*:\s*"service_role"/.test(safeDecode(publishableKey))) {
    throw new Error('Refusing to build: a SECRET/service-role key was supplied as the public Supabase key.')
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    define: {
      __SUPABASE_URL__: JSON.stringify(supabaseUrl),
      __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(publishableKey),
      __LOCAL_STORAGE_BASE__: JSON.stringify(localStorageBase),
      __APP_VERSION__: JSON.stringify(env.npm_package_version ?? '0.0.0'),
      // Public site metadata (optional, shown in the footer). Not secrets.
      __SITE_CONTACT__: JSON.stringify({
        email: env.SITE_CONTACT_EMAIL ?? '',
        phone: env.SITE_CONTACT_PHONE ?? '',
        address: env.SITE_CONTACT_ADDRESS ?? '',
        facebook: env.SITE_FACEBOOK_URL ?? '',
        twitter: env.SITE_TWITTER_URL ?? '',
        linkedin: env.SITE_LINKEDIN_URL ?? '',
      }),
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      // Allow the sandbox preview host (and any other host) to reach the dev server.
      allowedHosts: true,
      proxy: {
        // Local dev stack only: the Supabase-compatible API is proxied under
        // /supabase so the browser never talks to localhost:54321 directly.
        // supabase-js Storage calls <url>/storage/v1/...; the local stand-in
        // (scripts/local-stack/static_storage.py) serves the same routes.
        '/supabase/storage/v1': {
          target: 'http://127.0.0.1:54322',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/supabase\/storage\/v1/, ''),
        },
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
  }
})

/** Decode a JWT payload just enough to detect a service-role token; never throws. */
function safeDecode(key: string): string {
  try {
    const part = key.split('.')[1]
    return part ? key + Buffer.from(part, 'base64url').toString('utf8') : key
  } catch {
    return key
  }
}
