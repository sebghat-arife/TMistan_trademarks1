/**
 * Intelligent Search by Image — database side (migrations 1200 + 1300).
 *
 * Text recognition of the *query* image happens in the visitor's browser
 * (src/lib/imageSearch/analyze.ts); the *stored* images are analysed by the
 * Import Center indexer (browser, administrator session) or by the offline
 * tools/image_index CLI. Everything here is a thin wrapper over Postgres
 * functions called through the Supabase client with the publishable key:
 *
 *   public  hybrid_image_search_status / search_trademarks_hybrid
 *   admin   admin_image_analysis_status / admin_image_analysis_pending /
 *           admin_upsert_image_analysis   (authorised in the database)
 *
 * No HTTP service, no server-side inference, no secrets in the browser.
 */
import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { TrademarkSearchResult } from '@/lib/database.types'
import { OCR_MODEL_VERSION } from '@/lib/imageSearch/ocr'
import { DataError, toDataError } from './_shared'

export type { ImageAnalysis } from '@/lib/imageSearch/analyze'
export type { OcrWord } from '@/lib/imageSearch/ocr'
export type { Variant as AnalysisVariant } from '@/lib/imageSearch/textnorm'

/* ------------------------------ hybrid search (database) ------------------- */

export type HybridMatchType = 'text_exact' | 'text_fuzzy' | 'variant' | 'phonetic' | 'ocr_text' | 'near_duplicate' | 'visual_high' | 'visual'

export type HybridReasons = {
  text?: { term: string; field: 'mark_name' | 'mark_print' | 'ocr'; kind: 'exact' | 'substring' | 'fuzzy' | 'phonetic'; variant: boolean; matched: string; score: number }
  visual?: { similarity: number; image_id: string | null }
  duplicate?: { similarity: number }
  class_filter?: boolean
}

export type HybridResult = TrademarkSearchResult & {
  text_score: number
  visual_score: number
  visual_raw: number
  duplicate_score: number
  combined_score: number
  match_types: HybridMatchType[]
  reasons: HybridReasons
  matched_image_id: string | null
  matched_text: string | null
}

export type HybridStatus = {
  /** 'ready' (text index has rows) | 'empty' (installed, nothing analysed yet) | 'not_installed' (migration 1200 missing) */
  state: 'ready' | 'empty' | 'not_installed'
  model_version: string | null
  visual_available: boolean
  text_available: boolean
  /** Rows with recognised text or an embedding (status 'indexed'). */
  indexed_images: number
  images_with_text: number
  indexed_trademarks: number
  /** Since migration 1300: analysed images in which nothing readable was found. */
  images_skipped: number
  /** Since migration 1300: all matched (searchable) images, analysed or not. */
  matched_images: number | null
  /** Whether the 0500 descriptor index (basic mode) has rows. */
  descriptor_available: boolean
}

/** Ranking weights / thresholds sent with every query (documented in docs/IMAGE_SEARCH.md). */
export const HYBRID_DEFAULTS = {
  textWeight: 0.55,
  visualWeight: 0.45,
  minText: 0.42,
  minVisual: 0.72,
  limit: 24,
  maxLimit: 50,
} as const

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)

export function isMissingFunction(err: { message: string; code?: string }) {
  return err.code === 'PGRST202' || err.code === 'PGRST203' || /schema cache/i.test(err.message)
}

const NOT_INSTALLED: HybridStatus = {
  state: 'not_installed', model_version: null, visual_available: false, text_available: false,
  indexed_images: 0, images_with_text: 0, indexed_trademarks: 0, images_skipped: 0, matched_images: null, descriptor_available: false,
}

