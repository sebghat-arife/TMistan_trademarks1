/* ---------------------------------------------------------------------------
 * Trademark indexing audit — which published records are (not) offered to
 * search engines, and why.
 *
 *   cd web && npx tsx scripts/indexing-audit.ts [--csv path] [--json path]
 *
 * Reads the public record set with the publishable key (read-only, RLS) and
 * applies THE SAME policy function the site uses (src/seo/recordPolicy.ts), so
 * the numbers can never drift from what the prerenderer and sitemap do. Prints
 * a Markdown report to stdout; optionally writes a per-record CSV of the
 * excluded records (serial, gazette, type, reasons, data-quality flags) for
 * clean-up work. Nothing is written to the database.
 * ------------------------------------------------------------------------- */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hasValue, recordIndexDecision, type IndexReason } from '../src/seo/recordPolicy.ts'

type Row = {
  id: string
  serial_number: string
  mark_name: string | null
  applicant_name: string | null
  applicant_address: string | null
  trademark_class: string | null
  class_numbers: number[] | null
  goods_and_services: string | null
  application_type: string | null
  publication_date: string | null
  official_gazette_number: string | null
  source_page: number | null
  review_status: string | null
  is_published: boolean
  created_at: string
  updated_at: string
}
type ImageRow = { trademark_id: string | null; status: string; width: number | null; height: number | null; byte_size: number | null; content_type: string | null }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PAGE = 1000

