import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ImportJobRow } from '@/lib/database.types'
import { unwrap } from './_shared'

/* ---------------------------------------------------------------------------
 * Admin service — tables that RLS exposes only to administrators
 * (`is_admin()` = the JWT subject has a row in public.user_roles).
 * For anyone else PostgREST returns an empty list, never an error.
 * ------------------------------------------------------------------------- */

export async function listImportJobs(limit = 10): Promise<ImportJobRow[]> {
  return unwrap(await supabase.from('import_jobs').select('*').order('created_at', { ascending: false }).limit(limit)) as ImportJobRow[]
}

export const importJobsQuery = (limit = 10) =>
  queryOptions({ queryKey: ['admin', 'import_jobs', limit], queryFn: () => listImportJobs(limit), staleTime: 30_000 })

/** Server-side authorisation check used to gate the /admin routes. */
export async function isAdmin(): Promise<boolean> {
  return unwrap(await supabase.rpc('is_admin')) === true
}
