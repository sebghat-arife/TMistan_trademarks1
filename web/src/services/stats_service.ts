import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { FilterOptions, RegistryStats } from '@/lib/database.types'
import { unwrap } from './_shared'

/* ---------------------------------------------------------------------------
 * Statistics service — dashboard/home numbers, all aggregated in SQL:
 *   registry_stats()          totals (trademarks, applicants, gazettes, images, needs_review…)
 *   trademarks_by_class()     distribution across Nice classes
 *   trademark_filter_options() distinct classes / gazettes / application types with counts
 * ------------------------------------------------------------------------- */

export async function getRegistryStats(): Promise<RegistryStats> {
  return unwrap(await supabase.rpc('registry_stats')) as RegistryStats
}

export const registryStatsQuery = () =>
  queryOptions({ queryKey: ['stats', 'registry'], queryFn: getRegistryStats, staleTime: 60_000 })

export async function getTrademarksByClass(): Promise<{ class: number; count: number }[]> {
  return (unwrap(await supabase.rpc('trademarks_by_class')) ?? []) as { class: number; count: number }[]
}

export const trademarksByClassQuery = () =>
  queryOptions({ queryKey: ['stats', 'by_class'], queryFn: getTrademarksByClass, staleTime: 5 * 60_000 })

export async function getFilterOptions(): Promise<FilterOptions> {
  return unwrap(await supabase.rpc('trademark_filter_options')) as FilterOptions
}

export const filterOptionsQuery = () =>
  queryOptions({ queryKey: ['stats', 'filter_options'], queryFn: getFilterOptions, staleTime: 5 * 60_000 })

/* ---------------------------------------------------------------------------
 * Record-type totals for the home page.
 *
 * The gazette publishes several kinds of notice and the importer stores the
 * notice type verbatim in `trademarks.application_type` ("New trademark
 * application", "Trademark renewal", "Assignment / transfer", "Owner name
 * change", …). `trademark_filter_options()` already returns every distinct
 * value with its published-row count, so the totals below are derived from
 * that real aggregate with keyword rules — nothing is hard-coded and no
 * additional RPC or schema change is needed. A combined notice such as
 * "Assignment / transfer and owner name change" counts in every category it
 * matches, so the categories are not a partition of the total.
 * ------------------------------------------------------------------------- */

export type RecordTypeStats = {
  /** "New trademark application" notices. */
  registrations: number
  /** Trademark renewal notices. */
  renewals: number
  /** Assignment / ownership-transfer notices. */
  assignments: number
  /** Owner-name, ownership and address change notices. */
  changes: number
}

const RECORD_TYPE_RULES: Record<keyof RecordTypeStats, (type: string) => boolean> = {
  registrations: (v) => /new trademark application/i.test(v),
  renewals: (v) => /trademark renewal/i.test(v),
  assignments: (v) => /assignment|transfer/i.test(v),
  changes: (v) => /change/i.test(v) && /owner|name|address/i.test(v),
}

export function deriveRecordTypeStats(types: FilterOptions['application_types'] | undefined): RecordTypeStats {
  const out: RecordTypeStats = { registrations: 0, renewals: 0, assignments: 0, changes: 0 }
  for (const { value, count } of types ?? []) {
    for (const key of Object.keys(RECORD_TYPE_RULES) as (keyof RecordTypeStats)[]) {
      if (RECORD_TYPE_RULES[key](value)) out[key] += count
    }
  }
  return out
}
