import { queryOptions } from '@tanstack/react-query'
import { supabase, storagePublicUrl } from '@/lib/supabase'
import { TRADEMARK_IMAGE_PUBLIC_COLUMNS } from '@/lib/database.types'
import type { TrademarkImagePublicRow, TrademarkPublicRow, TrademarkSearchResult } from '@/lib/database.types'
import { DESCRIPTOR_VERSION, describeImage, toVector, type Descriptor } from '@/lib/imageSearch/descriptor'
import { DataError, toDataError, unwrap } from './_shared'
import { getTrademarksByIds } from './trademark_service'

/* ---------------------------------------------------------------------------
 * Search by Image — browser half.
 *
 * The visitor's image is decoded and reduced to a visual descriptor locally
 * (lib/imageSearch/descriptor.ts); only that vector is sent to the database
 * function `search_trademarks_by_image` (migration 0500), which compares it
 * with the descriptors of published trademark images (pgvector, cosine). The
 * uploaded picture itself never leaves the browser and nothing about the query
 * is stored.
 *
 * Administrators build the index from the Import Center: images are fetched
 * from public Storage, described with the same code, and stored through
 * `admin_upsert_image_features`. New uploads are indexed right after import.
 * ------------------------------------------------------------------------- */

/** Below this cosine similarity a candidate is not shown (calibrated on the published image set). */
export const IMAGE_SEARCH_MIN_SIMILARITY = 0.55
/** "Exact match" mode: identical or near-identical representations only (same descriptor, stricter cut-off). */
export const IMAGE_SEARCH_EXACT_MIN_SIMILARITY = 0.85
export const IMAGE_SEARCH_LIMIT = 24
/** Server-side maximum for p_limit (search_trademarks_by_image clamps to 50). */
export const IMAGE_SEARCH_MAX_LIMIT = 50

export type ImageSearchResult = TrademarkSearchResult & { similarity: number; matched_image_id: string }

export type ImageSearchStatus = {
  available: boolean
  /** 'ready' | 'empty' (index has no vectors yet) | 'not_installed' (migration 0500 missing) */
  state: 'ready' | 'empty' | 'not_installed'
  descriptor_version: number | null
  indexed_images: number
  indexed_trademarks: number
}

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)

function isMissingFunction(err: { message: string; code?: string }) {
  return err.code === 'PGRST202' || /schema cache/i.test(err.message)
}

async function callRpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const res = await rpc(fn, args)
  if (res.error) {
    if (res.error.code === '42501' || /Administrator role required/i.test(res.error.message)) {
      throw new DataError('Administrator role required for this operation.', 'forbidden')
    }
    throw toDataError(res.error)
  }
  return res.data as T
}

/* ------------------------------ public ---------------------------------- */

export async function getImageSearchStatus(): Promise<ImageSearchStatus> {
  const res = await rpc('image_search_status', { p_version: DESCRIPTOR_VERSION })
  if (res.error) {
    if (isMissingFunction(res.error)) {
      return { available: false, state: 'not_installed', descriptor_version: null, indexed_images: 0, indexed_trademarks: 0 }
    }
    throw toDataError(res.error)
  }
  const d = (res.data ?? {}) as { available?: boolean; descriptor_version?: number | null; indexed_images?: number; indexed_trademarks?: number }
  const indexed = Number(d.indexed_images ?? 0)
  return {
    available: !!d.available && indexed > 0,
    state: indexed > 0 ? 'ready' : 'empty',
    descriptor_version: d.descriptor_version ?? null,
    indexed_images: indexed,
    indexed_trademarks: Number(d.indexed_trademarks ?? 0),
  }
}

export const imageSearchStatusQuery = () =>
  queryOptions({
    queryKey: ['image-search', 'status', DESCRIPTOR_VERSION],
    queryFn: getImageSearchStatus,
    staleTime: 60_000,
  })

