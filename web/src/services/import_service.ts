import { supabase } from '@/lib/supabase'
import type { ImportJobItemRow, ImportJobRow } from '@/lib/database.types'
import type { ImportRow } from '@/lib/import/spreadsheet'
import type { ImageCandidate } from '@/lib/import/images'
import { storagePathFor } from '@/lib/import/serial'
import { DataError, toDataError, unwrap } from './_shared'

/* ---------------------------------------------------------------------------
 * Import service — the browser half of the Admin Import Center.
 *
 * Every privileged step is a SECURITY DEFINER function in the database
 * (migration 0400) that checks is_admin() itself; the browser only sends the
 * administrator's own session token. Storage uploads go straight to the
 * `trademark-images` bucket under the same session (RLS on storage.objects
 * allows admins only).
 * ------------------------------------------------------------------------- */

export const IMAGE_BUCKET = 'trademark-images'
const ROW_BATCH = 200
const RESOLVE_BATCH = 500
const REGISTER_BATCH = 200
const UPLOAD_CONCURRENCY = 4

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)

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

/* ------------------------------ jobs ------------------------------------ */

export async function createImportJob(jobType: 'excel' | 'images', filename: string, totalRows: number, summary: Record<string, unknown> = {}): Promise<ImportJobRow> {
  return callRpc<ImportJobRow>('admin_create_import_job', { p_job_type: jobType, p_filename: filename, p_total_rows: totalRows, p_summary: summary })
}

export async function finishImportJob(
  jobId: string,
  status: 'completed' | 'completed_with_warnings' | 'failed',
  summary: Record<string, unknown> = {},
  errorMessage: string | null = null,
  totalRows: number | null = null,
  failedRowsAdd = 0,
): Promise<ImportJobRow> {
  return callRpc<ImportJobRow>('admin_finish_import_job', {
    p_job_id: jobId,
    p_status: status,
    p_summary: summary,
    p_error_message: errorMessage,
    p_total_rows: totalRows,
    p_failed_rows_add: failedRowsAdd,
  })
}

/**
 * True when migration 0400 (admin import functions) is present. Uses the
 * cheapest admin RPC; a PGRST202 "function not found" means "not applied".
 */
export async function importCenterReady(): Promise<{ ready: boolean; reason: string | null }> {
  const res = await rpc('admin_assert')
  if (!res.error) return { ready: true, reason: null }
  if (res.error.code === 'PGRST202' || /schema cache/i.test(res.error.message)) {
    return { ready: false, reason: 'Migration 0400 (admin import) has not been applied to this Supabase project.' }
  }
  if (res.error.code === '42501' || /Administrator role required/i.test(res.error.message)) return { ready: false, reason: 'Administrator role required.' }
  return { ready: false, reason: res.error.message }
}

export type ImportItemStatus = 'inserted' | 'updated' | 'skipped' | 'duplicate' | 'unchanged' | 'unmatched' | 'ambiguous' | 'failed' | 'invalid'

export async function addImportItems(jobId: string, items: { item_ref: string; status: ImportItemStatus; message?: string | null; [k: string]: unknown }[]): Promise<number> {
  let n = 0
  for (let i = 0; i < items.length; i += 1000) {
    n += await callRpc<number>('admin_add_import_items', { p_job_id: jobId, p_items: items.slice(i, i + 1000) })
  }
  return n
}

export type { ImportJobItemRow }

/** Statuses that represent problems (since migration 0600 the item log also records inserted/updated rows for provenance). */
export const PROBLEM_ITEM_STATUSES: ImportJobItemRow['status'][] = ['failed', 'unmatched', 'ambiguous', 'skipped']

export async function listImportJobItems(jobId: string, limit = 1000, statuses: ImportJobItemRow['status'][] = PROBLEM_ITEM_STATUSES): Promise<ImportJobItemRow[]> {
  return unwrap(
    await supabase.from('import_job_items').select('*').eq('job_id', jobId).in('status', statuses).order('id', { ascending: true }).limit(limit),
  ) as ImportJobItemRow[]
}

/* --------------------------- trademark rows ----------------------------- */

export interface RowBatchResult {
  inserted: number
  updated: number
  skipped: number
  failed: number
  results: { serial: string | null; source_row: number | null; status: 'failed'; message: string; code: string }[]
}

export interface RowImportProgress {
  processed: number
  total: number
  inserted: number
  updated: number
  skipped: number
  failed: number
  failures: RowBatchResult['results']
}

/** Send validated rows in batches; `onProgress` fires after every batch. */
export async function importTrademarkRows(jobId: string, rows: ImportRow[], onProgress?: (p: RowImportProgress) => void, signal?: AbortSignal): Promise<RowImportProgress> {
  const p: RowImportProgress = { processed: 0, total: rows.length, inserted: 0, updated: 0, skipped: 0, failed: 0, failures: [] }
  for (let i = 0; i < rows.length; i += ROW_BATCH) {
    if (signal?.aborted) throw new DataError('Import cancelled', 'cancelled')
    const batch = rows.slice(i, i + ROW_BATCH)
    const r = await callRpc<RowBatchResult>('admin_import_trademark_rows', { p_job_id: jobId, p_rows: batch })
    p.processed += batch.length
    p.inserted += r.inserted
    p.updated += r.updated
    p.skipped += r.skipped
    p.failed += r.failed
    p.failures.push(...(r.results ?? []))
    onProgress?.({ ...p, failures: [...p.failures] })
  }
  return p
}

