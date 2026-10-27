/**
 * Browser-side indexer for the text index of Search by Image (Import Center).
 *
 * For each matched image that has no analysis row for the current model
 * version: download it from public Storage, recognise its words with the same
 * pipeline the visitor's browser uses for queries, and store the result through
 * `admin_upsert_image_analysis` (administrator session; the database enforces
 * the admin check). Resumable (each run takes the next pending images),
 * idempotent (one row per image, re-runs update it), batched (≤ 200 rows per
 * call, flushed every FLUSH_EVERY images so a closed tab loses little work).
 * Trademark rows, image rows and Storage objects are never modified.
 */
import { storagePublicUrl } from '@/lib/supabase'
import { listPendingAnalysis, upsertImageAnalysis, type AnalysisUpsertItem, type PendingImage } from '@/services/image_analysis_service'
import { ImageDecodeError } from './descriptor'
import { OCR_ENGINE, OcrUnavailableError, recogniseImage, warmUpOcr } from './ocr'
import { loadImage } from './preprocess'

export type IndexProgress = {
  total: number
  done: number
  indexed: number
  skipped: number
  failed: number
  current: string | null
  elapsedMs: number
}

export type IndexFailure = { image_id: string; serial_number: string | null; storage_path: string; reason: string }

export type IndexRunReport = IndexProgress & {
  requested: number
  withText: number
  failures: IndexFailure[]
  /** True when the run was stopped by the administrator before the batch finished. */
  stopped: boolean
}

export type IndexRunOptions = {
  limit: number
  retryFailed?: boolean
  includeSkipped?: boolean
  /** OCR workers to use (defaults to a desktop-friendly 2). */
  concurrency?: number
  /** Per-image OCR time budget. */
  budgetMs?: number
  signal?: AbortSignal
  onProgress?: (p: IndexProgress) => void
}

const FLUSH_EVERY = 25
const DOWNLOAD_TIMEOUT_MS = 30_000

async function download(img: PendingImage, signal?: AbortSignal): Promise<Blob> {
  const url = storagePublicUrl(img.storage_bucket, img.storage_path)
  if (!url) throw new Error('No public URL for this object')
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), DOWNLOAD_TIMEOUT_MS)
  const onAbort = () => ctl.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctl.signal })
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`)
    return await res.blob()
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** Analyse one stored image into an upsert item (never throws for per-image problems). */
export async function analyseStoredImage(img: PendingImage, opts: { concurrency?: number; budgetMs?: number; signal?: AbortSignal }): Promise<AnalysisUpsertItem> {
  const t0 = performance.now()
  try {
    const blob = await download(img, opts.signal)
    const loaded = await loadImage(blob)
    const r = await recogniseImage(loaded, { concurrency: opts.concurrency, budgetMs: opts.budgetMs, signal: opts.signal })
    const duration_ms = Math.round(performance.now() - t0)
    const warnings: string[] = []
    if (loaded.blank) warnings.push('blank')
    if (!r.words.length && !loaded.blank) warnings.push('no_text')
    if (r.uncertain && r.words.length) warnings.push('uncertain')
    if (!r.words.length) {
      return { image_id: img.id, status: 'skipped', warnings, duration_ms, engine: OCR_ENGINE }
    }
    return {
      image_id: img.id,
      status: 'indexed',
      ocr_text: r.text,
      ocr_confidence: r.confidence,
      ocr_words: r.words,
      ocr_scripts: r.scripts,
      warnings,
      duration_ms,
      engine: OCR_ENGINE,
    }
  } catch (e) {
    if (e instanceof OcrUnavailableError) throw e
    const reason = e instanceof ImageDecodeError ? `Image could not be decoded: ${e.message}` : e instanceof Error ? e.message : String(e)
    return { image_id: img.id, status: 'failed', error: reason.slice(0, 500), duration_ms: Math.round(performance.now() - t0), engine: OCR_ENGINE }
  }
}

/**
 * Run one batch. Throws OcrUnavailableError (engine cannot start) or a DataError
 * from the pending/upsert calls (migration missing, not an administrator).
 */
export async function runIndexBatch(opts: IndexRunOptions): Promise<IndexRunReport> {
  const t0 = performance.now()
  await warmUpOcr()
  const pending = await listPendingAnalysis(opts.limit, { retryFailed: opts.retryFailed, includeSkipped: opts.includeSkipped })
  const bySerial = new Map(pending.map((p) => [p.id, p]))
  const progress: IndexProgress = { total: pending.length, done: 0, indexed: 0, skipped: 0, failed: 0, current: null, elapsedMs: 0 }
  const failures: IndexFailure[] = []
  let withText = 0
  let stopped = false
  let buffer: AnalysisUpsertItem[] = []

  const emit = () => {
    progress.elapsedMs = Math.round(performance.now() - t0)
    opts.onProgress?.({ ...progress })
  }
  const flush = async () => {
    if (!buffer.length) return
    const items = buffer
    buffer = []
    try {
      const res = await upsertImageAnalysis(items)
      for (const r of res.results) {
        const src = bySerial.get(r.image_id)
        if (r.status === 'failed') {
          progress.failed += 1
          failures.push({ image_id: r.image_id, serial_number: src?.serial_number ?? null, storage_path: src?.storage_path ?? '', reason: r.error ?? 'Database rejected the row' })
        } else if (r.status === 'skipped') progress.skipped += 1
        else {
          progress.indexed += 1
          if (items.find((i) => i.image_id === r.image_id)?.ocr_text) withText += 1
        }
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      for (const it of items) {
        const src = bySerial.get(it.image_id)
        progress.failed += 1
        failures.push({ image_id: it.image_id, serial_number: src?.serial_number ?? null, storage_path: src?.storage_path ?? '', reason })
      }
      throw e
    } finally {
      emit()
    }
  }

  emit()
  try {
    for (const img of pending) {
      if (opts.signal?.aborted) { stopped = true; break }
      progress.current = img.serial_number ?? img.storage_path
      emit()
      const item = await analyseStoredImage(img, { concurrency: opts.concurrency, budgetMs: opts.budgetMs, signal: opts.signal })
      if (opts.signal?.aborted && item.status === 'failed') { stopped = true; break } // aborted mid-download: do not record as failed
      buffer.push(item)
      progress.done += 1
      if (buffer.length >= FLUSH_EVERY) await flush()
      else emit()
    }
  } finally {
    progress.current = null
    await flush().catch(() => undefined)
  }
  return { ...progress, requested: opts.limit, withText, failures, stopped, elapsedMs: Math.round(performance.now() - t0) }
}
