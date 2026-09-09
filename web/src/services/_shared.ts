import type { PostgrestError } from '@supabase/supabase-js'

/**
 * Error thrown by every service function. Pages surface `message` in the
 * error state; `code` lets callers distinguish "not configured", "schema
 * missing" (migrations not applied) and ordinary failures.
 */
export class DataError extends Error {
  readonly code: string
  constructor(message: string, code = 'unknown') {
    super(message)
    this.name = 'DataError'
    this.code = code
  }
}

/** Translate a PostgREST error into a DataError with a helpful message. */
export function toDataError(err: PostgrestError | { message: string; code?: string } | null | undefined): DataError {
  const code = (err as PostgrestError | undefined)?.code ?? 'unknown'
  const message = err?.message ?? 'Unknown error'
  // PGRST202/205 = function/table not in schema cache → migrations not applied
  if (code === 'PGRST202' || code === 'PGRST205' || /schema cache/i.test(message)) {
    return new DataError(`Database schema is incomplete (${message}). Apply supabase/migrations to the project.`, 'schema_missing')
  }
  if (code === 'PGRST301' || /JWT|apikey|API key/i.test(message)) {
    return new DataError(`Supabase rejected the request (${message}). Check SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY.`, 'auth')
  }
  return new DataError(message, code)
}

/** Unwrap `{ data, error }` from supabase-js; throws DataError, never returns null. */
export function unwrap<T>(res: { data: T | null; error: PostgrestError | null }): T {
  if (res.error) throw toDataError(res.error)
  if (res.data === null || res.data === undefined) throw new DataError('Empty response from database', 'empty')
  return res.data
}

/** Same as `unwrap` but `null` data is a legitimate "not found". */
export function unwrapNullable<T>(res: { data: T | null; error: PostgrestError | null }): T | null {
  if (res.error) throw toDataError(res.error)
  return res.data ?? null
}
