import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { SearchTrademarksArgs, TrademarkImageRow, TrademarkRow, TrademarkSearchResult } from '@/lib/database.types'
import { unwrap, unwrapNullable } from './_shared'
import { listTrademarkImages } from './image_service'

/* ---------------------------------------------------------------------------
 * Trademark service — every read of public.trademarks goes through here.
 *
 * Search / list / filter / sort / paginate are executed by the database
 * function `search_trademarks` (supabase/migrations/…0200_search.sql):
 * full-text + trigram matching on normalised columns, combinable filters,
 * LIMIT/OFFSET paging and a window `total_count`. Nothing is filtered in the
 * browser and the full table is never downloaded.
 * ------------------------------------------------------------------------- */

export interface TrademarkPage {
  items: TrademarkSearchResult[]
  total: number
}

/** Search + list + filter + sort + paginate (single database round-trip). */
export async function searchTrademarks(args: SearchTrademarksArgs): Promise<TrademarkPage> {
  const rows = (unwrap(await supabase.rpc('search_trademarks', args)) ?? []) as TrademarkSearchResult[]
  return { items: rows, total: rows[0]?.total_count ?? 0 }
}

export const searchTrademarksQuery = (args: SearchTrademarksArgs) =>
  queryOptions({
    queryKey: ['trademarks', 'search', args],
    queryFn: () => searchTrademarks(args),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  })

/** Convenience wrappers over the same RPC (kept for callers that need a single filter). */
export const listTrademarks = (limit = 20, offset = 0, sort: SearchTrademarksArgs['p_sort'] = 'newest') =>
  searchTrademarks({ p_sort: sort, p_limit: limit, p_offset: offset })
export const findBySerialNumber = (serial: string, limit = 20) => searchTrademarks({ p_serial: serial, p_sort: 'serial', p_limit: limit })
export const findByMarkName = (mark: string, limit = 20) => searchTrademarks({ p_mark: mark, p_sort: 'relevance', p_limit: limit })
export const filterByClass = (classes: number[], limit = 20, offset = 0) => searchTrademarks({ p_classes: classes, p_sort: 'newest', p_limit: limit, p_offset: offset })
export const filterByGazette = (gazette: string, limit = 20, offset = 0) => searchTrademarks({ p_gazette: gazette, p_sort: 'serial', p_limit: limit, p_offset: offset })
export const filterByApplicant = (applicant: string, limit = 20, offset = 0) => searchTrademarks({ p_applicant: applicant, p_sort: 'newest', p_limit: limit, p_offset: offset })

export interface TrademarkDetail {
  trademark: TrademarkRow
  images: TrademarkImageRow[]
}

/**
 * One trademark by its public identifier. Serial numbers are unique *within*
 * a gazette (`unique (official_gazette_number, serial_number)`), so an
 * optional gazette disambiguates if a serial ever repeats across gazettes.
 * Returns `null` when nothing matches (the page renders a not-found state).
 */
export async function getTrademarkBySerial(serial: string, gazette?: string | null): Promise<TrademarkDetail | null> {
  let q = supabase.from('trademarks').select('*').eq('serial_number', serial)
  if (gazette) q = q.eq('official_gazette_number', gazette)
  const rows = unwrap(await q.order('publication_date', { ascending: false, nullsFirst: false }).limit(1)) as TrademarkRow[]
  const trademark = rows[0]
  if (!trademark) return null
  const images = await listTrademarkImages(trademark.id)
  return { trademark, images }
}

export const trademarkBySerialQuery = (serial: string, gazette?: string | null) =>
  queryOptions({
    queryKey: ['trademarks', 'detail', serial, gazette ?? null],
    queryFn: () => getTrademarkBySerial(serial, gazette),
  })

export async function getTrademarkById(id: string): Promise<TrademarkRow | null> {
  return unwrapNullable(await supabase.from('trademarks').select('*').eq('id', id).maybeSingle()) as TrademarkRow | null
}

/** Text-similar marks (pg_trgm on the normalised mark name). */
export async function similarTrademarks(id: string, limit = 8): Promise<TrademarkSearchResult[]> {
  return (unwrap(await supabase.rpc('similar_trademarks', { p_id: id, p_limit: limit })) ?? []) as TrademarkSearchResult[]
}

export const similarTrademarksQuery = (id: string) =>
  queryOptions({
    queryKey: ['trademarks', 'similar', id],
    queryFn: () => similarTrademarks(id),
    staleTime: 5 * 60_000,
  })

/** Newest records (home page "Recently Added"). */
export async function recentTrademarks(limit = 8): Promise<TrademarkSearchResult[]> {
  return (unwrap(await supabase.rpc('recent_trademarks', { p_limit: limit })) ?? []) as TrademarkSearchResult[]
}

export const recentTrademarksQuery = (limit = 8) =>
  queryOptions({
    queryKey: ['trademarks', 'recent', limit],
    queryFn: () => recentTrademarks(limit),
    staleTime: 60_000,
  })
