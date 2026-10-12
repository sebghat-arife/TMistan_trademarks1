/**
 * "Download Record" → a real PDF file (TMistan Trademark Publication Report).
 *
 * This module is loaded lazily (dynamic import) from the trademark page so the
 * PDF engine (@react-pdf/renderer, ~1 MB) is only fetched when a user actually
 * downloads a report. Rendering happens entirely in the browser: no server, no
 * third-party service, no data leaves the user's device.
 *
 * Content policy: the report shows exactly the recorded fields of the published
 * record (N/A when a value is not recorded), the approved disclaimer and the
 * canonical record link. Nothing is invented.
 *
 * Fonts: self-hosted TTFs in /public/fonts (Inter for Latin text, Noto Naskh
 * Arabic for Dari/Pashto/Arabic script). The PDF engine applies Arabic shaping
 * and the Unicode bidi algorithm, so text stays selectable and searchable.
 */
import { Document, Font, Image, Link, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer'
import type { Style } from '@react-pdf/stylesheet'

/* ── Fonts ─────────────────────────────────────────────────────────────── */

const base = import.meta.env.BASE_URL.replace(/\/?$/, '/')
const LATIN = 'Inter'
const ARABIC = 'NotoNaskhArabic'

let fontsRegistered = false
export function registerFonts() {
  if (fontsRegistered) return
  fontsRegistered = true
  Font.register({
    family: LATIN,
    fonts: [
      { src: `${base}fonts/Inter-Regular.ttf`, fontWeight: 400 },
      { src: `${base}fonts/Inter-SemiBold.ttf`, fontWeight: 600 },
      { src: `${base}fonts/Inter-Bold.ttf`, fontWeight: 700 },
    ],
  })
  Font.register({
    family: ARABIC,
    fonts: [
      { src: `${base}fonts/NotoNaskhArabic-Regular.ttf`, fontWeight: 400 },
      { src: `${base}fonts/NotoNaskhArabic-Bold.ttf`, fontWeight: 700 },
    ],
  })
  // Never hyphenate (names, serials and addresses must not be split).
  Font.registerHyphenationCallback((word) => [word])
}

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/
const STRONG_RE = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]|[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/

function hasArabic(s: string) {
  return ARABIC_RE.test(s)
}

/**
 * Base direction of a string. In a Dari/Pashto document any text containing Arabic script is laid
 * out right-to-left even when it starts with a Latin word ("TMistan پلتفرمی … است." must end with the
 * full stop on the left); otherwise the first strong character decides (CSS `unicode-bidi: plaintext`).
 */
function directionOf(s: string, fallback: 'ltr' | 'rtl'): 'ltr' | 'rtl' {
  if (fallback === 'rtl' && ARABIC_RE.test(s)) return 'rtl'
  const m = STRONG_RE.exec(s)
  if (!m) return fallback
  return ARABIC_RE.test(m[0]) ? 'rtl' : 'ltr'
}

/* ── Types ─────────────────────────────────────────────────────────────── */

export type ReportRow = { label: string; value: string }

export type ReportInput = {
  /** Document direction follows the UI language (fa/ps → rtl). */
  dir: 'ltr' | 'rtl'
  /** Translated UI strings used in the document chrome. */
  labels: {
    platformName: string
    tagline: string
    documentTitle: string
    generated: string
    serial: string
    source: string
    details: string
    image: string
    imageUnavailable: string
    disclaimerTitle: string
    recordLink: string
    page: (n: number, total: number) => string
  }
  markName: string
  serial: string
  sourceLine: string
  rows: ReportRow[]
  /** Exact, approved disclaimer text — printed verbatim before the record link. */
  disclaimer: string
  /** Canonical public URL of the record. */
  link: string
  /** PNG data URL of the TMistan logo (optional). */
  logo?: string | null
  /** PNG data URL of the trademark image (optional) + whether an image exists but failed to load. */
  image?: { dataUrl: string; width: number; height: number } | null
  imageFailed?: boolean
  fileName: string
}

/* ── Styles ────────────────────────────────────────────────────────────── */

const NAVY = '#0f2a4a'
const INK = '#1f2937'
const MUTED = '#6b7280'
const RULE = '#d1d5db'
const SOFT = '#f3f4f6'

const s = StyleSheet.create({
  // NB: no unitless `lineHeight` on the page — @react-pdf/layout compounds an inherited unitless
  // line height on every relayout of dynamic (render-prop) nodes, pushing page numbers off the page.
  page: { paddingTop: 44, paddingBottom: 60, paddingHorizontal: 48, fontSize: 10.5, color: INK },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingBottom: 12, borderBottomWidth: 1.5, borderBottomColor: NAVY },
  headerLeft: { flex: 1, paddingRight: 16 },
  headerRight: { width: 190, flexShrink: 0 },
  logo: { width: 92, height: 44, objectFit: 'contain', objectPositionX: 0 },
  brand: { fontSize: 18, fontWeight: 700, color: NAVY },
  tagline: { fontSize: 8, color: MUTED, marginTop: 4 },
  docTitle: { fontSize: 10.5, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.3 },
  generated: { fontSize: 8.5, color: MUTED, marginTop: 3 },
  top: { flexDirection: 'row', gap: 20, marginTop: 20, alignItems: 'flex-start' },
  titleBlock: { flex: 1 },
  mark: { fontSize: 22, fontWeight: 700, color: NAVY, lineHeight: 1.25 },
  figure: { width: 170, minHeight: 110, borderWidth: 1, borderColor: RULE, borderRadius: 4, padding: 8, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  figureImg: { maxWidth: 152, maxHeight: 120, objectFit: 'contain' },
  figureCaption: { fontSize: 7.5, color: MUTED, marginTop: 5 },
  sectionTitle: { fontSize: 9.5, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 22, marginBottom: 6 },
  table: { borderTopWidth: 1, borderTopColor: RULE },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: RULE },
  rowAlt: { backgroundColor: SOFT },
  cellLabel: { width: 150, paddingVertical: 5, paddingHorizontal: 8 },
  cellValue: { flex: 1, paddingVertical: 5, paddingHorizontal: 8 },
  disclaimer: { backgroundColor: SOFT, padding: 10, borderRadius: 4 },
  link: { fontSize: 9.5, marginTop: 8, color: NAVY, textDecoration: 'none' },
  footerRule: { position: 'absolute', left: 48, right: 48, bottom: 40, borderTopWidth: 0.75, borderTopColor: RULE },
  footerLeft: { position: 'absolute', left: 48, right: 48, bottom: 26, fontSize: 7.5, color: MUTED },
  footerRight: { position: 'absolute', left: 48, right: 48, bottom: 26, fontSize: 7.5, color: MUTED },
})

