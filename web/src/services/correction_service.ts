import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { DataError, toDataError } from './_shared'

/* ---------------------------------------------------------------------------
 * Data Correction & Verification Requests (migration 0900).
 *
 * Public side: submit_correction_request (validated + rate-limited on the
 * server, stored in the private table public.correction_requests), an optional
 * evidence upload to the private bucket `correction-evidence` (Storage policy
 * = correction_upload_allowed(name): only <request-id>/… within 15 minutes of
 * submitting, max 3 files), and correction_request_status(reference, e-mail)
 * so a requester can check the outcome. A request never changes a trademark
 * row by itself — administrators review it in /admin/corrections.
 * ------------------------------------------------------------------------- */

export const CORRECTION_TYPES = ['incorrect_name', 'classification', 'image', 'publication_reference', 'duplicate', 'other'] as const
export type CorrectionType = (typeof CORRECTION_TYPES)[number]
export const isCorrectionType = (v: unknown): v is CorrectionType => typeof v === 'string' && (CORRECTION_TYPES as readonly string[]).includes(v)

export const CORRECTION_STATUSES = ['received', 'under_review', 'more_info_needed', 'resolved', 'closed_no_change'] as const
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number]

/** Limits mirrored from the database constraints (the server enforces them regardless). */
export const CORRECTION_LIMITS = { name: 120, email: 254, record: 120, description: 5000, descriptionMin: 10 } as const

/** Evidence uploads — mirrored from the bucket settings and the Storage policy in 0900. */
export const EVIDENCE = {
  bucket: 'correction-evidence',
  maxFiles: 3,
  maxBytes: 5 * 1024 * 1024,
  accept: { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'application/pdf': ['pdf'] } as Record<string, string[]>,
  windowMinutes: 15,
} as const
export const EVIDENCE_EXTENSIONS = Object.values(EVIDENCE.accept).flat()

export type CorrectionSubmission = {
  requestType: CorrectionType
  fullName: string
  email: string
  description: string
  relatedRecord?: string
  locale?: string
  pageUrl?: string
  /** Hidden anti-spam field — must stay empty for real visitors. */
  honeypot?: string
}

export type CorrectionReceipt = { id: string; reference: string; received_at: string; upload_until: string }

export type CorrectionStatusView = {
  reference: string
  status: CorrectionStatus
  request_type: CorrectionType
  created_at: string
  updated_at: string
  public_note: string | null
}

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)

/** Error codes a page can act on: 'schema_missing' (0900 not applied), 'rate_limited', 'validation', 'forbidden', 'upload', other. */
export class CorrectionError extends DataError {}

function toCorrectionError(err: { message: string; code?: string }): CorrectionError {
  if (err.code === 'TM429') return new CorrectionError(err.message, 'rate_limited')
  if (err.code === '22023') return new CorrectionError(err.message, 'validation')
  if (err.code === '42501' || /Administrator role required/i.test(err.message)) return new CorrectionError('Administrator role required.', 'forbidden')
  const d = toDataError(err)
  return new CorrectionError(d.message, d.code)
}

/** Submit a request. Resolves only when the database has stored it (or silently discarded a honeypot hit). */
export async function submitCorrectionRequest(s: CorrectionSubmission): Promise<CorrectionReceipt> {
  const res = await rpc('submit_correction_request', {
    p_request_type: s.requestType,
    p_full_name: s.fullName.trim(),
    p_email: s.email.trim(),
    p_description: s.description.trim(),
    p_related_record: s.relatedRecord?.trim() || null,
    p_locale: s.locale ?? null,
    p_page_url: s.pageUrl ?? null,
    p_honeypot: s.honeypot ?? null,
  })
  if (res.error) throw toCorrectionError(res.error)
  const data = res.data as Partial<CorrectionReceipt> | null
  if (!data?.id || !data.reference) throw new CorrectionError('The database did not confirm the submission.', 'empty')
  const now = new Date().toISOString()
  return { id: data.id, reference: data.reference, received_at: data.received_at ?? now, upload_until: data.upload_until ?? now }
}

/** Client-side pre-check of one evidence file (the bucket and the Storage policy enforce the same rules). */
export function validateEvidenceFile(file: File): 'type' | 'size' | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const typeOk = file.type in EVIDENCE.accept && EVIDENCE.accept[file.type].includes(ext)
  if (!typeOk) return 'type'
  if (file.size > EVIDENCE.maxBytes || file.size === 0) return 'size'
  return null
}

export type EvidenceUploadResult = { file: File; ok: boolean; error?: string }

/**
 * Upload evidence for a just-submitted request. Object names are generated here
 * (never the visitor's file name) and must match the server-side pattern
 * <request-id>/<8–40 lowercase alphanumerics>.<ext>. Files are uploaded one by
 * one; a failure does not undo the request itself.
 */
