import { supabase } from '@/lib/supabase'
import type { ImageStatus, ImageType, ImportJobRow, ReviewStatus, TrademarkImageRow, TrademarkRow } from '@/lib/database.types'
import { DataError, toDataError } from './_shared'

/* ---------------------------------------------------------------------------
 * Admin Data Management service (migration 0600).
 *
 * Every read and every mutation here is a SECURITY DEFINER function that
 * starts with `admin_assert()`; the browser only holds the publishable key +
 * the administrator's session. Nothing in this file bypasses RLS, nothing is
 * deleted without the server-side confirmation token, and every destructive
 * call is written to `public.admin_actions` by the database itself.
 *
 * Storage objects are removed by the browser (Storage RLS: admin policies on
 * the public bucket) AFTER the database rows are gone, then reported back via
 * `admin_storage_cleanup_mark`. A Storage failure therefore never leaves a
 * dangling database reference — only a visible, retryable queue entry.
 * ------------------------------------------------------------------------- */

export const IMAGE_BUCKET = 'trademark-images'
export const DELETE_TOKEN = 'DELETE'

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)

async function callRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await rpc(fn, args)
  if (res.error) {
    if (res.error.code === '42501' || /Administrator role required/i.test(res.error.message)) {
      throw new DataError('Administrator role required for this operation.', 'forbidden')
    }
    throw toDataError(res.error)
  }
  return res.data as T
}

/* ------------------------------ readiness ------------------------------- */

export type DataManagementReadiness = { ready: true } | { ready: false; reason: 'schema_missing' | 'forbidden' | 'error'; message: string }

/** `admin_data_overview` exists only after migration 0600: use it as the probe. */
export async function dataManagementReady(): Promise<DataManagementReadiness> {
  const res = await rpc('admin_data_overview', {})
  if (!res.error) return { ready: true }
  const err = toDataError(res.error)
  if (err.code === 'schema_missing') return { ready: false, reason: 'schema_missing', message: 'Migration 0600 (data management) has not been applied to this Supabase project.' }
  if (res.error.code === '42501' || /Administrator role required/i.test(res.error.message)) return { ready: false, reason: 'forbidden', message: 'Administrator role required.' }
  return { ready: false, reason: 'error', message: err.message }
}

/* ------------------------------- overview ------------------------------- */

export interface DataOverview {
  trademarks: { total: number; published: number; archived: number; with_images: number; without_images: number; gazettes: number; with_provenance: number; last_created_at: string | null; last_updated_at: string | null }
  images: { total: number; matched: number; unmatched: number; ambiguous: number; needs_review: number; unlinked: number; bytes: number; indexed: number }
  import_jobs: { total: number; excel: number; images: number; running: number; failed: number; warnings: number; completed: number; last_at: string | null; stale_running: number }
  storage_cleanup: { pending: number; failed: number; done: number }
  audit: { admin_actions: number; audit_logs: number; last_action_at: string | null }
  generated_at: string
}

export const getDataOverview = () => callRpc<DataOverview>('admin_data_overview')

/* ------------------------------ trademarks ------------------------------ */

export interface AdminTrademarkListItem {
  id: string
  serial_number: string
  record_number: string | null
  mark_name: string | null
  applicant_name: string | null
  trademark_class: string | null
  application_type: string | null
  official_gazette_number: string
  publication_date: string | null
  registration_number: string | null
  application_number: string | null
  is_published: boolean
  review_status: ReviewStatus
  image_count: number
  import_job_id: string | null
  created_by_job_id: string | null
  created_at: string
  updated_at: string
  total_count: number
}

export interface TrademarkSearchParams {
  query?: string
  gazette?: string
  status?: 'all' | 'published' | 'archived'
  jobId?: string | null
  images?: 'all' | 'with' | 'without'
  sort?: 'updated' | 'serial' | 'created' | 'mark'
  limit?: number
  offset?: number
}

export async function searchAdminTrademarks(p: TrademarkSearchParams): Promise<{ items: AdminTrademarkListItem[]; total: number }> {
  const items = (await callRpc<AdminTrademarkListItem[]>('admin_search_trademarks', {
    p_query: p.query?.trim() || null,
    p_gazette: p.gazette?.trim() || null,
    p_status: p.status ?? 'all',
    p_job_id: p.jobId ?? null,
    p_images: p.images ?? 'all',
    p_sort: p.sort ?? 'updated',
    p_limit: p.limit ?? 50,
    p_offset: p.offset ?? 0,
  })) ?? []
  return { items, total: items[0]?.total_count ?? 0 }
}

