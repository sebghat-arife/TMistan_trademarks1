/* ---------------------------------------------------------------------------
 * Build-time data for the prerenderer (scripts/prerender.mjs).
 *
 * Reads the SAME public rows the browser reads — through the PostgREST API
 * with the publishable key, so Row Level Security and the column-level grants
 * of migration 0600 apply exactly as they do for a visitor. Nothing here can
 * see attorney/review fields or unpublished records, and nothing is written.
 *
 * The rows seed the TanStack Query cache before a page is rendered, so the
 * prerendered HTML of a trademark record contains the record itself (and the
 * home page its live statistics) instead of a loading state.
 * ------------------------------------------------------------------------- */
import type { QueryClient } from '@tanstack/react-query'
import { TRADEMARK_IMAGE_PUBLIC_COLUMNS, TRADEMARK_PUBLIC_COLUMNS } from '@/lib/database.types'
import type { FilterOptions, RegistryStats, TrademarkImagePublicRow, TrademarkPublicRow } from '@/lib/database.types'
import { filterOptionsQuery, registryStatsQuery, trademarkBySerialQuery, type TrademarkDetail } from '@/services'

export type PrerenderDataset = {
  trademarks: TrademarkPublicRow[]
  imagesByTrademark: Map<string, TrademarkImagePublicRow[]>
  stats: RegistryStats | null
  filterOptions: FilterOptions | null
}

type RestEnv = { url: string; key: string }

const PAGE = 1000
const COLUMNS_ADDED_BY_0600 = ['registration_number', 'application_number']

async function rest<T>(env: RestEnv, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${env.url.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`PostgREST ${res.status} for ${path}: ${body.slice(0, 300)}`)
  }
  return (await res.json()) as T
}

async function pageThrough<T>(env: RestEnv, buildPath: (offset: number) => string): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; ; offset += PAGE) {
    const chunk = await rest<T[]>(env, buildPath(offset))
    out.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return out
}

/** Same compatibility rule as services/trademark_service.ts: 0600 fields are null until the migration exists. */
function withCompatColumns<T extends Partial<TrademarkPublicRow>>(row: T): T {
  return { registration_number: null, application_number: null, ...row }
}

async function loadTrademarks(env: RestEnv): Promise<TrademarkPublicRow[]> {
  const full = TRADEMARK_PUBLIC_COLUMNS.join(',')
  const legacy = TRADEMARK_PUBLIC_COLUMNS.filter((c) => !COLUMNS_ADDED_BY_0600.includes(c)).join(',')
  const path = (select: string) => (offset: number) =>
    `trademarks?select=${select}&is_published=eq.true&order=id&limit=${PAGE}&offset=${offset}`
  try {
    return (await pageThrough<TrademarkPublicRow>(env, path(full))).map(withCompatColumns)
  } catch (err) {
    const msg = String((err as Error).message ?? err)
    if (!/42703|does not exist/.test(msg)) throw err
    return (await pageThrough<TrademarkPublicRow>(env, path(legacy))).map(withCompatColumns)
  }
}

async function loadImages(env: RestEnv): Promise<Map<string, TrademarkImagePublicRow[]>> {
  const select = TRADEMARK_IMAGE_PUBLIC_COLUMNS.join(',')
  const rows = await pageThrough<TrademarkImagePublicRow>(
    env,
    (offset) => `trademark_images?select=${select}&status=eq.matched&trademark_id=not.is.null&order=trademark_id,sort_order,created_at&limit=${PAGE}&offset=${offset}`,
  )
  const map = new Map<string, TrademarkImagePublicRow[]>()
  for (const r of rows) {
    if (!r.trademark_id) continue
    const list = map.get(r.trademark_id)
    if (list) list.push(r)
    else map.set(r.trademark_id, [r])
  }
  return map
}

async function rpc<T>(env: RestEnv, fn: string): Promise<T | null> {
  try {
    return await rest<T>(env, `rpc/${fn}`, { method: 'POST', body: '{}' })
  } catch (err) {
    console.warn(`[prerender] ${fn}() unavailable: ${String((err as Error).message ?? err).slice(0, 160)}`)
    return null
  }
}

export async function loadPrerenderDataset(env: RestEnv): Promise<PrerenderDataset> {
  const [trademarks, imagesByTrademark, stats, filterOptions] = await Promise.all([
    loadTrademarks(env),
    loadImages(env),
    rpc<RegistryStats>(env, 'registry_stats'),
    rpc<FilterOptions>(env, 'trademark_filter_options'),
  ])
  return { trademarks, imagesByTrademark, stats, filterOptions }
}

/** Seed the home page queries (statistics + notice-type counts). */
export function seedHome(qc: QueryClient, ds: PrerenderDataset) {
  if (ds.stats) qc.setQueryData(registryStatsQuery().queryKey, ds.stats)
  if (ds.filterOptions) qc.setQueryData(filterOptionsQuery().queryKey, ds.filterOptions)
}

/** Seed one record page exactly as `getTrademarkBySerial(serial)` would resolve it. */
export function seedRecord(qc: QueryClient, ds: PrerenderDataset, tm: TrademarkPublicRow) {
  const detail: TrademarkDetail = { trademark: tm, images: ds.imagesByTrademark.get(tm.id) ?? [] }
  qc.setQueryData<TrademarkDetail | null>(trademarkBySerialQuery(tm.serial_number, null).queryKey, detail)
}
