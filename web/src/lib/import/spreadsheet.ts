/**
 * Spreadsheet parsing + column mapping for the Admin Import Center.
 *
 * Runs entirely in the browser (SheetJS). Produces rows keyed by the
 * `public.trademarks` column names understood by the
 * `admin_import_trademark_rows` database function. Nothing here talks to
 * Supabase; see services/import_service.ts for that.
 */
import { solarHijriToGregorian } from '@/lib/utils'
import { asciiDigits, cleanSerial, cleanText, isoFromDate } from './serial'

export { asciiDigits, cleanSerial, cleanText }

/** Columns the importer may write (mirrors the whitelist in migration 0400). */
export const TRADEMARK_COLUMNS = [
  'serial_number',
  'official_gazette_number',
  'record_number',
  'mark_name',
  'mark_print',
  'applicant_name',
  'applicant_address',
  'trademark_class',
  'goods_and_services',
  'application_type',
  'attorney_or_representative',
  'publication_date',
  'objection_deadline',
  'new_address',
  'old_address',
  'new_owner',
  'old_owner',
  'source_page',
  'review_note',
  'source_row',
] as const

export type TrademarkColumn = (typeof TRADEMARK_COLUMNS)[number]

/** Header aliases (already normalised: lower-case, letters/digits only). */
const HEADER_ALIASES: Record<TrademarkColumn, string[]> = {
  serial_number: ['serialnumber', 'serial', 'serialno', 'serialnum', 'sn', 'شمارهمسلسل', 'شمارهسریال', 'مسلسل', 'سریال', 'سریالنمبر', 'شمیرهسریال', 'سیریلنمبر'],
  official_gazette_number: ['officialgazettenumber', 'gazettenumber', 'gazetteno', 'gazette', 'officialgazette', 'gazettenum', 'شمارهجریده', 'جریدهرسمی', 'شمارهجریدهرسمی', 'جریده', 'دجریدېشمېره'],
  record_number: ['recordnumber', 'recordno', 'record', 'no', 'number', 'num', 'شماره', 'شمارهثبت', 'نمبر', 'ثبت'],
  mark_name: ['markname', 'mark', 'trademark', 'trademarkname', 'name', 'brand', 'brandname', 'نامعلامت', 'علامتتجارتی', 'نامتجارتی', 'علامت', 'نشانتجارتی', 'دنښېنوم'],
  mark_print: ['markprint', 'markasprinted', 'asprinted', 'print', 'markprinted', 'طبع', 'علامتطبعشده', 'شکلعلامت'],
  applicant_name: ['applicantname', 'applicant', 'owner', 'ownername', 'company', 'proprietor', 'holder', 'نامدرخواستکننده', 'درخواستکننده', 'متقاضی', 'مالک', 'نامشرکت', 'دغوښتونکینوم', 'غوښتونکی'],
  applicant_address: ['applicantaddress', 'address', 'owneraddress', 'companyaddress', 'آدرس', 'ادرس', 'آدرسدرخواستکننده', 'نشانی', 'پته'],
  trademark_class: ['trademarkclass', 'class', 'classes', 'niceclass', 'classno', 'classnumber', 'صنف', 'صنفعلامت', 'طبقه', 'کلاس', 'ټولګی'],
  goods_and_services: ['goodsandservices', 'goodsservices', 'goods', 'services', 'products', 'goodsservice', 'اجناسوخدمات', 'اجناس', 'خدمات', 'کالاها', 'کالاهاوخدمات', 'توکيخدمتونه'],
  application_type: ['applicationtype', 'type', 'apptype', 'requesttype', 'kind', 'نوعدرخواست', 'نوع', 'نوعیت', 'دغوښتنېډول'],
  attorney_or_representative: ['attorneyorrepresentative', 'attorney', 'representative', 'agent', 'attorneyrepresentative', 'lawyer', 'وکیل', 'نماینده', 'وکیلیانماینده', 'استازی'],
  publication_date: ['publicationdate', 'published', 'publishdate', 'datepublished', 'date', 'pubdate', 'تاریخنشر', 'تاریخ', 'تاریخانتشار', 'دخپرېدونېټه', 'نېټه'],
  objection_deadline: ['objectiondeadline', 'objection', 'deadline', 'oppositiondeadline', 'objectiondate', 'مهلتاعتراض', 'اعتراض', 'ضربالاجل', 'داعتراضنېټه'],
  new_address: ['newaddress', 'آدرسجدید', 'ادرسجدید', 'نویپته'],
  old_address: ['oldaddress', 'previousaddress', 'آدرسقبلی', 'ادرسقبلی', 'پخوانیپته'],
  new_owner: ['newowner', 'newownername', 'مالکجدید', 'نویمالک'],
  old_owner: ['oldowner', 'previousowner', 'مالکقبلی', 'پخوانیمالک'],
  source_page: ['sourcepage', 'page', 'pageno', 'pagenumber', 'صفحه', 'مخ'],
  review_note: ['reviewnote', 'note', 'notes', 'remark', 'remarks', 'comment', 'comments', 'ملاحظات', 'یادداشت', 'یادښت'],
  source_row: ['sourcerow', 'row', 'rowno', 'rownumber', 'سطر', 'کرښه'],
}

