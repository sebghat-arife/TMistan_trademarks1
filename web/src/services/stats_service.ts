import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { FilterOptions, RegistryStats } from '@/lib/database.types'
import { unwrap } from './_shared'

/* ---------------------------------------------------------------------------
 * Statistics service — dashboard/home numbers, all aggregated in SQL:
 *   registry_stats()          totals (trademarks, applicants, gazettes, images, needs_review…)
 *   trademarks_by_class()     distribution across Nice classes
 *   trademark_filter_options() distinct classes / gazettes / application types with counts
 * ------------------------------------------------------------------------- */

export async function getRegistryStats(): Promise<RegistryStats> {
  return unwrap(await supabase.rpc('registry_stats')) as RegistryStats
}

export const registryStatsQuery = () =>
  queryOptions({ queryKey: ['stats', 'registry'], queryFn: getRegistryStats, staleTime: 60_000 })

export async function getTrademarksByClass(): Promise<{ class: number; count: number }[]> {
  return (unwrap(await supabase.rpc('trademarks_by_class')) ?? []) as { class: number; count: number }[]
}

export const trademarksByClassQuery = () =>
  queryOptions({ queryKey: ['stats', 'by_class'], queryFn: getTrademarksByClass, staleTime: 5 * 60_000 })

export async function getFilterOptions(): Promise<FilterOptions> {
  return unwrap(await supabase.rpc('trademark_filter_options')) as FilterOptions
}

export const filterOptionsQuery = () =>
  queryOptions({ queryKey: ['stats', 'filter_options'], queryFn: getFilterOptions, staleTime: 5 * 60_000 })

/* ---------------------------------------------------------------------------
 * Record-type totals for the home page ("TMistan at a Glance").
 *
 * The gazette publishes several kinds of notice and the Import Center stores
 * the notice type verbatim in `trademarks.application_type` — the wording is
 * whatever the source spreadsheet used ("New Trademark Registration",
 * "Trademark Renewal", "Assignment", "Owner Name / Address change",
 * "Cancellation", …). `trademark_filter_options()` returns every distinct
 * value with its published-row count, and the home page shows EVERY one of
 * them: nothing is hard-coded and a notice type can never be dropped because
 * its wording changed. Keyword rules only decide the icon and the translated
 * label; a value no rule recognises is shown under its own (verbatim) name.
 * Each value lands in exactly one group, so the groups add up to the total.
 * ------------------------------------------------------------------------- */

export type RecordTypeKind =
  | 'registration'
  | 'renewal'
  | 'assignment'
  | 'name_change'
  | 'address_change'
  | 'name_address_change'
  | 'cancellation'
  | 'other'

export type RecordTypeStat = {
  /** Stable key: the kind, or `other:<value>` for a notice type no rule recognises. */
  key: string
  kind: RecordTypeKind
  /** Published rows across the notice types grouped here (always from the database). */
  count: number
  /** The exact `application_type` values (as stored) that make up this figure. */
  values: string[]
}

const KIND_ORDER: RecordTypeKind[] = ['registration', 'renewal', 'assignment', 'name_change', 'address_change', 'name_address_change', 'cancellation', 'other']

/** Best-effort classification of a notice-type value (English, Dari or Pashto wording). Affects label/icon only. */
export function classifyApplicationType(value: string): RecordTypeKind {
  const v = value.trim().toLowerCase()
  if (!v) return 'other'
  if (/cancel|withdraw|revok|invalidat|removal|remove|delet|abandon|فسخ|لغو|ابطال/.test(v)) return 'cancellation'
  if (/renew|تجدید|تمدید|نوي کول|نوی کول/.test(v)) return 'renewal'
  if (/assign|transfer|merger|انتقال|واگذاری|لېږد/.test(v)) return 'assignment'
  const name = /\bname\b|نام|نوم/.test(v)
  const address = /address|آدرس|نشانی|پته|پتې/.test(v)
  if (name && address) return 'name_address_change'
  if (name) return 'name_change'
  if (address) return 'address_change'
  if (/regist|new trademark|application|filing|ثبت|درخواست|غوښتن/.test(v)) return 'registration'
  return 'other'
}

/** One entry per notice type present in the database (count > 0), in registry order; same-meaning spellings are grouped. */
export function deriveRecordTypeStats(types: FilterOptions['application_types'] | undefined): RecordTypeStat[] {
  const groups = new Map<string, RecordTypeStat>()
  for (const { value, count } of types ?? []) {
    if (!value?.trim() || !(count > 0)) continue
    const kind = classifyApplicationType(value)
    const key = kind === 'other' ? `other:${value.trim()}` : kind
    const g = groups.get(key) ?? { key, kind, count: 0, values: [] }
    g.count += count
    g.values.push(value)
    groups.set(key, g)
  }
  return [...groups.values()].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.count - a.count || a.key.localeCompare(b.key),
  )
}
