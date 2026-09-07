import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy web/.env.example to web/.env.local.',
  )
}

/**
 * True when pointing at the local PostgreSQL + PostgREST stack (a relative
 * URL proxied by Vite) instead of a real Supabase project.
 */
export const isLocalStack = url.startsWith('/')

// supabase-js needs an absolute URL; for the local proxy build one from the page origin.
const resolvedUrl = isLocalStack
  ? new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost').toString().replace(/\/$/, '')
  : url

/**
 * DEV ONLY — the local stack has no GoTrue, so an administrator session is
 * emulated with a pre-minted `authenticated` JWT (see scripts/local-stack/
 * mint_jwt.py). It is kept in sessionStorage and sent as the bearer token;
 * RLS + is_admin() then behave exactly as they would in production.
 */
export const LOCAL_ADMIN_TOKEN_KEY = 'tmistan.localAdminToken'
export const localAdminToken = isLocalStack && typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(LOCAL_ADMIN_TOKEN_KEY) : null

/**
 * Single Supabase client for the whole app — anon key only, RLS enforced.
 * The service-role key must never appear anywhere in this bundle.
 */
export const supabase = createClient<Database>(resolvedUrl, anonKey, {
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
    const base = (import.meta.env.VITE_LOCAL_STORAGE_BASE as string | undefined) ?? '/local-storage'
    return `${base}/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`
  }
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
}