export interface AuditEntryLite {
  id: number
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  changed_fields: string[] | Record<string, unknown> | null
  actor_id: string | null
  actor_role: string | null
  created_at: string
}

export interface AdminTrademarkDetail {
  trademark: TrademarkRow
  images: TrademarkImageRow[]
  feature_count: number
  created_job: ImportJobRow | null
  last_job: ImportJobRow | null
  audit: AuditEntryLite[]
  admin_actions: AdminAction[]
}

export const getAdminTrademark = (id: string) => callRpc<AdminTrademarkDetail | null>('admin_get_trademark', { p_id: id })

export interface PublishResult { affected: number; serials: string[]; action_id: number }
export const setTrademarksPublished = (ids: string[], published: boolean, reason?: string | null) =>
  callRpc<PublishResult>('admin_set_trademarks_published', { p_ids: ids, p_published: published, p_reason: reason ?? null })

export interface DeleteTrademarksResult { deleted: number; images_deleted: number; storage_queued: number; serials: string[]; action_id: number }
export const deleteTrademarks = (ids: string[], confirm: string) =>
  callRpc<DeleteTrademarksResult>('admin_delete_trademarks', { p_ids: ids, p_confirm: confirm })

/* -------------------------------- images -------------------------------- */

export interface AdminImageListItem {
  id: string
  trademark_id: string | null
  image_type: ImageType
  status: ImageStatus
  match_method: string | null
  storage_bucket: string
  storage_path: string
  thumbnail_path: string | null
  original_filename: string | null
  source_folder: string | null
  gazette_number: string | null
  serial_number: string | null
  width: number | null
  height: number | null
  byte_size: number | null
  content_type: string | null
  content_hash: string | null
  sort_order: number
  import_job_id: string | null
  created_by_job_id: string | null
  review_note: string | null
  created_at: string
  updated_at: string
  tm_serial: string | null
  tm_mark_name: string | null
  tm_published: boolean | null
  has_features: boolean
  total_count: number
}

export interface ImageListParams {
  query?: string
  status?: 'all' | ImageStatus
  jobId?: string | null
  linked?: 'all' | 'linked' | 'unlinked'
  limit?: number
  offset?: number
}

export async function listAdminImages(p: ImageListParams): Promise<{ items: AdminImageListItem[]; total: number }> {
  const items = (await callRpc<AdminImageListItem[]>('admin_list_images', {
    p_query: p.query?.trim() || null,
    p_status: p.status ?? 'all',
    p_job_id: p.jobId ?? null,
    p_linked: p.linked ?? 'all',
    p_limit: p.limit ?? 50,
    p_offset: p.offset ?? 0,
  })) ?? []
  return { items, total: items[0]?.total_count ?? 0 }
}

export interface DeleteImagesResult { deleted: number; storage_queued: number; paths: string[]; action_id: number }
export const deleteImages = (ids: string[], confirm: string) =>
  callRpc<DeleteImagesResult>('admin_delete_images', { p_ids: ids, p_confirm: confirm })

/* ------------------------------ import jobs ----------------------------- */

export interface AdminImportJob extends Omit<ImportJobRow, 'source_path'> {
  created_trademarks: number
  updated_trademarks: number
  created_images: number
  failed_items: number
  total_count: number
}

export async function listAdminImportJobs(p: { type?: 'all' | 'excel' | 'images'; status?: string; limit?: number; offset?: number }): Promise<{ items: AdminImportJob[]; total: number }> {
  const items = (await callRpc<AdminImportJob[]>('admin_list_import_jobs', {
    p_type: p.type ?? 'all',
    p_status: p.status ?? 'all',
    p_limit: p.limit ?? 50,
    p_offset: p.offset ?? 0,
  })) ?? []
  return { items, total: items[0]?.total_count ?? 0 }
}

export interface ImportJobDetail {
  job: ImportJobRow | null
  counts: {
    created_trademarks: number
    updated_trademarks: number
    touched_trademarks: number
    created_images: number
    touched_images: number
    items_failed: number
    items_unmatched: number
    items_skipped: number
    has_row_provenance: boolean
  }
  problems: { id: number; item_ref: string | null; status: string; message: string | null; payload: Record<string, unknown> | null }[]
  admin_actions: AdminAction[]
}

export const getImportJobDetail = (jobId: string) => callRpc<ImportJobDetail>('admin_import_job_detail', { p_job_id: jobId })

