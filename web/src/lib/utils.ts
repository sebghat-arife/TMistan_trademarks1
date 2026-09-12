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
 * Registry dates are recorded exactly as printed in the Official Gazette — in
 * the Afghan Solar Hijri calendar (e.g. "1389-12-29"). A year below 1500 is
 * therefore Solar Hijri; anything else is treated as Gregorian. Mirrors
 * public.to_gregorian_date() in the database.
 */
export function parseRegistryDate(value: string | null | undefined): { gregorian: Date; solar: { y: number; m: number; d: number } | null } | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : { gregorian: d, solar: null }
  }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 1500) {
    const g = solarHijriToGregorian(y, mo, d)
    return g ? { gregorian: g, solar: { y, m: mo, d } } : null
  }
  const g = new Date(Date.UTC(y, mo - 1, d))
  return Number.isNaN(g.getTime()) ? null : { gregorian: g, solar: null }
}

/** Solar Hijri (Jalali) → Gregorian, same algorithm as the SQL function. */
export function solarHijriToGregorian(jy: number, jm: number, jd: number): Date | null {
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return null
  const y = jy + 1595
  let days = -355668 + 365 * y + Math.floor(y / 33) * 8 + Math.floor(((y % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186)
  let gy = 400 * Math.floor(days / 146097)
  days %= 146097
  if (days > 36524) {
    days -= 1
    gy += 100 * Math.floor(days / 36524)
    days %= 36524
    if (days >= 365) days += 1
  }
  gy += 4 * Math.floor(days / 1461)
  days %= 1461
  if (days > 365) {
    gy += Math.floor((days - 1) / 365)
    days = (days - 1) % 365
  }
  let gd = days + 1
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0
  const sal = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  let gm = 1
  while (gm <= 12 && gd > sal[gm]) {
    gd -= sal[gm]
    gm += 1
  }
  return new Date(Date.UTC(gy, gm - 1, gd))
}

/**
 * Locale-aware date. In English the Gregorian equivalent is shown with the
 * original Solar Hijri value in brackets (the registry is Afghan, readers
 * expect both); in Dari/Pashto the Solar Hijri calendar is used natively.
 * Falls back to the raw stored string if unparsable — never invents a date.
 */
export function formatDate(value: string | null | undefined, locale = 'en'): string {
  if (!value) return '—'
  const parsed = parseRegistryDate(value)
  if (!parsed) return value
  try {
    const parts = new Intl.DateTimeFormat(intlLocale(locale), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).formatToParts(parsed.gregorian)
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
    const text = out.join('').trim()
    if (parsed.solar && (locale ?? 'en').startsWith('en')) {
      return `${text} (${parsed.solar.y}/${String(parsed.solar.m).padStart(2, '0')}/${String(parsed.solar.d).padStart(2, '0')} SH)`
    }
    return text
  } catch {
    return value
  }
}

/** ISO (Gregorian) form of a stored date, for title attributes / machine-readable output. */
export function isoDate(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = parseRegistryDate(value)
  return parsed ? parsed.gregorian.toISOString().slice(0, 10) : value
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