/* ------------------------------ images ---------------------------------- */

export interface SerialResolution {
  input: string
  trademark_id: string | null
  serial_number: string | null
  gazette_number: string | null
  mark_name: string | null
  method: 'serial_exact' | 'serial_normalized' | 'serial_numeric' | 'unmatched' | 'ambiguous'
  candidates: number
}

export async function resolveSerials(serials: string[]): Promise<Map<string, SerialResolution>> {
  const out = new Map<string, SerialResolution>()
  const uniq = [...new Set(serials.map((s) => s.trim()).filter(Boolean))]
  for (let i = 0; i < uniq.length; i += RESOLVE_BATCH) {
    const res = await callRpc<SerialResolution[]>('admin_resolve_serials', { p_serials: uniq.slice(i, i + RESOLVE_BATCH) })
    for (const r of res) out.set(r.input, r)
  }
  return out
}

export interface ImageUploadPlanItem {
  candidate: ImageCandidate
  resolution: SerialResolution
  storagePath: string
  /** The trademark already has this exact file (same SHA-256): the upload refreshes the object, the row stays. */
  unchanged: boolean
  /** Object path of the image this upload supersedes (removed after a successful link), if any. */
  replaces: string | null
}

/** Existing image rows of the trademarks an upload batch targets (migration 1000 RPC, with a fallback). */
export interface ExistingImage {
  id: string
  trademark_id: string | null
  image_type: string
  status: string
  match_method: string | null
  storage_bucket: string
  storage_path: string
  thumbnail_path: string | null
  content_hash: string | null
}

const LOOKUP_BATCH = 500

/**
 * Current images of the given trademarks, keyed by trademark id. Uses
 * `admin_trademark_images_lookup` (migration 1000); when that function is not
 * installed yet it pages through `admin_list_images` instead, so planning works
 * on every project state.
 */
export async function lookupExistingImages(trademarkIds: string[]): Promise<Map<string, ExistingImage[]>> {
  const out = new Map<string, ExistingImage[]>()
  const add = (row: ExistingImage) => {
    if (!row.trademark_id) return
    const list = out.get(row.trademark_id) ?? []
    list.push(row)
    out.set(row.trademark_id, list)
  }
  const ids = [...new Set(trademarkIds.filter(Boolean))]
  if (ids.length === 0) return out
  const first = await rpc('admin_trademark_images_lookup', { p_trademark_ids: ids.slice(0, LOOKUP_BATCH) })
  if (first.error && (first.error.code === 'PGRST202' || /schema cache/i.test(first.error.message))) {
    // Fallback (migration 1000 not applied): scan the admin image list, 200 rows per call.
    const wanted = new Set(ids)
    for (let offset = 0; ; offset += 200) {
      const page = await rpc('admin_list_images', { p_query: null, p_status: 'all', p_job_id: null, p_linked: 'linked', p_limit: 200, p_offset: offset })
      if (page.error) {
        // Not even 0600 installed: plan without prior knowledge (every file gets a
        // content-addressed path; the database still reports unchanged/updated).
        if (page.error.code === 'PGRST202' || /schema cache/i.test(page.error.message)) return out
        throw toDataError(page.error)
      }
      const rows = (page.data as ExistingImage[] | null) ?? []
      for (const row of rows) if (row.trademark_id && wanted.has(row.trademark_id)) add(row)
      if (rows.length < 200) break
    }
    return out
  }
  if (first.error) throw toDataError(first.error)
  for (const row of (first.data as ExistingImage[]) ?? []) add(row)
  for (let i = LOOKUP_BATCH; i < ids.length; i += LOOKUP_BATCH) {
    const rows = await callRpc<ExistingImage[]>('admin_trademark_images_lookup', { p_trademark_ids: ids.slice(i, i + LOOKUP_BATCH) })
    for (const row of rows ?? []) add(row)
  }
  return out
}

export interface ImageImportProgress {
  processed: number
  total: number
  uploaded: number
  linked: number
  unchanged: number
  failed: number
  failures: { fileName: string; message: string }[]
}

export interface RegisterResult {
  inserted: number
  updated: number
  unchanged: number
  failed: number
  results: { storage_path: string; trademark_id: string | null; status: 'inserted' | 'updated' | 'unchanged' | 'failed'; replaced_paths?: string[]; message?: string }[]
}