export interface ImportJobRecord {
  id: string
  serial_number: string | null
  mark_name: string | null
  official_gazette_number: string | null
  is_published: boolean | null
  storage_path: string | null
  image_status: string | null
  created_at: string
  updated_at: string
  modified_later: boolean
  modified_by_job: string | null
  total_count: number
}

export async function listImportJobRecords(jobId: string, kind: 'created' | 'updated' | 'images', limit = 100, offset = 0): Promise<{ items: ImportJobRecord[]; total: number }> {
  const items = (await callRpc<ImportJobRecord[]>('admin_import_job_records', { p_job_id: jobId, p_kind: kind, p_limit: limit, p_offset: offset })) ?? []
  return { items, total: items[0]?.total_count ?? 0 }
}

export interface BatchDeletePreview {
  preview: true
  job: { id: string; job_type: 'excel' | 'images'; filename: string | null; status: string }
  trademarks: number
  trademarks_modified_later: number
  include_modified: boolean
  images: number
  storage_objects: number
  serials: string[]
  updated_only: number
  has_provenance: boolean
}
export interface BatchDeleteResult {
  preview: false
  trademarks: number
  images: number
  storage_queued: number
  serials: string[]
  action_id: number
  modified_skipped: number
}

export const previewDeleteImportJobRecords = (jobId: string, includeModified: boolean) =>
  callRpc<BatchDeletePreview>('admin_delete_import_job_records', { p_job_id: jobId, p_confirm: null, p_include_modified: includeModified })
export const deleteImportJobRecords = (jobId: string, confirm: string, includeModified: boolean) =>
  callRpc<BatchDeleteResult>('admin_delete_import_job_records', { p_job_id: jobId, p_confirm: confirm, p_include_modified: includeModified })

export const deleteImportJob = (jobId: string, confirm: string) =>
  callRpc<{ deleted: number; items_deleted: number; action_id: number }>('admin_delete_import_job', { p_job_id: jobId, p_confirm: confirm })
export const cancelImportJob = (jobId: string, reason?: string | null) =>
  callRpc<{ cancelled: boolean; action_id: number }>('admin_cancel_import_job', { p_job_id: jobId, p_reason: reason ?? null })
export const purgeImportJobs = (olderThanDays: number, confirm: string | null) =>
  callRpc<{ preview: boolean; jobs: number; items?: number; action_id?: number }>('admin_purge_import_jobs', { p_older_than_days: olderThanDays, p_confirm: confirm })

/* ------------------------------- audit log ------------------------------ */

export interface AdminAction {
  id: number
  actor_id: string | null
  actor_email: string | null
  action: string
  target_type: string
  target_ids: string[]
  serials: string[]
  storage_paths: string[]
  job_id: string | null
  affected_count: number
  status: 'success' | 'partial' | 'failed' | 'preview'
  details: Record<string, unknown>
  created_at: string
  total_count?: number
}

export async function listAdminActions(p: { action?: string | null; jobId?: string | null; limit?: number; offset?: number }): Promise<{ items: AdminAction[]; total: number }> {
  const items = (await callRpc<AdminAction[]>('admin_list_admin_actions', { p_action: p.action ?? null, p_job_id: p.jobId ?? null, p_limit: p.limit ?? 50, p_offset: p.offset ?? 0 })) ?? []
  return { items, total: items[0]?.total_count ?? 0 }
}

export interface AuditLogEntry {
  id: number
  table_name: string
  row_id: string
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  changed_fields: string[] | Record<string, unknown> | null
  actor_id: string | null
  actor_role: string | null
  created_at: string
  serial: string | null
  total_count: number
}

export async function listAuditLogs(p: { table?: string | null; action?: string | null; rowId?: string | null; limit?: number; offset?: number }): Promise<{ items: AuditLogEntry[]; total: number }> {
  const items = (await callRpc<AuditLogEntry[]>('admin_list_audit_logs', { p_table: p.table ?? null, p_action: p.action ?? null, p_row_id: p.rowId ?? null, p_limit: p.limit ?? 50, p_offset: p.offset ?? 0 })) ?? []
  return { items, total: items[0]?.total_count ?? 0 }
}

export const logAdminAction = (action: string, targetType: string, storagePaths: string[], status: 'success' | 'partial' | 'failed', details: Record<string, unknown> = {}) =>
  callRpc<number>('admin_log_action', { p_action: action, p_target_type: targetType, p_storage_paths: storagePaths, p_status: status, p_details: details })

/* --------------------------- storage consistency ------------------------ */