export async function uploadEvidence(requestId: string, files: File[]): Promise<EvidenceUploadResult[]> {
  const out: EvidenceUploadResult[] = []
  for (const file of files.slice(0, EVIDENCE.maxFiles)) {
    const invalid = validateEvidenceFile(file)
    if (invalid) {
      out.push({ file, ok: false, error: invalid })
      continue
    }
    const ext = file.name.split('.').pop()!.toLowerCase()
    const name = `${requestId}/${randomName()}.${ext}`
    const { error } = await supabase.storage.from(EVIDENCE.bucket).upload(name, file, { contentType: file.type, upsert: false, cacheControl: '0' })
    out.push(error ? { file, ok: false, error: error.message } : { file, ok: true })
  }
  return out
}

function randomName(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  let s = ''
  for (const b of bytes) s += alphabet[b % alphabet.length]
  return s
}

/** Status lookup for the requester: needs the reference AND the e-mail used. `null` = no match. */
export async function checkCorrectionStatus(reference: string, email: string): Promise<CorrectionStatusView | null> {
  const res = await rpc('correction_request_status', { p_reference: reference.trim(), p_email: email.trim() })
  if (res.error) throw toCorrectionError(res.error)
  return (res.data as CorrectionStatusView | null) ?? null
}

/** Is the form backed by the database (migration 0900 applied)? Cached per session. */
export async function correctionFormAvailable(): Promise<boolean> {
  const res = await rpc('correction_form_status', {})
  if (!res.error) return !!(res.data as { available?: boolean } | null)?.available
  const err = toCorrectionError(res.error)
  if (err.code === 'schema_missing') return false
  throw err
}
export const correctionFormStatusQuery = () =>
  queryOptions({ queryKey: ['corrections', 'status'], queryFn: correctionFormAvailable, staleTime: Infinity, retry: 1 })

/* ------------------------------- admin side ------------------------------- */

export type CorrectionRequestRow = {
  id: string
  reference: string
  created_at: string
  updated_at: string
  request_type: CorrectionType
  full_name: string
  email: string
  related_record: string | null
  trademark_id: string | null
  trademark_serial: string | null
  description: string
  locale: string | null
  page_url: string | null
  status: CorrectionStatus
  internal_note: string | null
  public_note: string | null
  handled_by: string | null
  handled_at: string | null
}
export type CorrectionEvent = { id: number; created_at: string; actor_id: string | null; from_status: CorrectionStatus | null; to_status: CorrectionStatus; note: string | null }
export type CorrectionFile = { name: string; created_at: string; size: number | null; mimetype: string | null }
export type CorrectionRequestDetail = CorrectionRequestRow & { trademark_name: string | null; user_agent: string | null; events: CorrectionEvent[]; files: CorrectionFile[] }
export type CorrectionCounts = { total: number; received: number; under_review: number; more_info_needed: number; resolved: number; closed_no_change: number; last_24h: number }

async function adminRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await rpc(fn, args)
  if (res.error) throw toCorrectionError(res.error)
  return res.data as T
}

export const correctionCountsQuery = () =>
  queryOptions({ queryKey: ['admin', 'corrections', 'counts'], queryFn: () => adminRpc<CorrectionCounts>('admin_correction_counts'), staleTime: 15_000 })

export async function listCorrectionRequests(p: { status?: string | null; type?: string | null; query?: string | null; limit: number; offset: number }) {
  const rows =
    (await adminRpc<(CorrectionRequestRow & { total_count: number })[] | null>('admin_list_correction_requests', {
      p_status: p.status || null,
      p_type: p.type || null,
      p_query: p.query || null,
      p_limit: p.limit,
      p_offset: p.offset,
    })) ?? []
  return { items: rows as CorrectionRequestRow[], total: rows[0]?.total_count ?? 0 }
}

export const correctionDetailQuery = (id: string) =>
  queryOptions({ queryKey: ['admin', 'corrections', 'detail', id], queryFn: () => adminRpc<CorrectionRequestDetail>('admin_get_correction_request', { p_id: id }), staleTime: 5_000 })

/** Notes: `null` keeps the stored value, '' clears it. `trademarkSerial` re-links the request to a record (validated on the server). */
export async function updateCorrectionRequest(p: { id: string; status: CorrectionStatus; internalNote?: string | null; publicNote?: string | null; trademarkSerial?: string | null }) {
  return adminRpc<CorrectionRequestDetail>('admin_update_correction_request', {
    p_id: p.id,
    p_status: p.status,
    p_internal_note: p.internalNote ?? null,
    p_public_note: p.publicNote ?? null,
    p_trademark_serial: p.trademarkSerial?.trim() || null,
  })
}

/** Short-lived signed URL for an evidence file (Storage policy: administrators only). */
export async function evidenceSignedUrl(name: string): Promise<string> {
  const { data, error } = await supabase.storage.from(EVIDENCE.bucket).createSignedUrl(name, 300)
  if (error || !data?.signedUrl) throw new CorrectionError(error?.message ?? 'Could not create a download link.', 'upload')
  return data.signedUrl
}

export async function deleteEvidence(name: string): Promise<void> {
  const { error } = await supabase.storage.from(EVIDENCE.bucket).remove([name])
  if (error) throw new CorrectionError(error.message, 'upload')
}