async function uploadOne(item: ImageUploadPlanItem): Promise<void> {
  const blob = new Blob([item.candidate.bytes as BlobPart], { type: item.candidate.contentType })
  // Object paths are content-addressed (see storagePathFor): a path is only ever
  // written with the same bytes, and a corrected picture gets a new path/URL, so
  // caching is safe and nothing stale can be served. `upsert` re-creates an
  // object that was removed while its row survived.
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(item.storagePath, blob, {
    upsert: true,
    contentType: item.candidate.contentType,
    cacheControl: '86400',
  })
  if (error) {
    if (/row-level security|Unauthorized|403|not allowed/i.test(error.message)) {
      throw new DataError(
        `Storage refused the upload of ${item.candidate.fileName} (${error.message}). The trademark-images bucket needs the administrator write policies from migration 0400 — see docs/IMPORT_CENTER.md.`,
        'storage_policy',
      )
    }
    throw new DataError(`Upload failed for ${item.candidate.fileName}: ${error.message}`, 'storage')
  }
}

/**
 * Upload matched images to Storage (parallel, bounded) and register them in
 * `trademark_images` in batches. Objects superseded by a newer upload for the
 * same trademark are removed from Storage afterwards.
 */
export async function importImages(jobId: string, plan: ImageUploadPlanItem[], onProgress?: (p: ImageImportProgress) => void, signal?: AbortSignal): Promise<ImageImportProgress> {
  const p: ImageImportProgress = { processed: 0, total: plan.length, uploaded: 0, linked: 0, unchanged: 0, failed: 0, failures: [] }
  const emit = () => onProgress?.({ ...p, failures: [...p.failures] })

  for (let i = 0; i < plan.length; i += REGISTER_BATCH) {
    const batch = plan.slice(i, i + REGISTER_BATCH)
    const uploaded: ImageUploadPlanItem[] = []

    // bounded-concurrency uploads
    let cursor = 0
    const worker = async () => {
      while (cursor < batch.length) {
        if (signal?.aborted) throw new DataError('Import cancelled', 'cancelled')
        const item = batch[cursor++]
        try {
          await uploadOne(item)
          uploaded.push(item)
          p.uploaded++
        } catch (e) {
          p.failed++
          p.failures.push({ fileName: item.candidate.fileName, message: (e as Error).message })
        }
        p.processed++
        emit()
      }
    }
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, batch.length) }, worker))

    if (uploaded.length) {
      const items = uploaded.map((u) => ({
        trademark_id: u.resolution.trademark_id,
        storage_bucket: IMAGE_BUCKET,
        storage_path: u.storagePath,
        image_type: 'logo',
        match_method: u.resolution.method,
        original_filename: u.candidate.fileName,
        source_folder: u.candidate.archive ? `${u.candidate.archive}/${u.candidate.folder}` : null,
        gazette_number: u.resolution.gazette_number,
        serial_number: u.resolution.serial_number,
        width: u.candidate.width,
        height: u.candidate.height,
        byte_size: u.candidate.size,
        content_type: u.candidate.contentType,
        content_hash: u.candidate.sha256,
      }))
      const r = await callRpc<RegisterResult>('admin_register_images', { p_job_id: jobId, p_items: items })
      p.linked += r.inserted + r.updated
      p.unchanged += r.unchanged
      const replaced: string[] = []
      for (const res of r.results ?? []) {
        if (res.status === 'failed') {
          p.failed++
          p.failures.push({ fileName: res.storage_path, message: res.message ?? 'link failed' })
        }
        if (res.replaced_paths?.length) replaced.push(...res.replaced_paths)
      }
      if (replaced.length) {
        // best effort — a stale object is harmless, the DB row is already gone
        await supabase.storage.from(IMAGE_BUCKET).remove(replaced).catch(() => undefined)
      }
      emit()
    }
  }
  return p
}

/**
 * Decide where an upload goes. Identical bytes already stored for the trademark
 * keep their object path (→ "unchanged", no new URL); anything else is stored
 * under a new content-addressed path and supersedes the current logo.
 */
export function planFor(candidate: ImageCandidate, resolution: SerialResolution, existing: ExistingImage[] = []): ImageUploadPlanItem {
  const current = existing.filter((e) => e.image_type === 'logo' && e.status === 'matched' && e.storage_bucket === IMAGE_BUCKET)
  const hash = candidate.sha256.toLowerCase()
  const same = current.find((e) => (e.content_hash ?? '').toLowerCase() === hash)
  if (same) return { candidate, resolution, storagePath: same.storage_path, unchanged: true, replaces: null }
  const storagePath = storagePathFor(resolution.gazette_number, resolution.serial_number ?? candidate.serial ?? candidate.stem, candidate.ext, hash)
  const superseded = current.find((e) => e.match_method !== 'manual' && e.storage_path !== storagePath)
  return { candidate, resolution, storagePath, unchanged: false, replaces: superseded?.storage_path ?? null }
}

/* ------------------------------ reports --------------------------------- */

export interface TrademarkWithoutImage {
  id: string
  serial_number: string
  official_gazette_number: string
  mark_name: string | null
  applicant_name: string | null
  total_count: number
}

export async function listTrademarksWithoutImages(limit = 1000, offset = 0): Promise<{ items: TrademarkWithoutImage[]; total: number }> {
  const items = await callRpc<TrademarkWithoutImage[]>('admin_trademarks_without_images', { p_limit: limit, p_offset: offset })
  return { items, total: items[0]?.total_count ?? 0 }
}
