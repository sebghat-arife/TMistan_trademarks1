/**
 * Serial-number / cell text helpers shared by the spreadsheet and image
 * importers. Deliberately dependency-free so the public bundle stays small.
 */
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'

/** Convert Arabic-Indic / Persian digits to ASCII. */
export function asciiDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => String(ARABIC_DIGITS.indexOf(d) % 10))
}

export function isoFromDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function cleanText(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return isoFromDate(v)
  const s = String(v).replace(/\u00a0/g, ' ').trim()
  return s === '' ? null : s
}

/** Canonical serial text: trimmed, ASCII digits, inner whitespace collapsed, unicode dashes → "-". */
export function cleanSerial(v: unknown): string | null {
  const s = cleanText(v)
  if (!s) return null
  return asciiDigits(s)
    .replace(/[\u2010-\u2015\u2212\u02d7\ufe58\ufe63\uff0d]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
}

/**
 * Storage object path for a matched image. Deterministic per trademark so a
 * re-upload of the same trademark's logo overwrites (upsert) instead of piling
 * up: `<gazette>/<serial>.<ext>` with path-unsafe characters replaced.
 */
export function storagePathFor(gazette: string | null, serial: string, ext: string): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'x'
  return `${safe(gazette ?? 'unsorted')}/${safe(serial)}.${ext}`
}