/** Lower-case, strip everything except letters/digits (Latin + Arabic script). */
export function normalizeHeader(h: unknown): string {
  return String(h ?? '')
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[يك]/g, (c) => (c === 'ي' ? 'ی' : 'ک'))
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

export type ColumnMapping = Record<TrademarkColumn, string | null>

/** Map raw header names to trademark columns. Exact header match wins; each target used once. */
export function mapColumns(headers: string[]): { mapping: ColumnMapping; unmapped: string[] } {
  const mapping = Object.fromEntries(TRADEMARK_COLUMNS.map((c) => [c, null])) as ColumnMapping
  const used = new Set<string>()
  const norm = headers.map((h) => ({ raw: h, key: normalizeHeader(h) }))

  // pass 1: header equals the column name itself (e.g. "serial_number")
  for (const col of TRADEMARK_COLUMNS) {
    const hit = norm.find((h) => !used.has(h.raw) && h.key === normalizeHeader(col))
    if (hit) {
      mapping[col] = hit.raw
      used.add(hit.raw)
    }
  }
  // pass 2: aliases, in priority order per column
  for (const col of TRADEMARK_COLUMNS) {
    if (mapping[col]) continue
    for (const alias of HEADER_ALIASES[col]) {
      const hit = norm.find((h) => !used.has(h.raw) && h.key === alias)
      if (hit) {
        mapping[col] = hit.raw
        used.add(hit.raw)
        break
      }
    }
  }
  return { mapping, unmapped: headers.filter((h) => !used.has(h)) }
}

export interface ParsedSheet {
  fileName: string
  sheetName: string
  sheetNames: string[]
  headers: string[]
  /** Raw cell values per row, keyed by header. */
  rawRows: Record<string, unknown>[]
  /** 1-based spreadsheet row number of each raw row (header row excluded). */
  rowNumbers: number[]
}

const SUPPORTED_EXT = /\.(xlsx|xlsm|xls|csv|tsv|ods)$/i

export function isSpreadsheetFile(name: string): boolean {
  return SUPPORTED_EXT.test(name)
}

/** Parse the first non-empty sheet (or `preferredSheet`) of an Excel/CSV file. */
export async function parseSpreadsheet(file: File, preferredSheet?: string): Promise<ParsedSheet> {
  if (!isSpreadsheetFile(file.name)) throw new Error(`Unsupported file type: ${file.name}. Use .xlsx, .xls or .csv.`)
  const buf = await file.arrayBuffer()
  const XLSX = await import('xlsx') // loaded on demand — only the Import Center pays for it
  // CSV/TSV are decoded here as UTF-8 (BOM-tolerant) and kept as plain text
  // (`raw`), otherwise SheetJS would turn Solar Hijri dates such as 1389-06-31
  // into (invalid) Gregorian Date objects.
  const plainText = /\.(csv|tsv)$/i.test(file.name)
  const wb = plainText
    ? XLSX.read(new TextDecoder('utf-8').decode(buf), { type: 'string', raw: true })
    : XLSX.read(buf, { type: 'array', cellDates: true })
  if (!wb.SheetNames.length) throw new Error('The workbook contains no sheets.')

  const pick = (name: string) => {
    const ws = wb.Sheets[name]
    const rows = ws ? (XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false, raw: true }) as unknown[][]) : []
    return { name, rows }
  }
  let chosen = preferredSheet && wb.SheetNames.includes(preferredSheet) ? pick(preferredSheet) : null
  if (!chosen) {
    // First sheet that has a header row and at least one data row; else the first sheet.
    chosen = wb.SheetNames.map(pick).find((s) => s.rows.length >= 2) ?? pick(wb.SheetNames[0])
  }
  const matrix = chosen.rows
  if (matrix.length === 0) throw new Error(`Sheet "${chosen.name}" is empty.`)

  // Header row = first row with at least 2 non-empty cells.
  let headerIdx = matrix.findIndex((r) => r.filter((c) => c !== null && String(c).trim() !== '').length >= 2)
  if (headerIdx < 0) headerIdx = 0
  const headerCells = matrix[headerIdx].map((c) => String(c ?? '').trim())
  const headers: string[] = []
  const seen = new Map<string, number>()
  headerCells.forEach((h, i) => {
    let name = h || `Column ${i + 1}`
    const n = seen.get(name) ?? 0
    if (n > 0) name = `${name} (${n + 1})`
    seen.set(h || `Column ${i + 1}`, n + 1)
    headers.push(name)
  })

  const rawRows: Record<string, unknown>[] = []
  const rowNumbers: number[] = []
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const cells = matrix[r]
    if (!cells || cells.every((c) => c === null || String(c).trim() === '')) continue
    const obj: Record<string, unknown> = {}
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? null
    })
    rawRows.push(obj)
    rowNumbers.push(r + 1)
  }
  return { fileName: file.name, sheetName: chosen.name, sheetNames: wb.SheetNames, headers, rawRows, rowNumbers }
}

