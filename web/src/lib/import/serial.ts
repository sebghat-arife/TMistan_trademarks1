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

/** Length of the content-hash prefix embedded in object paths. */
export const CONTENT_SUFFIX_LENGTH = 12

/**
 * Storage object path for a matched image: `<gazette>/<serial>-<sha256 prefix>.<ext>`
 * with path-unsafe characters replaced.
 *
 * The path is derived from the trademark AND the file content, so a corrected
 * picture uploaded for the same serial number gets a NEW object path (and
 * therefore a new public URL). Overwriting the old path would keep showing the
 * old picture for as long as browsers and the Storage CDN cache it
 * (Cache-Control: max-age), and a removal of the old path queued by an earlier
 * deletion could wipe the new file. Identical bytes always map to the same
 * path, which keeps re-imports idempotent ("unchanged").
 *
 * Without a hash (legacy callers) the historical `<gazette>/<serial>.<ext>`
 * form is returned; rows created by earlier versions keep that form.
 */
export function storagePathFor(gazette: string | null, serial: string, ext: string, contentHash?: string | null): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'x'
  const hash = (contentHash ?? '').toLowerCase().replace(/[^a-f0-9]/g, '').slice(0, CONTENT_SUFFIX_LENGTH)
  const suffix = hash ? `-${hash}` : ''
  return `${safe(gazette ?? 'unsorted')}/${safe(serial)}${suffix}.${ext}`
}