function loadEnv(): { url: string; key: string } {
  const env: Record<string, string> = { ...process.env } as Record<string, string>
  try {
    for (const line of readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*(?:#.*)?$/.exec(line)
      if (m && !(m[1] in env)) env[m[1]] = m[2].trim()
    }
  } catch {
    /* no .env.local */
  }
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? ''
  const key = env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? ''
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY missing (env or web/.env.local)')
  if (/^sb_secret_/.test(key)) throw new Error('refusing to run with a secret key — use the publishable key')
  return { url: url.replace(/\/$/, ''), key }
}

async function rest<T>(env: { url: string; key: string }, p: string): Promise<T> {
  const res = await fetch(`${env.url}/rest/v1/${p}`, { headers: { apikey: env.key, Authorization: `Bearer ${env.key}` } })
  if (!res.ok) throw new Error(`PostgREST ${res.status} for ${p}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()) as T
}
async function pageThrough<T>(env: { url: string; key: string }, build: (offset: number) => string): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; ; offset += PAGE) {
    const chunk = await rest<T[]>(env, build(offset))
    out.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return out
}

const args = process.argv.slice(2)
const opt = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const env = loadEnv()
const COLS = 'id,serial_number,mark_name,applicant_name,applicant_address,trademark_class,class_numbers,goods_and_services,application_type,publication_date,official_gazette_number,source_page,review_status,is_published,created_at,updated_at'
const rows = await pageThrough<Row>(env, (o) => `trademarks?select=${COLS}&is_published=eq.true&order=id&limit=${PAGE}&offset=${o}`)
const images = await pageThrough<ImageRow>(env, (o) => `trademark_images?select=trademark_id,status,width,height,byte_size,content_type&status=eq.matched&trademark_id=not.is.null&limit=${PAGE}&offset=${o}`)
const imagesByTm = new Map<string, ImageRow[]>()
for (const im of images) if (im.trademark_id) imagesByTm.set(im.trademark_id, [...(imagesByTm.get(im.trademark_id) ?? []), im])

/* ── classification ──────────────────────────────────────────────────────── */
const decisions = rows.map((r) => ({ row: r, decision: recordIndexDecision(r) }))
const excluded = decisions.filter((d) => !d.decision.indexable) as { row: Row; decision: { indexable: false; reasons: IndexReason[] } }[]
const indexable = decisions.filter((d) => d.decision.indexable)

const count = <K extends string | number>(items: Iterable<K>) => {
  const m = new Map<K, number>()
  for (const k of items) m.set(k, (m.get(k) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '–')
const md = (headers: string[], body: (string | number)[][]) =>
  [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`, ...body.map((r) => `| ${r.join(' | ')} |`)].join('\n')
const typeOf = (r: Row) => (r.application_type ?? '').trim() || '(empty)'
const day = (iso: string) => iso.slice(0, 10)

const reasonCounts = count(excluded.flatMap((d) => d.decision.reasons))
const comboCounts = count(excluded.map((d) => d.decision.reasons.join(' + ')))
const typeCounts = count(rows.map(typeOf))
const typeExcluded = count(excluded.map((d) => typeOf(d.row)))
const onlyReason = (reason: IndexReason) => excluded.filter((d) => d.decision.reasons.length === 1 && d.decision.reasons[0] === reason)

// Data-quality flags beyond the policy
const flags = (r: Row) => {
  const f: string[] = []
  if (!imagesByTm.has(r.id)) f.push('no-image')
  if (r.mark_name && r.mark_name.trim() === r.serial_number) f.push('mark-name-is-serial')
  if (r.mark_name && /^[\d\s./-]+$/.test(r.mark_name.trim())) f.push('mark-name-numeric')
  if (r.goods_and_services && r.goods_and_services.trim().length < 15) f.push('goods-very-short')
  if (!hasValue(r.applicant_address)) f.push('no-applicant-address')
  if (r.class_numbers && r.class_numbers.length > 45) f.push('implausible-class-count')
  if (r.publication_date && !/^\d{4}-\d{2}-\d{2}/.test(r.publication_date)) f.push('publication-date-format')
  if (!hasValue(r.trademark_class) && (!r.class_numbers || r.class_numbers.length === 0)) f.push('no-class-text')
  return f
}
const flagCounts = count(rows.flatMap(flags))
const flagCountsIndexable = count(indexable.flatMap((d) => flags(d.row)))

// Import batches (created_at day) — shows what the recent imports look like
const batches = count(rows.map((r) => day(r.created_at)))
const batchRows = batches.map(([d, n]) => {
  const inBatch = decisions.filter((x) => day(x.row.created_at) === d)
  const ex = inBatch.filter((x) => !x.decision.indexable)
  const top = count(ex.flatMap((x) => (x.decision as { reasons: IndexReason[] }).reasons)).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ')
  return [d, n, inBatch.length - ex.length, ex.length, pct(ex.length, n), top || '–']
})

// Gazette coverage
const gazettes = count(rows.map((r) => (r.official_gazette_number ?? '').trim() || '(none)'))
const gazetteRows = gazettes.map(([g, n]) => {
  const inG = decisions.filter((x) => ((x.row.official_gazette_number ?? '').trim() || '(none)') === g)
  const ex = inG.filter((x) => !x.decision.indexable).length
  return [g, n, n - ex, ex, pct(n - ex, n)]
})

// Near-duplicates among indexable records (same normalised mark name + applicant)
const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const dupKey = (r: Row) => `${norm(r.mark_name)}|${norm(r.applicant_name)}`
const dupGroups = count(indexable.map((d) => dupKey(d.row))).filter(([, n]) => n > 1)
const dupRecords = dupGroups.reduce((s, [, n]) => s + n, 0)

// Images for indexable records
const indexableWithImage = indexable.filter((d) => imagesByTm.has(d.row.id)).length
const imgSizes = images.filter((i) => i.byte_size).map((i) => i.byte_size as number)
const big = imgSizes.filter((b) => b > 300 * 1024).length
const dims = images.filter((i) => i.width && i.height)
const wide = dims.filter((i) => (i.width as number) > 1600).length

/* ── report ──────────────────────────────────────────────────────────────── */
const today = new Date().toISOString().slice(0, 10)
const out: string[] = []
out.push(`# Trademark indexing audit — ${today}`)
out.push('')
out.push(`Generated by \`web/scripts/indexing-audit.ts\` against the production project with the publishable key (read-only). Policy: \`web/src/seo/recordPolicy.ts\` (the same function drives \`<Seo robots>\`, the sitemap and the prerender list).`)
out.push('')
out.push(md(['Metric', 'Value'], [
  ['Published records', rows.length],
  ['Indexable (prerendered + in sitemap)', `${indexable.length} (${pct(indexable.length, rows.length)})`],
  ['Excluded (noindex,follow; still searchable)', `${excluded.length} (${pct(excluded.length, rows.length)})`],
  ['Indexable records with at least one matched image', `${indexableWithImage} (${pct(indexableWithImage, indexable.length)})`],
  ['Records with at least one matched image', `${rows.filter((r) => imagesByTm.has(r.id)).length} (${pct(rows.filter((r) => imagesByTm.has(r.id)).length, rows.length)})`],
  ['Matched images (total rows)', images.length],
]))
out.push('')
out.push('## 1. Why records are excluded')
out.push('')
out.push('A record can fail several rules at once; the first table counts every failed rule, the second the exact combinations.')
out.push('')
out.push(md(['Failed rule', 'Records', '% of excluded', 'Only reason'], reasonCounts.map(([k, v]) => [k, v, pct(v, excluded.length), onlyReason(k as IndexReason).length])))
out.push('')
out.push(md(['Reason combination', 'Records'], comboCounts.slice(0, 15).map(([k, v]) => [k, v])))
out.push('')
out.push('## 2. Notice types')
out.push('')
out.push(md(['application_type', 'Records', 'Excluded', 'Indexable'], typeCounts.map(([k, v]) => [k, v, typeExcluded.find((t) => t[0] === k)?.[1] ?? 0, v - (typeExcluded.find((t) => t[0] === k)?.[1] ?? 0)])))
out.push('')
out.push('## 3. Data-quality flags (all published records)')
out.push('')
out.push('Flags are informational; only the policy rules above decide indexing.')
out.push('')
out.push(md(['Flag', 'All records', 'Among indexable'], flagCounts.map(([k, v]) => [k, v, flagCountsIndexable.find((f) => f[0] === k)?.[1] ?? 0])))
out.push('')
out.push('## 4. Import batches (created_at day)')
out.push('')
out.push(md(['Day', 'Records', 'Indexable', 'Excluded', 'Excluded %', 'Top reasons'], batchRows))
out.push('')
out.push('## 5. Gazette coverage')
out.push('')
out.push(md(['Gazette', 'Records', 'Indexable', 'Excluded', 'Indexable %'], gazetteRows))
out.push('')
out.push('## 6. Near-duplicate indexable records')
out.push('')
out.push(`${dupGroups.length} groups share the same normalised mark name + applicant (${dupRecords} records). These are usually genuine separate filings (different classes or gazettes) and each has its own serial, title and URL; listed for review only.`)
out.push('')
out.push(md(['mark | applicant (normalised)', 'Records'], dupGroups.slice(0, 20).map(([k, v]) => [k.replace('|', ' \\| '), v])))
out.push('')
out.push('## 7. Images')
out.push('')
out.push(md(['Metric', 'Value'], [
  ['Matched images with a stored byte size', imgSizes.length],
  ['… larger than 300 KB', `${big} (${pct(big, imgSizes.length)})`],
  ['Matched images with stored dimensions', dims.length],
  ['… wider than 1600 px', `${wide} (${pct(wide, dims.length)})`],
]))
out.push('')
process.stdout.write(out.join('\n') + '\n')

const csvPath = opt('--csv')
if (csvPath) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = ['serial_number,gazette,application_type,publication_date,reasons,flags,mark_name_present,applicant_present,classes,goods_present,created_at']
  for (const d of excluded) {
    const r = d.row
    lines.push([r.serial_number, r.official_gazette_number ?? '', typeOf(r), r.publication_date ?? '', d.decision.reasons.join(' '), flags(r).join(' '), hasValue(r.mark_name) ? 'yes' : 'no', hasValue(r.applicant_name) ? 'yes' : 'no', (r.class_numbers ?? []).join(' '), hasValue(r.goods_and_services) ? 'yes' : 'no', day(r.created_at)].map(esc).join(','))
  }
  mkdirSync(path.dirname(csvPath), { recursive: true })
  writeFileSync(csvPath, lines.join('\n') + '\n')
  console.error(`[audit] ${excluded.length} excluded records → ${csvPath}`)
}
const jsonPath = opt('--json')
if (jsonPath) {
  mkdirSync(path.dirname(jsonPath), { recursive: true })
  writeFileSync(jsonPath, JSON.stringify({ generated: today, published: rows.length, indexable: indexable.length, excluded: excluded.length, reasons: Object.fromEntries(reasonCounts), combinations: Object.fromEntries(comboCounts), types: Object.fromEntries(typeCounts), flags: Object.fromEntries(flagCounts), batches: batchRows, gazettes: gazetteRows }, null, 2))
  console.error(`[audit] summary → ${jsonPath}`)
}
