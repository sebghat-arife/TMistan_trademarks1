import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

/* Build-time constants injected by vite.config.ts from SUPABASE_URL /
 * SUPABASE_PUBLISHABLE_KEY (or their VITE_ aliases). Nothing else from the
 * environment reaches the browser bundle. */
declare const __SUPABASE_URL__: string
declare const __SUPABASE_PUBLISHABLE_KEY__: string
declare const __LOCAL_STORAGE_BASE__: string

const url = __SUPABASE_URL__
const publishableKey = __SUPABASE_PUBLISHABLE_KEY__

/** Set when the build was produced without Supabase settings — the app shows a configuration screen instead of fake data. */
export const supabaseConfigError: string | null =
  !url || !publishableKey
    ? 'SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set when the web app is built.'
    : !/^https?:\/\/|^\//.test(url)
      ? `SUPABASE_URL "${url}" is not a valid URL.`
      : null

/**
 * True when pointing at the local PostgreSQL + PostgREST stack (a relative
 * URL proxied by Vite) instead of a real Supabase project.
 */
export const isLocalStack = url.startsWith('/')

// supabase-js needs an absolute URL; for the local proxy build one from the page origin.
const resolvedUrl = isLocalStack
  ? new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost').toString().replace(/\/$/, '')
  : url.replace(/\/$/, '')

/**
 * DEV ONLY — the local stack has no GoTrue, so an administrator session is
 * emulated with a pre-minted `authenticated` JWT (see scripts/local-stack/
 * mint_jwt.py). It is kept in sessionStorage and sent as the bearer token;
 * RLS + is_admin() then behave exactly as they would in production.
 */
export const LOCAL_ADMIN_TOKEN_KEY = 'tmistan.localAdminToken'
export const localAdminToken = isLocalStack && typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(LOCAL_ADMIN_TOKEN_KEY) : null

/**
 * Single Supabase client for the whole app — publishable (anon) key only,
 * Row Level Security enforced by the database. The service-role key is never
 * read by the frontend build and must never appear in this bundle.
 */
export const supabase = createClient<Database>(resolvedUrl || 'http://unconfigured.invalid', publishableKey || 'unconfigured', {
  auth: { persistSession: !isLocalStack, autoRefreshToken: !isLocalStack },
  global: {
    headers: {
      'x-application-name': 'tmistan-web',
      ...(localAdminToken ? { Authorization: `Bearer ${localAdminToken}` } : {}),
    },
  },
})

/** Public URL for an object in Supabase Storage (or the local static server). */
export function storagePublicUrl(bucket: string | null | undefined, path: string | null | undefined): string | null {
  if (!bucket || !path) return null
  if (isLocalStack) {
    const base = __LOCAL_STORAGE_BASE__ || '/local-storage'
    return `${base}/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`
  }
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
}
