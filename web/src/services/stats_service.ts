import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { FilterOptions, RegistryStats } from '@/lib/database.types'
import { unwrap } from './_shared'

/* ---------------------------------------------------------------------------
 * Statistics service — dashboard/home numbers, all aggregated in SQL:
 *   registry_stats()          totals (trademarks, applicants, gazettes, images, needs_review…)
 *   trademarks_by_class()     distribution across Nice classes
 *   trademark_filter_options() distinct classes / gazettes / application types with counts
 *   gazette_summaries (view)  records per gazette (see gazette_service)
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
