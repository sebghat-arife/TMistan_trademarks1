import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** UI locale → Intl locale. Afghanistan-specific tags give Afghan Solar Hijri
 *  month names (میزان, not مهر) and Afghan digit conventions. */
const INTL_LOCALE: Record<string, string> = { en: 'en-GB', fa: 'fa-AF', ps: 'ps-AF' }

function intlLocale(locale?: string): string {
  return INTL_LOCALE[locale ?? 'en'] ?? locale ?? 'en-GB'
}

/**
 * Locale-aware date. The stored value is an ISO (Gregorian) date; in Dari and
 * Pashto it is rendered in the Solar Hijri calendar as Afghan readers expect.
 * Falls back to the raw stored string if unparsable — never invents a date.
 */
export function formatDate(value: string | null | undefined, locale = 'en'): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  try {
    const parts = new Intl.DateTimeFormat(intlLocale(locale), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).formatToParts(d)
    // Drop the era designator ("AP") some locales emit for the Persian calendar.
    const out: string[] = []
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      if (p.type === 'era') {
        if (parts[i + 1]?.type === 'literal') i++
        continue
      }
      out.push(p.value)
    }
    return out.join('').trim()
  } catch {
    return value
  }
}

/** ISO form of a stored date, for title attributes / machine-readable output. */
export function isoDate(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toISOString().slice(0, 10)
}

export function formatNumber(n: number | null | undefined, locale = 'en'): string {
  if (n === null || n === undefined) return '—'
  try {
    return new Intl.NumberFormat(intlLocale(locale)).format(n)
  } catch {
    return String(n)
  }
}

/** Build /trademark/:serial (optionally with ?g=gazette for disambiguation). */
export function trademarkPath(serial: string, gazette?: string | null): string {
  const base = `/trademark/${encodeURIComponent(serial)}`
  return gazette ? `${base}?g=${encodeURIComponent(gazette)}` : base
}

export function gazettePath(gazetteNumber: string): string {
  return `/gazette/${encodeURIComponent(gazetteNumber)}`
}

/** Highlight query terms in a text node (case/diacritic-insensitive-ish). */
export function splitHighlight(text: string, query: string | null | undefined): { part: string; hit: boolean }[] {
  if (!query || !text) return [{ part: text, hit: false }]
  const terms = query
    .toLowerCase()
    .split(/[\s\-_.,;:/]+/)
    .filter((t) => t.length >= 2)
  if (terms.length === 0) return [{ part: text, hit: false }]
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig')
  return text
    .split(re)
    .filter((p) => p !== '')
    .map((part) => ({ part, hit: terms.includes(part.toLowerCase()) }))
}

export function truncate(s: string | null | undefined, n: number): string {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s
}