/* ── Text helper (script-aware font + direction) ───────────────────────── */

function T({ children, style, dir, weight }: { children: string; style?: Style | Style[]; dir: 'ltr' | 'rtl'; weight?: 400 | 600 | 700 }) {
  const text = children ?? ''
  const arabic = hasArabic(text)
  const direction = directionOf(text, dir)
  const fontFamily = arabic ? ARABIC : LATIN
  const fontWeight = weight ? (arabic && weight === 600 ? 700 : weight) : undefined
  const textAlign = dir === 'rtl' ? 'right' : 'left'
  const styles = Array.isArray(style) ? style : style ? [style] : []
  // Tracking (letterSpacing) and uppercase are Latin-only devices: Arabic script is cursive, spacing
  // its letters breaks the joins. Neutralise both for Arabic text whatever the base style says.
  const arabicReset: Style[] = arabic ? [{ letterSpacing: 0, textTransform: 'none' }] : []
  return <Text style={[{ fontFamily, textAlign, lineHeight: 1.45 }, ...styles, ...arabicReset, { direction }, ...(fontWeight ? [{ fontWeight }] : [])]}>{text}</Text>
}

/* ── Document ──────────────────────────────────────────────────────────── */

export function TrademarkReportDocument({ input }: { input: ReportInput }) {
  const { dir, labels } = input
  const rowDir = dir === 'rtl' ? 'row-reverse' : 'row'
  const docFont = dir === 'rtl' ? ARABIC : LATIN

  return (
    <Document
      title={`${labels.documentTitle} — ${input.markName} (${input.serial})`}
      author={labels.platformName}
      subject={input.sourceLine}
      creator={labels.platformName}
      producer={labels.platformName}
      language={dir === 'rtl' ? 'fa' : 'en'}
    >
      <Page size="A4" style={[s.page, { fontFamily: docFont }]}>
        {/* Header */}
        <View style={[s.header, { flexDirection: rowDir }]} fixed>
          <View style={s.headerLeft}>
            {input.logo ? <Image src={input.logo} style={s.logo} /> : <Text style={[s.brand, { fontFamily: LATIN }]}>{labels.platformName}</Text>}
            <T dir={dir} style={s.tagline}>{labels.tagline}</T>
          </View>
          <View style={s.headerRight}>
            <T dir={dir} style={[s.docTitle, { textAlign: dir === 'rtl' ? 'left' : 'right' }]} weight={700}>{labels.documentTitle}</T>
            <T dir={dir} style={[s.generated, { textAlign: dir === 'rtl' ? 'left' : 'right' }]}>{labels.generated}</T>
          </View>
        </View>

        {/* Title block + image */}
        <View style={[s.top, { flexDirection: rowDir }]}>
          <View style={s.titleBlock}>
            {/* Only the mark name is repeated here — serial number, gazette number and source are listed once, in the details table. */}
            <T dir={dir} style={s.mark} weight={700}>{input.markName}</T>
          </View>
          {(input.image || input.imageFailed) && (
            <View style={s.figure}>
              {input.image ? (
                <Image src={input.image.dataUrl} style={s.figureImg} />
              ) : (
                <T dir={dir} style={s.figureCaption}>{labels.imageUnavailable}</T>
              )}
              {input.image && <T dir={dir} style={s.figureCaption}>{labels.image}</T>}
            </View>
          )}
        </View>

        {/* Details table */}
        <T dir={dir} style={s.sectionTitle} weight={700}>{labels.details}</T>
        <View style={s.table}>
          {input.rows.map((r, i) => (
            <View key={`${r.label}-${i}`} style={[s.row, { flexDirection: rowDir }, ...(i % 2 ? [s.rowAlt] : [])]} wrap={false}>
              <View style={s.cellLabel}>
                <T dir={dir} style={{ fontSize: 9.5, color: MUTED, lineHeight: 1.35 }} weight={600}>{r.label}</T>
              </View>
              <View style={s.cellValue}>
                <T dir={dir} style={{ fontSize: 10.5, lineHeight: 1.35 }}>{r.value}</T>
              </View>
            </View>
          ))}
        </View>

        {/* Disclaimer (verbatim) — always before the record link */}
        <View>
          <View minPresenceAhead={60}>
            <T dir={dir} style={s.sectionTitle} weight={700}>{labels.disclaimerTitle}</T>
          </View>
          <View style={s.disclaimer}>
            <T dir="ltr" style={{ fontSize: 8.8, lineHeight: 1.5 }}>{input.disclaimer}</T>
          </View>
          <View style={{ flexDirection: rowDir, flexWrap: 'wrap', marginTop: 8, alignItems: 'baseline' }} wrap={false}>
            <T dir={dir} style={{ fontSize: 9.5, color: MUTED }}>{`${labels.recordLink}: `}</T>
            <Link src={input.link} style={[s.link, { marginTop: 0, fontFamily: LATIN }]}>
              {input.link}
            </Link>
          </View>
        </View>

        {/* Footer (repeated on every page) */}
        <View style={s.footerRule} fixed />
        <Text style={[s.footerLeft, { fontFamily: dir === 'rtl' ? ARABIC : LATIN, textAlign: dir === 'rtl' ? 'right' : 'left' }]} fixed>
          {`${labels.platformName} — ${labels.documentTitle}`}
        </Text>
        {/* NB: a dynamic (render-prop) node must receive a single flat style object. */}
        <Text style={{ ...s.footerRight, fontFamily: LATIN, textAlign: dir === 'rtl' ? 'left' : 'right' }} render={({ pageNumber, totalPages }) => labels.page(pageNumber, totalPages)} fixed />
      </Page>
    </Document>
  )
}

/* ── Image helpers ─────────────────────────────────────────────────────── */

/**
 * Fetch an image and re-encode it as a PNG data URL via a canvas. This accepts
 * any format the browser can decode (PNG, JPEG, WebP, GIF…), flattens alpha
 * on white (gazette crops are printed on white) and caps the size so the PDF
 * stays small. Returns null when the image cannot be loaded.
 */
export async function imageToPngDataUrl(url: string, maxSide = 1000): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
    if (!res.ok) return null
    const blob = await res.blob()
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h }
  } catch {
    return null
  }
}

/* ── Entry point ───────────────────────────────────────────────────────── */

/** Render the report and trigger a browser download of the PDF file. */
export async function downloadTrademarkReport(input: ReportInput): Promise<void> {
  registerFonts()
  const blob = await pdf(<TrademarkReportDocument input={input} />).toBlob()
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = input.fileName
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    // Give the browser a moment to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}