/** Run the similarity search for a descriptor already computed in the browser. */
export async function searchTrademarksByDescriptor(descriptor: Descriptor, limit = IMAGE_SEARCH_LIMIT, minSimilarity = IMAGE_SEARCH_MIN_SIMILARITY): Promise<ImageSearchResult[]> {
  const rows = await callRpc<ImageSearchResult[] | null>('search_trademarks_by_image', {
    p_embedding: toVector(descriptor),
    p_version: DESCRIPTOR_VERSION,
    p_limit: limit,
    p_min_similarity: minSimilarity,
  })
  return rows ?? []
}

/** Decode + describe a visitor's image file and search. The file itself is never uploaded. */
export async function searchTrademarksByImage(file: Blob): Promise<ImageSearchResult[]> {
  const descriptor = await describeImage(file)
  return searchTrademarksByDescriptor(descriptor)
}

/* ------------------------------ admin ----------------------------------- */

export type ImageIndexStatus = {
  descriptor_version: number
  matched_images: number
  indexed: number
  stale: number
  missing: number
  last_computed_at: string | null
}

export type ImageNeedingIndex = {
  id: string
  trademark_id: string
  storage_bucket: string
  storage_path: string
  serial_number: string | null
  content_type: string | null
  byte_size: number | null
}

export type IndexUpsertResult = {
  upserted: number
  failed: number
  results: { key: string; image_id?: string; status: 'indexed' | 'failed'; error?: string }[]
}

export async function getImageIndexStatus(): Promise<ImageIndexStatus> {
  return callRpc<ImageIndexStatus>('admin_image_index_status', { p_version: DESCRIPTOR_VERSION })
}

export async function listImagesNeedingIndex(limit = 200, offset = 0): Promise<ImageNeedingIndex[]> {
  return (await callRpc<ImageNeedingIndex[] | null>('admin_images_missing_features', { p_version: DESCRIPTOR_VERSION, p_limit: limit, p_offset: offset })) ?? []
}

export type FeatureItem = { image_id?: string; storage_path?: string; storage_bucket?: string; embedding: number[] }

export async function upsertImageFeatures(items: FeatureItem[]): Promise<IndexUpsertResult> {
  const total: IndexUpsertResult = { upserted: 0, failed: 0, results: [] }
  for (let i = 0; i < items.length; i += 200) {
    const r = await callRpc<IndexUpsertResult>('admin_upsert_image_features', { p_version: DESCRIPTOR_VERSION, p_items: items.slice(i, i + 200) })
    total.upserted += r.upserted
    total.failed += r.failed
    total.results.push(...(r.results ?? []))
  }
  return total
}

export type IndexFailure = { key: string; storage_path: string; reason: string }

export type IndexRunReport = {
  attempted: number
  indexed: number
  failed: number
  failures: IndexFailure[]
}

/**
 * Describe + store descriptors for images already in Storage (fetches each
 * public object, computes the descriptor in this browser, sends the vectors).
 * `onProgress(done, total)` lets the UI show a progress bar.
 */