export async function getHybridStatus(): Promise<HybridStatus> {
  const res = await rpc('hybrid_image_search_status', { p_model: OCR_MODEL_VERSION })
  if (res.error) {
    if (isMissingFunction(res.error)) return NOT_INSTALLED
    throw toDataError(res.error)
  }
  const d = (res.data ?? {}) as Partial<Record<keyof HybridStatus, unknown>>
  const indexed = Number(d.indexed_images ?? 0)
  return {
    state: indexed > 0 ? 'ready' : 'empty',
    model_version: typeof d.model_version === 'string' ? d.model_version : null,
    visual_available: !!d.visual_available,
    text_available: !!d.text_available,
    indexed_images: indexed,
    images_with_text: Number(d.images_with_text ?? 0),
    indexed_trademarks: Number(d.indexed_trademarks ?? 0),
    images_skipped: Number(d.images_skipped ?? 0),
    matched_images: d.matched_images == null ? null : Number(d.matched_images),
    descriptor_available: !!d.descriptor_available,
  }
}

export const hybridStatusQuery = () =>
  queryOptions({
    queryKey: ['image-search', 'hybrid-status', OCR_MODEL_VERSION],
    queryFn: getHybridStatus,
    staleTime: 60_000,
  })

export type HybridSearchParams = {
  embedding?: number[] | null
  modelVersion?: string | null
  terms?: string[]
  variants?: string[]
  descriptor?: number[] | null
  descriptorVersion?: number | null
  classes?: number[]
  gazette?: string
  applicationType?: string
  limit?: number
  minText?: number
  minVisual?: number
  textWeight?: number
  visualWeight?: number
}

export class MigrationMissingError extends DataError {
  constructor(which = '1200 (intelligent image search)') {
    super(`Migration ${which} has not been applied to this database.`, 'unavailable')
    this.name = 'MigrationMissingError'
  }
}

/** Ranked candidates from `search_trademarks_hybrid` (one row per published trademark). */
export async function searchTrademarksHybrid(p: HybridSearchParams): Promise<HybridResult[]> {
  const terms = (p.terms ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 12)
  const variants = (p.variants ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 30)
  const res = await rpc('search_trademarks_hybrid', {
    p_embedding: p.embedding ?? null,
    p_terms: terms.length ? terms : null,
    p_variants: variants.length ? variants : null,
    p_descriptor: p.descriptor ?? null,
    p_descriptor_version: p.descriptor ? (p.descriptorVersion ?? null) : null,
    p_classes: p.classes?.length ? p.classes : null,
    p_gazette: p.gazette?.trim() || null,
    p_application_type: p.applicationType?.trim() || null,
    p_limit: Math.min(p.limit ?? HYBRID_DEFAULTS.limit, HYBRID_DEFAULTS.maxLimit),
    p_min_text: p.minText ?? HYBRID_DEFAULTS.minText,
    p_min_visual: p.minVisual ?? HYBRID_DEFAULTS.minVisual,
    p_text_weight: p.textWeight ?? HYBRID_DEFAULTS.textWeight,
    p_visual_weight: p.visualWeight ?? HYBRID_DEFAULTS.visualWeight,
    p_model: p.modelVersion ?? OCR_MODEL_VERSION,
  })
  if (res.error) {
    if (isMissingFunction(res.error)) throw new MigrationMissingError()
    throw toDataError(res.error)
  }
  return ((res.data ?? []) as HybridResult[]).map((r) => ({ ...r, match_types: r.match_types ?? [], reasons: r.reasons ?? {} }))
}

/* ------------------------------ admin (index) ------------------------------ */

export type AnalysisStatusRow = 'indexed' | 'failed' | 'skipped'

export type AnalysisIndexStatus = {
  model_version: string
  matched_images: number
  indexed: number
  with_text: number
  failed: number
  /** Since 1300: analysed, nothing readable found (not pending any more). */
  skipped: number
  pending: number
  other_versions: number
  last_indexed_at: string | null
  failures: { image_id: string; storage_path: string; serial_number: string | null; error: string | null; attempts: number; at: string }[]
  /** False when only migration 1200 is applied (no 'skipped' status, pending excludes nothing). */
  supportsSkipped: boolean
}

