import { queryOptions } from '@tanstack/react-query'
import { LOCAL_ADMIN_TOKEN_KEY, isLocalStack, supabase } from '@/lib/supabase'
import { VISION_API_URL } from '@/lib/site'
import type { TrademarkSearchResult } from '@/lib/database.types'
import { DataError, toDataError } from './_shared'

/* ---------------------------------------------------------------------------
 * Intelligent image search — browser half.
 *
 *   1. The picture goes to the TMistan vision service (services/vision, a
 *      small Python API) which recognises the words in it (Tesseract, Latin +
 *      Persian/Pashto/Arabic script), proposes conservative transliteration
 *      variants and computes a 512-d CLIP visual embedding. The service keeps
 *      nothing: the image lives in memory for the duration of the request.
 *   2. The visitor reviews / edits the recognised words.
 *   3. Words + variants + embedding (+ the 0500 descriptor computed in the
 *      browser, as a near-duplicate signal) are sent to the database function
 *      `search_trademarks_hybrid` (migration 1200), which ranks published
 *      trademarks by text similarity, visual similarity and both combined.
 *
 * Everything here degrades explicitly: when VISION_API_URL is not configured
 * or the service is unreachable the caller falls back to the 0500 descriptor
 * search and tells the user that only basic visual matching is available.
 * ------------------------------------------------------------------------- */

export const visionConfigured = VISION_API_URL.length > 0

export type VisionWord = { text: string; normalized: string; confidence: number; script: string; lang: string }
export type VisionVariant = { text: string; from: string; kind: string; script: string }
export type VisionAnalysis = {
  image: { width: number; height: number; format: string; blank: boolean; content_box: number[] | null }
  ocr: {
    text: string
    confidence: number
    scripts: string[]
    uncertain: boolean
    words: VisionWord[]
    passes: number
    duration_ms: number
    engine: string
    error: string | null
  } | null
  variants: VisionVariant[]
  embedding: number[] | null
  models: { ocr: string | null; embedding: string | null }
  warnings: string[]
  timings_ms: { ocr?: number; embedding?: number; total: number }
}

export type VisionHealth = {
  ok: boolean
  service: string
  version: string
  ocr: { available: boolean; tesseract: string; languages: string[]; engine: string }
  embedding: { available: boolean; model: string; dims: number; error: string | null }
  limits: { max_upload_bytes: number; rate_limit_per_minute: number }
}

export type VisionErrorCode = 'not_configured' | 'unreachable' | 'empty' | 'too_large' | 'unsupported' | 'corrupt' | 'too_small' | 'rate_limited' | 'timeout' | 'unauthorized' | 'forbidden' | 'busy' | 'migration_missing' | 'error'

export class VisionError extends Error {
  code: VisionErrorCode
  status: number
  constructor(code: VisionErrorCode, message: string, status = 0) {
    super(message)
    this.name = 'VisionError'
    this.code = code
    this.status = status
  }
}

function apiUrl(path: string) {
  return `${VISION_API_URL.replace(/\/+$/, '')}${path}`
}

async function readError(res: Response): Promise<VisionError> {
  let code: VisionErrorCode = 'error'
  let message = `HTTP ${res.status}`
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } }
    const c = body.error?.code
    if (c) code = c as VisionErrorCode
    if (body.error?.message) message = body.error.message
  } catch {
    /* non-JSON body */
  }
  if (res.status === 401) code = 'unauthorized'
  else if (res.status === 403) code = 'forbidden'
  else if (res.status === 409) code = 'busy'
  else if (res.status === 413) code = 'too_large'
  else if (res.status === 429) code = 'rate_limited'
  else if (res.status === 503 && /migration/i.test(message)) code = 'migration_missing'
  else if (res.status === 504) code = 'timeout'
  return new VisionError(code, message, res.status)
}

async function request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  if (!visionConfigured) throw new VisionError('not_configured', 'The image analysis service is not configured (VISION_API_URL).')
  const ctl = new AbortController()
  const outer = init.signal
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  const onAbort = () => ctl.abort()
  outer?.addEventListener('abort', onAbort)
  try {
    return await fetch(apiUrl(path), { ...init, signal: ctl.signal })
  } catch (e) {
    if (outer?.aborted) throw e
    if (ctl.signal.aborted) throw new VisionError('timeout', 'The image analysis service did not answer in time.')
    throw new VisionError('unreachable', e instanceof Error ? e.message : 'The image analysis service could not be reached.')
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onAbort)
  }
}

/** GET /health — whether OCR and the visual model are really loaded (never assumed). */
export async function getVisionHealth(): Promise<VisionHealth> {
  const res = await request('/health', { method: 'GET' }, 8_000)
  if (!res.ok) throw await readError(res)
  return (await res.json()) as VisionHealth
}