export interface CleanupEntry {
  id: number
  bucket: string
  path: string
  reason: string | null
  action_id: number | null
  status: 'pending' | 'done' | 'failed' | 'skipped'
  attempts: number
  last_error: string | null
  created_at: string
  updated_at: string
}

export const listStorageCleanup = (status: 'pending' | 'failed' | 'done' | 'skipped' | 'all' = 'pending', limit = 500) =>
  callRpc<CleanupEntry[]>('admin_storage_cleanup_list', { p_status: status, p_limit: limit }).then((r) => r ?? [])

const markCleanup = (ids: number[], status: 'done' | 'failed' | 'skipped' | 'pending', error?: string | null) =>
  callRpc<number>('admin_storage_cleanup_mark', { p_ids: ids, p_status: status, p_error: error ?? null })

export interface CleanupRunResult { done: number; failed: number; skipped: number; skippedPaths: string[]; errors: { path: string; message: string }[] }

const REUSED_PATH_NOTE = 'skipped: object is referenced by a current image row (re-uploaded after the deletion)'

/**
 * Remove queued Storage objects (max `max` per run, 100 per Storage call) and
 * record the outcome per path. Objects that no longer exist count as done
 * (Storage's `remove` is idempotent and returns no error for missing keys).
 *
 * Guard: a queued path that an image row references AGAIN (the administrator
 * deleted an image and re-uploaded one for the same serial number before the
 * queue ran) is never removed — it is marked `skipped`. The database applies
 * the same rule when listing the queue (migration 1000); this check keeps the
 * guarantee on projects where that migration is not installed yet.
 */
export async function runStorageCleanup(entries: CleanupEntry[], max = 500): Promise<CleanupRunResult> {
  const candidates = entries.filter((e) => e.status === 'pending' || e.status === 'failed').slice(0, max)
  const out: CleanupRunResult = { done: 0, failed: 0, skipped: 0, skippedPaths: [], errors: [] }
  const ours = candidates.filter((e) => e.bucket === IMAGE_BUCKET)
  const unreferenced = new Set((await findUnreferencedPaths(ours.map((e) => e.path))).map((p) => p.path))
  const reused = ours.filter((e) => !unreferenced.has(e.path))
  if (reused.length) {
    await markCleanup(reused.map((e) => e.id), 'skipped', REUSED_PATH_NOTE)
    out.skipped += reused.length
    out.skippedPaths.push(...reused.map((e) => e.path))
  }
  const batch = ours.filter((e) => unreferenced.has(e.path))
  for (let i = 0; i < batch.length; i += 100) {
    const chunk = batch.slice(i, i + 100)
    if (!chunk.length) continue
    const { error } = await supabase.storage.from(IMAGE_BUCKET).remove(chunk.map((e) => e.path))
    if (error) {
      await markCleanup(chunk.map((e) => e.id), 'failed', error.message)
      out.failed += chunk.length
      out.errors.push(...chunk.map((e) => ({ path: e.path, message: error.message })))
    } else {
      await markCleanup(chunk.map((e) => e.id), 'done')
      out.done += chunk.length
    }
  }
  const foreign = candidates.filter((e) => e.bucket !== IMAGE_BUCKET)
  if (foreign.length) {
    await markCleanup(foreign.map((e) => e.id), 'skipped', 'Only the trademark-images bucket is managed from the browser')
    out.skipped += foreign.length
  }
  return out
}

/** Sentence appended to a deletion message: how many of the queued files were removed on the spot. */
export function storageRemovalNote(t: (key: string, opts?: Record<string, unknown>) => string, queued: number, cleaned: CleanupRunResult | null): string {
  if (!queued || !cleaned) return ''
  const left = Math.max(0, queued - cleaned.done - cleaned.skipped)
  return ' ' + t('admin.data.storage.removedNow', { done: cleaned.done, left })
}

/**
 * Remove the Storage objects a deletion just queued (same admin action),
 * right away instead of waiting for the next manual queue run. Best effort:
 * anything that cannot be removed now simply stays in the queue.
 */
export async function cleanupAfterAction(actionId: number | null | undefined): Promise<CleanupRunResult | null> {
  if (actionId === null || actionId === undefined) return null
  try {
    const pending = await listStorageCleanup('pending', 500)
    const mine = pending.filter((e) => e.action_id === actionId)
    if (!mine.length) return { done: 0, failed: 0, skipped: 0, skippedPaths: [], errors: [] }
    return await runStorageCleanup(mine)
  } catch {
    return null
  }
}

