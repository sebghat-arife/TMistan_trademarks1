import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { DataError, toDataError } from './_shared'

/* ---------------------------------------------------------------------------
 * Contact & Feedback service (migration 0800).
 *
 * The public page calls exactly one database function, submit_contact_request,
 * which validates and rate-limits on the server and stores the inquiry in the
 * private table public.contact_requests (RLS on, no public grants — nobody can
 * read inquiries through the API). Administrators read and triage them through
 * the admin_* functions below (admin_assert() on the server).
 * ------------------------------------------------------------------------- */

export const INQUIRY_TYPES = ['general', 'trademark-research', 'data-correction', 'technical-support'] as const
export type InquiryType = (typeof INQUIRY_TYPES)[number]
export const isInquiryType = (v: unknown): v is InquiryType => typeof v === 'string' && (INQUIRY_TYPES as readonly string[]).includes(v)

export const CONTACT_STATUSES = ['new', 'in_progress', 'closed', 'spam'] as const
export type ContactStatus = (typeof CONTACT_STATUSES)[number]

/** Category-specific fields; the server keeps only these keys (each clipped to 1000 chars). */
export type ContactDetails = Partial<
  Record<
    | 'trademark_name'
    | 'serial_number'
    | 'applicant_name'
    | 'trademark_class'
    | 'gazette_number'
    | 'source_page'
    | 'research_type'
    | 'response_format'
    | 'purpose'
    | 'deadline'
    | 'issue_category'
    | 'issue_url'
    | 'browser_info',
    string
  >
>

export type ContactSubmission = {
  inquiryType: InquiryType
  fullName: string
  email: string
  organization?: string
  subject: string
  message: string
  details?: ContactDetails
  locale?: string
  pageUrl?: string
  /** Hidden anti-spam field — must stay empty for real visitors. */
  honeypot?: string
}

export type ContactReceipt = { id: string; received_at: string }

/** Limits mirrored from the database constraints (the server enforces them regardless). */
export const CONTACT_LIMITS = { name: 120, organization: 200, subject: 200, message: 5000, messageMin: 10 } as const

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)

/** Error codes a page can act on: 'schema_missing' (0800 not applied), 'rate_limited', 'validation', 'forbidden', other. */
export class ContactError extends DataError {}

function toContactError(err: { message: string; code?: string }): ContactError {
  if (err.code === 'TM429') return new ContactError(err.message, 'rate_limited')
  if (err.code === '22023') return new ContactError(err.message, 'validation')
  if (err.code === '42501' || /Administrator role required/i.test(err.message)) return new ContactError('Administrator role required.', 'forbidden')
  const d = toDataError(err)
  return new ContactError(d.message, d.code)
}

/** Submit an inquiry. Resolves only when the database has actually stored it (or silently discarded a honeypot hit). */
export async function submitContactRequest(s: ContactSubmission): Promise<ContactReceipt> {
  const res = await rpc('submit_contact_request', {
    p_inquiry_type: s.inquiryType,
    p_full_name: s.fullName.trim(),
    p_email: s.email.trim(),
    p_subject: s.subject.trim(),
    p_message: s.message.trim(),
    p_organization: s.organization?.trim() || null,
    p_details: compactDetails(s.details),
    p_locale: s.locale ?? null,
    p_page_url: s.pageUrl ?? null,
    p_honeypot: s.honeypot ?? null,
  })
  if (res.error) throw toContactError(res.error)
  const data = res.data as Partial<ContactReceipt> | null
  if (!data?.id) throw new ContactError('The database did not confirm the submission.', 'empty')
  return { id: data.id, received_at: data.received_at ?? new Date().toISOString() }
}

function compactDetails(d: ContactDetails | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(d ?? {})) if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  return out
}

/** Is the form backed by the database (migration 0800 applied)? Cached per session. */
export async function contactFormAvailable(): Promise<boolean> {
  const res = await rpc('contact_form_status', {})
  if (!res.error) return !!(res.data as { available?: boolean } | null)?.available
  const err = toContactError(res.error)
  if (err.code === 'schema_missing') return false
  throw err
}
export const contactFormStatusQuery = () =>
  queryOptions({ queryKey: ['contact', 'status'], queryFn: contactFormAvailable, staleTime: Infinity, retry: 1 })

/* ------------------------------- admin side ------------------------------- */

export type ContactRequestRow = {
  id: string
  created_at: string
  inquiry_type: InquiryType
  full_name: string
  email: string
  organization: string | null
  subject: string
  message: string
  details: ContactDetails
  locale: string | null
  page_url: string | null
  status: ContactStatus
  admin_note: string | null
  handled_by: string | null
  handled_at: string | null
}
export type ContactCounts = { total: number; new: number; in_progress: number; closed: number; spam: number; last_24h: number }

async function adminRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await rpc(fn, args)
  if (res.error) throw toContactError(res.error)
  return res.data as T
}

export const contactCountsQuery = () =>
  queryOptions({ queryKey: ['admin', 'contact', 'counts'], queryFn: () => adminRpc<ContactCounts>('admin_contact_counts'), staleTime: 15_000 })

export async function listContactRequests(p: { status?: string | null; type?: string | null; query?: string | null; limit: number; offset: number }) {
  const rows =
    (await adminRpc<(ContactRequestRow & { total_count: number })[] | null>('admin_list_contact_requests', {
      p_status: p.status || null,
      p_type: p.type || null,
      p_query: p.query || null,
      p_limit: p.limit,
      p_offset: p.offset,
    })) ?? []
  return { items: rows as ContactRequestRow[], total: rows[0]?.total_count ?? 0 }
}

export async function updateContactRequest(id: string, status: ContactStatus, adminNote: string | null): Promise<ContactRequestRow> {
  return adminRpc<ContactRequestRow>('admin_update_contact_request', { p_id: id, p_status: status, p_admin_note: adminNote })
}