/* ------------------------------------------------------------------------- */
/* Cell normalisation                                                        */
/* ------------------------------------------------------------------------- */

/**
 * Registry dates are stored as `date` and are Solar Hijri when the year is
 * < 1500 (the database converts for filtering). Accepts 1389-01-31,
 * 1389/1/31, 31/01/1389, 2010-04-20, Excel dates and Persian digits.
 * Returns an ISO string or `{ error }`.
 */
export function cleanDate(v: unknown): { value: string | null; error?: string; warning?: string } {
  if (v === null || v === undefined || v === '') return { value: null }
  if (v instanceof Date) return isNaN(v.getTime()) ? { value: null, error: 'invalid date' } : { value: isoFromDate(v) }
  const s = asciiDigits(String(v)).trim()
  if (!s) return { value: null }
  let y: number | undefined
  let m: number | undefined
  let d: number | undefined
  let mt = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s)
  if (mt) {
    y = +mt[1]; m = +mt[2]; d = +mt[3]
  } else if ((mt = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) {
    d = +mt[1]; m = +mt[2]; y = +mt[3]
  } else if (/^\d{5}(\.\d+)?$/.test(s)) {
    // Excel serial number
    const dt = new Date(Math.round((parseFloat(s) - 25569) * 86400 * 1000))
    return { value: isoFromDate(new Date(dt.getTime() + dt.getTimezoneOffset() * 60000)) }
  } else {
    const dt = new Date(s)
    if (!isNaN(dt.getTime()) && /[a-z]/i.test(s)) return { value: isoFromDate(dt) }
    return { value: null, error: `unrecognised date "${String(v)}"` }
  }
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return { value: null, error: `invalid date "${String(v)}"` }
  if (y < 1500) {
    // Solar Hijri: months 1–6 have 31 days, 7–11 have 30, month 12 has 29 (30 in leap years).
    if ((m <= 6 && d > 31) || (m > 6 && d > 30) || (m === 12 && d === 30 && !isSolarLeap(y))) return { value: null, error: `invalid Solar Hijri date "${String(v)}"` }
    // The registry keeps Solar Hijri dates verbatim in a Gregorian `date` column. Day 31 of
    // months 2/4/6 (and 12/30) has no Gregorian slot, so those few are stored as the exact
    // Gregorian equivalent; the UI shows both calendars either way.
    const gregorianMonthLength = new Date(Date.UTC(y, m, 0)).getUTCDate() // month `m` of (proleptic) year `y`
    if (d > gregorianMonthLength) {
      const g = solarHijriToGregorian(y, m, d)
      if (!g) return { value: null, error: `invalid Solar Hijri date "${String(v)}"` }
      const iso = g.toISOString().slice(0, 10)
      return { value: iso, warning: `${String(v)} (Solar Hijri) has no Gregorian calendar slot — stored as ${iso}` }
    }
  } else if (y > 2200) {
    return { value: null, error: `implausible year in "${String(v)}"` }
  } else if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) {
    return { value: null, error: `invalid date "${String(v)}"` }
  }
  return { value: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
}

/** Solar Hijri leap year — derived from the app's own converter so it can never disagree with the database. */
function isSolarLeap(jy: number): boolean {
  const a = solarHijriToGregorian(jy, 1, 1)
  const b = solarHijriToGregorian(jy + 1, 1, 1)
  return !!a && !!b && Math.round((b.getTime() - a.getTime()) / 86_400_000) === 366
}

export function cleanInt(v: unknown): { value: number | null; error?: string } {
  const s = cleanText(v)
  if (!s) return { value: null }
  const n = Number(asciiDigits(s).replace(/[^\d.-]/g, ''))
  if (!Number.isFinite(n)) return { value: null, error: `"${s}" is not a number` }
  return { value: Math.trunc(n) }
}