export type PendingImage = {
  id: string
  trademark_id: string
  storage_bucket: string
  storage_path: string
  serial_number: string | null
  content_type: string | null
  byte_size: number | null
}

export type AnalysisUpsertItem = {
  image_id: string
  status: AnalysisStatusRow
  ocr_text?: string | null
  ocr_confidence?: number | null
  ocr_words?: unknown[] | null
  ocr_scripts?: string[] | null
  warnings?: string[] | null
  error?: string | null
  duration_ms?: number | null
  engine?: string | null
}

export type AnalysisUpsertResult = {
  model_version: string
  indexed: number
  failed: number
  skipped: number
  results: { image_id: string; status: AnalysisStatusRow; error: string | null }[]
}

export async function getAnalysisIndexStatus(model = OCR_MODEL_VERSION): Promise<AnalysisIndexStatus> {
  const res = await rpc('admin_image_analysis_status', { p_model: model })
  if (res.error) {
    if (isMissingFunction(res.error)) throw new MigrationMissingError()
    throw toDataError(res.error)
  }
  const d = (res.data ?? {}) as Partial<AnalysisIndexStatus> & { skipped?: number }
  return {
    model_version: d.model_version ?? model,
    matched_images: Number(d.matched_images ?? 0),
    indexed: Number(d.indexed ?? 0),
    with_text: Number(d.with_text ?? 0),
    failed: Number(d.failed ?? 0),
    skipped: Number(d.skipped ?? 0),
    pending: Number(d.pending ?? 0),
    other_versions: Number(d.other_versions ?? 0),
    last_indexed_at: d.last_indexed_at ?? null,
    failures: d.failures ?? [],
    supportsSkipped: d.skipped !== undefined,
  }
}

export const analysisIndexStatusQuery = () =>
  queryOptions({ queryKey: ['image-analysis', 'admin-status', OCR_MODEL_VERSION], queryFn: () => getAnalysisIndexStatus(), staleTime: 15_000, retry: false })

/**
 * Next images to analyse for this model version. `retryFailed` includes failed
 * rows (< 5 attempts); `includeSkipped` re-queues images analysed without text
 * (migration 1300). Falls back to the 1200 signature when 1300 is not applied.
 */
export async function listPendingAnalysis(limit: number, opts: { retryFailed?: boolean; includeSkipped?: boolean } = {}, model = OCR_MODEL_VERSION): Promise<PendingImage[]> {
  const args: Record<string, unknown> = { p_model: model, p_limit: Math.min(Math.max(limit, 1), 500), p_retry_failed: !!opts.retryFailed }
  let res = await rpc('admin_image_analysis_pending', { ...args, p_include_skipped: !!opts.includeSkipped })
  if (res.error && isMissingFunction(res.error)) res = await rpc('admin_image_analysis_pending', args)
  if (res.error) {
    if (isMissingFunction(res.error)) throw new MigrationMissingError()
    throw toDataError(res.error)
  }
  return (res.data ?? []) as PendingImage[]
}

/** Store analysis results (≤ 200 per call). Idempotent per image: re-running updates the row. */
export async function upsertImageAnalysis(items: AnalysisUpsertItem[], model = OCR_MODEL_VERSION): Promise<AnalysisUpsertResult> {
  if (!items.length) return { model_version: model, indexed: 0, failed: 0, skipped: 0, results: [] }
  const res = await rpc('admin_upsert_image_analysis', { p_model: model, p_items: items.slice(0, 200) })
  if (res.error) {
    if (isMissingFunction(res.error)) throw new MigrationMissingError()
    throw toDataError(res.error)
  }
  const d = (res.data ?? {}) as Partial<AnalysisUpsertResult>
  return { model_version: d.model_version ?? model, indexed: Number(d.indexed ?? 0), failed: Number(d.failed ?? 0), skipped: Number(d.skipped ?? 0), results: d.results ?? [] }
}
