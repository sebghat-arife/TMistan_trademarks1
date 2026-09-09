import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { GazetteSummaryRow } from '@/lib/database.types'
import { unwrap, unwrapNullable } from './_shared'

/* ---------------------------------------------------------------------------
 * Gazette service — reads the `gazette_summaries` view (one row per gazette
 * with trademark/image counts and publication-date range, computed in SQL).
 * ------------------------------------------------------------------------- */

export async function listGazettes(): Promise<GazetteSummaryRow[]> {
  return unwrap(
    await supabase
      .from('gazette_summaries')
      .select('*')
      .order('sort_key', { ascending: false, nullsFirst: false })
      .order('gazette_number', { ascending: false }),
  ) as GazetteSummaryRow[]
}

export const gazettesQuery = () =>
  queryOptions({ queryKey: ['gazettes', 'list'], queryFn: listGazettes, staleTime: 60_000 })

export async function getGazette(gazetteNumber: string): Promise<GazetteSummaryRow | null> {
  return unwrapNullable(await supabase.from('gazette_summaries').select('*').eq('gazette_number', gazetteNumber).maybeSingle()) as GazetteSummaryRow | null
}

export const gazetteQuery = (gazetteNumber: string) =>
  queryOptions({ queryKey: ['gazettes', 'detail', gazetteNumber], queryFn: () => getGazette(gazetteNumber) })