/* ------------------------------------------------------------------------- */
/* Validation                                                                */
/* ------------------------------------------------------------------------- */

export type ImportRow = Partial<Record<TrademarkColumn, string | number | null>> & {
  serial_number: string
  source_row: number
}

export interface RowIssue {
  row: number
  serial: string | null
  level: 'error' | 'warning'
  message: string
}

export interface ValidationResult {
  rows: ImportRow[]
  issues: RowIssue[]
  errors: number
  warnings: number
  /** Serials appearing more than once in the file (first occurrence kept). */
  duplicateSerials: string[]
  mappedColumns: TrademarkColumn[]
  missingRequired: TrademarkColumn[]
}

export const REQUIRED_COLUMNS: TrademarkColumn[] = ['serial_number']
export const RECOMMENDED_COLUMNS: TrademarkColumn[] = ['mark_name', 'applicant_name']

/**
 * Convert raw rows into import rows and collect every problem BEFORE anything
 * is sent to the database. Rows with errors are excluded from `rows`.
 */
export function validateRows(sheet: ParsedSheet, mapping: ColumnMapping, opts: { sourceFile: string }): ValidationResult {
  const issues: RowIssue[] = []
  const rows: ImportRow[] = []
  const missingRequired = REQUIRED_COLUMNS.filter((c) => !mapping[c])
  const mappedColumns = TRADEMARK_COLUMNS.filter((c) => !!mapping[c])
  if (missingRequired.length) {
    return { rows: [], issues, errors: 0, warnings: 0, duplicateSerials: [], mappedColumns, missingRequired }
  }
  const seen = new Map<string, number>()
  const duplicateSerials = new Set<string>()

  sheet.rawRows.forEach((raw, i) => {
    const rowNo = sheet.rowNumbers[i]
    const get = (c: TrademarkColumn) => (mapping[c] ? raw[mapping[c] as string] : undefined)
    const serial = cleanSerial(get('serial_number'))
    const push = (level: RowIssue['level'], message: string) => issues.push({ row: rowNo, serial, level, message })

    if (!serial) {
      push('error', 'Serial number is empty')
      return
    }
    if (!/\d/.test(serial)) {
      push('error', `Serial number "${serial}" contains no digits`)
      return
    }
    if (serial.length > 40) {
      push('error', `Serial number "${serial.slice(0, 20)}…" is too long`)
      return
    }
    const first = seen.get(serial)
    if (first !== undefined) {
      duplicateSerials.add(serial)
      push('error', `Duplicate serial number (first seen on row ${first})`)
      return
    }
    seen.set(serial, rowNo)

    const row: ImportRow = { serial_number: serial, source_row: rowNo }
    let bad = false
    for (const col of mappedColumns) {
      if (col === 'serial_number' || col === 'source_row') continue
      const v = get(col)
      if (col === 'publication_date' || col === 'objection_deadline') {
        const r = cleanDate(v)
        if (r.error) {
          push('error', `${col.replace(/_/g, ' ')}: ${r.error}`)
          bad = true
        } else if (r.warning) push('warning', `${col.replace(/_/g, ' ')}: ${r.warning}`)
        row[col] = r.value
      } else if (col === 'official_gazette_number') {
        const g = cleanSerial(v)
        row[col] = g
      } else {
        row[col] = cleanText(v)
      }
    }
    // gazette derived from the serial when the file has no gazette column
    if (!row.official_gazette_number) {
      const m = /^\D*(\d+)\D/.exec(serial)
      if (m) row.official_gazette_number = m[1]
      else {
        push('error', 'No gazette number and it cannot be derived from the serial number')
        bad = true
      }
    }
    if (!row.mark_name && mapping.mark_name) push('warning', 'Mark name is empty')
    if (mapping.source_row === null) row.source_row = rowNo
    else {
      const r = cleanInt(get('source_row'))
      row.source_row = r.value ?? rowNo
    }
    if (bad) return
    rows.push(row)
  })

  // Every row gets provenance.
  for (const r of rows) {
    ;(r as Record<string, unknown>).source_file = opts.sourceFile
    ;(r as Record<string, unknown>).source_sheet = sheet.sheetName
  }
  const errors = issues.filter((i) => i.level === 'error').length
  const warnings = issues.length - errors
  return { rows, issues, errors, warnings, duplicateSerials: [...duplicateSerials], mappedColumns, missingRequired }
}

/** Build a CSV string (UTF-8 with BOM so Excel opens it correctly). */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '\ufeff' + [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