export const visionHealthQuery = () =>
  queryOptions({
    queryKey: ['vision', 'health', VISION_API_URL],
    queryFn: getVisionHealth,
    enabled: visionConfigured,
    staleTime: 5 * 60_000,
    retry: 1,
  })

/** POST /analyze — OCR words, transliteration variants and the visual embedding of one image. */
export async function analyzeImage(file: Blob, opts: { signal?: AbortSignal; ocr?: boolean; embedding?: boolean } = {}): Promise<VisionAnalysis> {
  const fd = new FormData()
  fd.append('image', file, file instanceof File ? file.name : 'image')
  const q = new URLSearchParams()
  if (opts.ocr === false) q.set('ocr_enabled', 'false')
  if (opts.embedding === false) q.set('embedding_enabled', 'false')
  const res = await request(`/analyze${q.size ? `?${q}` : ''}`, { method: 'POST', body: fd, signal: opts.signal }, 60_000)
  if (!res.ok) throw await readError(res)
  return (await res.json()) as VisionAnalysis
}

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
  /** 'ready' | 'empty' (nothing indexed yet) | 'not_installed' (migration 1200 missing) */
  state: 'ready' | 'empty' | 'not_installed'
  model_version: string | null
  visual_available: boolean
  text_available: boolean
  indexed_images: number
  images_with_text: number
  indexed_trademarks: number
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
  return err.code === 'PGRST202' || /schema cache/i.test(err.message)
}

export async function getHybridStatus(): Promise<HybridStatus> {
  const res = await rpc('hybrid_image_search_status', { p_model: null })
  if (res.error) {
    if (isMissingFunction(res.error)) {
      return { state: 'not_installed', model_version: null, visual_available: false, text_available: false, indexed_images: 0, images_with_text: 0, indexed_trademarks: 0 }
    }
    throw toDataError(res.error)
  }
  const d = (res.data ?? {}) as Partial<HybridStatus>
  const indexed = Number(d.indexed_images ?? 0)
  return {
    state: indexed > 0 ? 'ready' : 'empty',
    model_version: d.model_version ?? null,
    visual_available: !!d.visual_available,
    text_available: !!d.text_available,
    indexed_images: indexed,
    images_with_text: Number(d.images_with_text ?? 0),
    indexed_trademarks: Number(d.indexed_trademarks ?? 0),
  }
}

export const hybridStatusQuery = () =>
  queryOptions({
    queryKey: ['image-search', 'hybrid-status'],
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
  constructor() {
    super('Migration 1200 (intelligent image search) has not been applied to this database.', 'unavailable')
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
    p_model: p.modelVersion ?? null,
  })
  if (res.error) {
    if (isMissingFunction(res.error)) throw new MigrationMissingError()
    throw toDataError(res.error)
  }
  return ((res.data ?? []) as HybridResult[]).map((r) => ({ ...r, match_types: r.match_types ?? [], reasons: r.reasons ?? {} }))
}

/* ------------------------------ admin (index) ------------------------------ */

export type AnalysisIndexStatus = {
  model_version: string
  matched_images: number
  indexed: number
  with_text: number
  failed: number
  pending: number
  other_versions: number
  last_indexed_at: string | null
  failures: { image_id: string; storage_path: string; serial_number: string | null; error: string | null; attempts: number; at: string }[]
}

export type AnalysisRunReport = {
  model_version: string
  requested: number
  attempted: number
  indexed: number
  failed: number
  ocr_with_text: number
  failures: { image_id: string; reason: string }[]
  duration_ms: number
}

async function adminHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const local = isLocalStack && typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(LOCAL_ADMIN_TOKEN_KEY) : null
  const token = data.session?.access_token ?? local
  if (!token) throw new VisionError('unauthorized', 'Please sign in as an administrator first.', 401)
  return { Authorization: `Bearer ${token}` }
}

/** Index status as the vision service sees it (it calls admin_image_analysis_status with the admin's token). */
export async function getAnalysisIndexStatus(): Promise<AnalysisIndexStatus> {
  const res = await request('/admin/index/status', { method: 'GET', headers: await adminHeaders() }, 20_000)
  if (!res.ok) throw await readError(res)
  return (await res.json()) as AnalysisIndexStatus
}

/** Ask the service to analyse the next `limit` un-indexed (or failed) images. Resumable, idempotent. */
export async function runAnalysisIndexBatch(limit: number, retryFailed: boolean): Promise<AnalysisRunReport> {
  const res = await request(
    '/admin/index/run',
    { method: 'POST', headers: { ...(await adminHeaders()), 'Content-Type': 'application/json' }, body: JSON.stringify({ limit, retry_failed: retryFailed }) },
    15 * 60_000,
  )
  if (!res.ok) throw await readError(res)
  return (await res.json()) as AnalysisRunReport
}
