import { queryOptions } from '@tanstack/react-query'
import { supabase } from './supabase'
import type {
  FilterOptions,
  GazetteSummaryRow,
  ImportJobRow,
  RegistryStats,
  SearchTrademarksArgs,
  TrademarkImageRow,
  TrademarkRow,
  TrademarkSearchResult,
} from './database.types'

/* All data access lives here. Every function is a thin, typed wrapper over
 * Supabase — no client-side filtering of the whole dataset, ever. */

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  if (res.data === null) throw new Error('Empty response')
  return res.data
}

export const registryStatsQuery = () =>
  queryOptions({
    queryKey: ['registry_stats'],
    queryFn: async () => unwrap(await supabase.rpc('registry_stats')) as RegistryStats,
    staleTime: 60_000,
  })

export const filterOptionsQuery = () =>
  queryOptions({
    queryKey: ['filter_options'],
    queryFn: async () => unwrap(await supabase.rpc('trademark_filter_options')) as FilterOptions,
    staleTime: 5 * 60_000,
  })

export const searchQuery = (args: SearchTrademarksArgs) =>
  queryOptions({
    queryKey: ['search', args],
    queryFn: async () => (unwrap(await supabase.rpc('search_trademarks', args)) ?? []) as TrademarkSearchResult[],
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  })

export const gazettesQuery = () =>
  queryOptions({
    queryKey: ['gazettes'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('gazette_summaries')
          .select('*')
          .order('sort_key', { ascending: false, nullsFirst: false })
          .order('gazette_number', { ascending: false }),
      ) as GazetteSummaryRow[],
    staleTime: 60_000,
  })

export const gazetteQuery = (gazetteNumber: string) =>
  queryOptions({
    queryKey: ['gazette', gazetteNumber],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gazette_summaries')
        .select('*')
        .eq('gazette_number', gazetteNumber)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data ?? null) as GazetteSummaryRow | null
    },
  })

export interface TrademarkDetail {
  trademark: TrademarkRow
  images: TrademarkImageRow[]
}

/** Public URLs are /trademark/:serial; serials are unique per gazette, so an
 *  optional ?g=<gazette> disambiguates if a serial ever repeats across gazettes. */
export const trademarkBySerialQuery = (serial: string, gazette?: string | null) =>
  queryOptions({
    queryKey: ['trademark', serial, gazette ?? null],
    queryFn: async (): Promise<TrademarkDetail | null> => {
      let q = supabase.from('trademarks').select('*').eq('serial_number', serial)
      if (gazette) q = q.eq('official_gazette_number', gazette)
      const { data, error } = await q.order('publication_date', { ascending: false, nullsFirst: false }).limit(1)
      if (error) throw new Error(error.message)
      const trademark = data?.[0] as TrademarkRow | undefined
      if (!trademark) return null

      const imgRes = await supabase
        .from('trademark_images')
        .select('*')
        .eq('trademark_id', trademark.id)
        .eq('status', 'matched')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
      if (imgRes.error) throw new Error(imgRes.error.message)
      return { trademark, images: (imgRes.data ?? []) as TrademarkImageRow[] }
    },
  })

export const similarTrademarksQuery = (id: string) =>
  queryOptions({
    queryKey: ['similar', id],
    queryFn: async () =>
      (unwrap(await supabase.rpc('similar_trademarks', { p_id: id, p_limit: 8 })) ?? []) as TrademarkSearchResult[],
    staleTime: 5 * 60_000,
  })

export const recentTrademarksQuery = (limit = 8) =>
  queryOptions({
    queryKey: ['recent', limit],
    queryFn: async () => (unwrap(await supabase.rpc('recent_trademarks', { p_limit: limit })) ?? []) as TrademarkSearchResult[],
    staleTime: 60_000,
  })

export const trademarksByClassQuery = () =>
  queryOptions({
    queryKey: ['by_class'],
    queryFn: async () => (unwrap(await supabase.rpc('trademarks_by_class')) ?? []) as { class: number; count: number }[],
    staleTime: 5 * 60_000,
  })

/** Admin only — RLS returns an empty list for anyone else. */
export const importJobsQuery = (limit = 10) =>
  queryOptions({
    queryKey: ['import_jobs', limit],
    queryFn: async () => {
      const { data, error } = await supabase.from('import_jobs').select('*').order('created_at', { ascending: false }).limit(limit)
      if (error) throw new Error(error.message)
      return (data ?? []) as ImportJobRow[]
    },
    staleTime: 30_000,
  })
