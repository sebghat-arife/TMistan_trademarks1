/* ---------------------------------------------------------------------------
 * Which trademark record pages may be indexed by search engines.
 *
 * TMistan deliberately does NOT publish an unrestricted directory. A record
 * page is offered to search engines (robots index + sitemap + prerendered
 * HTML) only when it carries enough public, meaningful information to be a
 * useful result on its own. Every other record stays fully functional and
 * reachable through the search, but is marked noindex,follow.
 *
 * The same function drives the page (<Seo robots>), the sitemap and the
 * prerender list, so the three can never disagree. Tighten or relax the
 * rules here only.
 * ------------------------------------------------------------------------- */
import type { TrademarkPublicRow } from '@/lib/database.types'

export type IndexDecision = { indexable: true } | { indexable: false; reasons: IndexReason[] }

export type IndexReason =
  | 'unpublished'
  | 'not-a-registration'
  | 'no-mark-name'
  | 'no-applicant'
  | 'no-classes'
  | 'no-goods'
  | 'no-publication-date'
  | 'no-gazette'

/** Notice types that document a mark itself (as opposed to a later change to an existing mark). */
const REGISTRATION_TYPES = new Set(['New Trademark Registration'])

const PLACEHOLDERS = new Set(['', 'n/a', 'na', '-', '—', 'none', 'null'])

export function hasValue(v: string | null | undefined): boolean {
  return !!v && !PLACEHOLDERS.has(v.trim().toLowerCase())
}

export function recordIndexDecision(tm: Pick<
  TrademarkPublicRow,
  'is_published' | 'application_type' | 'mark_name' | 'applicant_name' | 'class_numbers' | 'goods_and_services' | 'publication_date' | 'official_gazette_number' | 'serial_number'
>): IndexDecision {
  const reasons: IndexReason[] = []
  if (tm.is_published === false) reasons.push('unpublished')
  if (!REGISTRATION_TYPES.has((tm.application_type ?? '').trim())) reasons.push('not-a-registration')
  if (!hasValue(tm.mark_name) || tm.mark_name?.trim() === tm.serial_number) reasons.push('no-mark-name')
  if (!hasValue(tm.applicant_name)) reasons.push('no-applicant')
  if (!tm.class_numbers || tm.class_numbers.length === 0) reasons.push('no-classes')
  if (!hasValue(tm.goods_and_services)) reasons.push('no-goods')
  if (!hasValue(tm.publication_date)) reasons.push('no-publication-date')
  if (!hasValue(tm.official_gazette_number)) reasons.push('no-gazette')
  return reasons.length ? { indexable: false, reasons } : { indexable: true }
}

export function isRecordIndexable(tm: Parameters<typeof recordIndexDecision>[0]): boolean {
  return recordIndexDecision(tm).indexable
}

/** Human-readable policy, shown in docs/SEO.md and the admin overview. */
export const RECORD_INDEX_POLICY_SUMMARY =
  'A record page is indexable only when it is a published "New Trademark Registration" notice with a mark name, an applicant, at least one Nice class, a goods/services description, a publication date and an Official Gazette number. Change notices (assignments, owner/address changes, renewals, cancellations, mergers) and incomplete records remain accessible but are noindex.'