export async function indexStoredImages(
  images: { id?: string; storage_bucket: string; storage_path: string }[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<IndexRunReport> {
  const report: IndexRunReport = { attempted: images.length, indexed: 0, failed: 0, failures: [] }
  let pending: FeatureItem[] = []
  let done = 0

  const flush = async () => {
    if (!pending.length) return
    const batch = pending
    pending = []
    try {
      const r = await upsertImageFeatures(batch)
      report.indexed += r.upserted
      for (const x of r.results) {
        if (x.status === 'failed') {
          report.failed += 1
          report.failures.push({ key: x.key, storage_path: x.key, reason: x.error ?? 'Database rejected the descriptor' })
        }
      }
    } catch (e) {
      report.failed += batch.length
      const reason = e instanceof Error ? e.message : String(e)
      for (const b of batch) report.failures.push({ key: b.image_id ?? b.storage_path ?? '?', storage_path: b.storage_path ?? '', reason })
    }
  }

  for (const img of images) {
    if (signal?.aborted) break
    try {
      const url = storagePublicUrl(img.storage_bucket, img.storage_path)
      if (!url) throw new Error('No public URL for this object')
      const res = await fetch(url, { cache: 'no-store', signal })
      if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`)
      const descriptor = await describeImage(await res.blob())
      pending.push({ ...(img.id ? { image_id: img.id } : { storage_path: img.storage_path, storage_bucket: img.storage_bucket }), embedding: toVector(descriptor) })
      if (pending.length >= 100) await flush()
    } catch (e) {
      if (signal?.aborted) break
      report.failed += 1
      report.failures.push({ key: img.id ?? img.storage_path, storage_path: img.storage_path, reason: e instanceof Error ? e.message : String(e) })
    } finally {
      done += 1
      onProgress?.(done, images.length)
    }
  }
  await flush()
  return report
}

/**
 * Describe images whose bytes are already in memory (right after an Import
 * Center upload) and store them by storage path — no re-download needed.
 */
export async function indexUploadedImages(
  items: { storage_path: string; blob: Blob }[],
  onProgress?: (done: number, total: number) => void,
): Promise<IndexRunReport> {
  const report: IndexRunReport = { attempted: items.length, indexed: 0, failed: 0, failures: [] }
  const features: FeatureItem[] = []
  let done = 0
  for (const it of items) {
    try {
      const descriptor = await describeImage(it.blob)
      features.push({ storage_path: it.storage_path, embedding: toVector(descriptor) })
    } catch (e) {
      report.failed += 1
      report.failures.push({ key: it.storage_path, storage_path: it.storage_path, reason: e instanceof Error ? e.message : String(e) })
    } finally {
      done += 1
      onProgress?.(done, items.length)
    }
  }
  if (features.length) {
    try {
      const r = await upsertImageFeatures(features)
      report.indexed += r.upserted
      for (const x of r.results) {
        if (x.status === 'failed') {
          report.failed += 1
          report.failures.push({ key: x.key, storage_path: x.key, reason: x.error ?? 'Database rejected the descriptor' })
        }
      }
    } catch (e) {
      report.failed += features.length
      const reason = e instanceof Error ? e.message : String(e)
      for (const f of features) report.failures.push({ key: f.storage_path ?? '?', storage_path: f.storage_path ?? '', reason })
    }
  }
  return report
}

/* ---------------------------------------------------------------------------
 * Example images for "Search by Image" — real, published trademark images from
 * this database (never stock logos), so the examples demonstrate the feature on
 * records that actually exist here.
 * ------------------------------------------------------------------------- */

export type ImageSearchExample = {
  image: TrademarkImagePublicRow
  trademark: Pick<TrademarkPublicRow, 'id' | 'serial_number' | 'mark_name' | 'official_gazette_number' | 'trademark_class' | 'class_numbers'>
  url: string
}

export async function listImageSearchExamples(limit = 6): Promise<ImageSearchExample[]> {
  // Newest matched images first; a trademark appears once even if it has several images.
  const rows = unwrap(
    await supabase
      .from('trademark_images')
      .select(TRADEMARK_IMAGE_PUBLIC_COLUMNS.join(','))
      .eq('status', 'matched')
      .not('trademark_id', 'is', null)
      .order('created_at', { ascending: false })
      .order('sort_order', { ascending: true })
      .limit(limit * 4),
  ) as unknown as TrademarkImagePublicRow[]
  const picked: TrademarkImagePublicRow[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (!r.trademark_id || seen.has(r.trademark_id)) continue
    seen.add(r.trademark_id)
    picked.push(r)
    if (picked.length >= limit) break
  }
  if (picked.length === 0) return []
  const marks = await getTrademarksByIds(picked.map((r) => r.trademark_id as string))
  const byId = new Map(marks.map((m) => [m.id, m]))
  const out: ImageSearchExample[] = []
  for (const image of picked) {
    const trademark = byId.get(image.trademark_id as string)
    const url = storagePublicUrl(image.storage_bucket, image.storage_path)
    if (!trademark || !url || !trademark.is_published) continue
    out.push({ image, trademark, url })
  }
  return out
}

export const imageSearchExamplesQuery = (limit = 6) =>
  queryOptions({ queryKey: ['image-search', 'examples', limit], queryFn: () => listImageSearchExamples(limit), staleTime: 5 * 60_000 })