export interface StorageObjectInfo { path: string; size: number | null; updated_at: string | null; content_type: string | null }

/**
 * Walk the public bucket (folders are one level deep: `<gazette>/<serial>.<ext>`,
 * but the walk is generic up to `maxDepth`). Hard-capped so a very large
 * bucket cannot exhaust the browser.
 */
export async function listStorageObjects(opts: { maxObjects?: number; maxDepth?: number; onProgress?: (n: number) => void } = {}): Promise<{ objects: StorageObjectInfo[]; truncated: boolean }> {
  const maxObjects = opts.maxObjects ?? 20_000
  const maxDepth = opts.maxDepth ?? 3
  const objects: StorageObjectInfo[] = []
  let truncated = false
  const walk = async (prefix: string, depth: number): Promise<void> => {
    let offset = 0
    for (;;) {
      const { data, error } = await supabase.storage.from(IMAGE_BUCKET).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
      if (error) throw new DataError(`Storage listing failed for "${prefix || '/'}": ${error.message}`, 'storage')
      const entries = data ?? []
      for (const e of entries) {
        const full = prefix ? `${prefix}/${e.name}` : e.name
        const isFolder = !e.id && !e.metadata
        if (isFolder) {
          if (depth < maxDepth) await walk(full, depth + 1)
        } else {
          if (e.name === '.emptyFolderPlaceholder') continue
          const meta = (e.metadata ?? {}) as { size?: number; mimetype?: string }
          objects.push({ path: full, size: meta.size ?? null, updated_at: e.updated_at ?? null, content_type: meta.mimetype ?? null })
          if (objects.length >= maxObjects) { truncated = true; return }
        }
        if (truncated) return
      }
      opts.onProgress?.(objects.length)
      if (entries.length < 1000 || truncated) return
      offset += 1000
    }
  }
  await walk('', 0)
  return { objects, truncated }
}

export interface ImagePathRef { image_id: string; path: string; kind: 'image' | 'thumbnail' }

/** Every Storage path referenced by image rows (paged server-side, capped client-side). */
export async function listImageStoragePaths(maxRows = 100_000): Promise<{ refs: ImagePathRef[]; truncated: boolean }> {
  const refs: ImagePathRef[] = []
  for (let offset = 0; offset < maxRows; offset += 10_000) {
    const page = (await callRpc<ImagePathRef[]>('admin_image_storage_paths', { p_limit: 10_000, p_offset: offset })) ?? []
    refs.push(...page)
    if (page.length < 10_000) return { refs, truncated: false }
  }
  return { refs, truncated: true }
}

export interface UnreferencedPath { path: string; queued: boolean }

/** Which of the listed Storage paths are not referenced by any image row. */
export async function findUnreferencedPaths(paths: string[]): Promise<UnreferencedPath[]> {
  const out: UnreferencedPath[] = []
  for (let i = 0; i < paths.length; i += 5000) {
    out.push(...((await callRpc<UnreferencedPath[]>('admin_unreferenced_paths', { p_paths: paths.slice(i, i + 5000) })) ?? []))
  }
  return out
}

/**
 * Delete orphaned Storage objects (no database row). Verified server-side
 * again right before deletion so a file that got referenced in the meantime
 * is skipped. Logged to admin_actions with the exact paths and outcome.
 */
export async function deleteOrphanedObjects(paths: string[]): Promise<{ deleted: string[]; skipped: string[]; failed: { path: string; message: string }[] }> {
  const still = new Set((await findUnreferencedPaths(paths)).map((p) => p.path))
  const deletable = paths.filter((p) => still.has(p))
  const skipped = paths.filter((p) => !still.has(p))
  const deleted: string[] = []
  const failed: { path: string; message: string }[] = []
  for (let i = 0; i < deletable.length; i += 100) {
    const chunk = deletable.slice(i, i + 100)
    const { error } = await supabase.storage.from(IMAGE_BUCKET).remove(chunk)
    if (error) failed.push(...chunk.map((path) => ({ path, message: error.message })))
    else deleted.push(...chunk)
  }
  if (deleted.length || failed.length) {
    await logAdminAction('storage.delete_orphans', 'storage_object', deleted, failed.length ? (deleted.length ? 'partial' : 'failed') : 'success', {
      requested: paths.length,
      skipped_referenced: skipped.length,
      failed: failed.map((f) => f.path).slice(0, 200),
      error: failed[0]?.message ?? null,
    })
  }
  return { deleted, skipped, failed }
}

export const publicImageUrl = (path: string) => supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl
