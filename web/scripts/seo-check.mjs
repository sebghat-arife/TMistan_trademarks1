#!/usr/bin/env node
/**
 * Technical SEO checker for the prerendered site (Phase 3).
 *
 *   node scripts/seo-check.mjs [dist-dir] [--json out.json] [--max-errors 50]
 *
 * Reads every *.html under dist (plus robots.txt and the sitemaps) and verifies, page by page:
 *   - exactly one <title>, one meta description, one canonical; lengths within bounds
 *   - robots meta is either absent/index or noindex; noindex pages carry no hreflang
 *   - canonical is absolute on https://tmistan.com and self-referencing or (records,
 *     guides, knowledge) pointing at the English URL
 *   - hreflang set, when present, is complete (en, fa-AF, ps-AF, x-default) and reciprocal:
 *     every alternate target exists in dist and links back with the same set
 *   - <html lang> / dir match the URL language prefix
 *   - exactly one <h1>; <img> tags have alt and width/height (lazy ones at least loading=lazy)
 *   - JSON-LD blocks parse; @type present
 *   - Open Graph title/description/url present; og:url equals canonical
 *   - internal links: every href on the site resolves to a prerendered page, the app
 *     fallback routes (search/admin query urls) or a static asset
 * and, site-wide:
 *   - titles and descriptions unique among indexable pages (reports duplicates)
 *   - sitemap URLs == set of indexable English pages (+ language alternates of static pages);
 *     no noindex URL in the sitemap; no indexable page missing from it
 *   - robots.txt references the sitemap index and disallows /admin
 *
 * Exit code 1 when any error is found (warnings do not fail). No network access.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const dist = path.resolve(here, '..', args.find((a) => !a.startsWith('--')) ?? 'dist')
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null
const maxErrors = args.includes('--max-errors') ? Number(args[args.indexOf('--max-errors') + 1]) : 40
const ORIGIN = 'https://tmistan.com'
const HREFLANG = new Set(['en', 'fa-AF', 'ps-AF', 'x-default'])

/* ── helpers ──────────────────────────────────────────────────────────── */
async function walk(dir, out = []) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) await walk(p, out)
    else out.push(p)
  }
  return out
}
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
const attrs = (tag) => {
  const o = {}
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) o[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? '')
  return o
}
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => ({ raw: m[0], a: attrs(m[0]) }))
const head = (html) => html.slice(0, html.search(/<body\b/i) === -1 ? html.length : html.search(/<body\b/i))
const urlPath = (file) => {
  let rel = '/' + path.relative(dist, file).split(path.sep).join('/')
  if (rel.endsWith('/index.html')) rel = rel.slice(0, -'/index.html'.length)
  return rel || '/'
}
const langOf = (p) => (p === '/fa' || p.startsWith('/fa/') ? 'fa' : p === '/ps' || p.startsWith('/ps/') ? 'ps' : 'en')
const stripLang = (p) => p.replace(/^\/(fa|ps)(?=\/|$)/, '') || '/'

/* ── load ─────────────────────────────────────────────────────────────── */
const files = (await walk(dist)).filter((f) => f.endsWith('.html'))
const pages = new Map() // path -> info
const problems = []
const warnings = []
const err = (p, msg) => problems.push({ page: p, msg })
const warn = (p, msg) => warnings.push({ page: p, msg })

for (const f of files) {
  const p = urlPath(f)
  if (p === '/app.html') continue
  const html = await fs.readFile(f, 'utf8')
  const h = head(html)
  const htmlTag = tags(html, 'html')[0]?.a ?? {}
  const titles = [...h.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)].map((m) => decode(m[1].trim()))
  const metas = tags(h, 'meta')
  const descs = metas.filter((m) => m.a.name === 'description').map((m) => m.a.content ?? '')
  const robots = metas.filter((m) => m.a.name === 'robots').map((m) => m.a.content ?? '')
  const og = Object.fromEntries(metas.filter((m) => m.a.property?.startsWith('og:')).map((m) => [m.a.property, m.a.content ?? '']))
  const links = tags(h, 'link')
  const canonical = links.filter((l) => l.a.rel === 'canonical').map((l) => l.a.href)
  const alternates = links.filter((l) => l.a.rel === 'alternate' && l.a.hreflang).map((l) => ({ lang: l.a.hreflang, href: l.a.href }))
  const h1s = [...html.matchAll(/<h1\b[^>]*>/gi)].length
  const imgs = tags(html, 'img')
  const jsonld = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1])
  const anchors = tags(html, 'a').map((a) => a.a.href).filter(Boolean)
  const noindex = robots.some((r) => /noindex/i.test(r))
  pages.set(p, { file: f, path: p, lang: langOf(p), titles, descs, robots, og, canonical, alternates, h1s, imgs, jsonld, anchors, noindex, htmlTag, size: html.length })
}

/* ── per-page checks ──────────────────────────────────────────────────── */
const indexable = []
for (const pg of pages.values()) {
  const p = pg.path
  if (pg.titles.length !== 1) err(p, `expected 1 <title>, found ${pg.titles.length}`)
  else {
    const len = pg.titles[0].length
    if (len < 15) err(p, `title too short (${len}): ${pg.titles[0]}`)
    if (len > 70 && (pg.canonical.length !== 1 || (pg.canonical[0].slice(ORIGIN.length) || '/') === p)) warn(p, `title longer than 70 characters (${len}) — may be truncated in results`)
  }
  const selfCanonical = pg.canonical.length === 1 && (pg.canonical[0].slice(ORIGIN.length) || '/') === p
  if (pg.descs.length !== 1) err(p, `expected 1 meta description, found ${pg.descs.length}`)
  else if (selfCanonical) {
    // length rules matter for the canonical page; copies canonicalised elsewhere are not shown in results
    const len = pg.descs[0].length
    if (len < 50) err(p, `description too short (${len})`)
    if (len > 170) warn(p, `description longer than 170 characters (${len})`)
  }
  if (pg.robots.length > 1) err(p, `multiple robots metas: ${pg.robots.join(' | ')}`)
  if (pg.canonical.length !== 1) err(p, `expected 1 canonical, found ${pg.canonical.length}`)
  else {
    const c = pg.canonical[0]
    if (!c.startsWith(ORIGIN + '/') && c !== ORIGIN) err(p, `canonical not on ${ORIGIN}: ${c}`)
    else {
      const cp = c.slice(ORIGIN.length) || '/'
      const self = cp === p
      const english = cp === stripLang(p)
      if (!self && !english) err(p, `canonical ${cp} is neither self nor the English URL`)
      if (!pages.has(cp)) err(p, `canonical target ${cp} is not a prerendered page`)
      else if (pages.get(cp).noindex && !pg.noindex) err(p, `canonical target ${cp} is noindex`)
      if (pg.og['og:url'] && pg.og['og:url'] !== c) err(p, `og:url ${pg.og['og:url']} differs from canonical ${c}`)
    }
  }
  if (!pg.og['og:title']) err(p, 'missing og:title')
  if (!pg.og['og:description']) err(p, 'missing og:description')
  const expectedLang = pg.lang === 'en' ? 'en' : pg.lang === 'fa' ? 'fa-AF' : 'ps-AF'
  if ((pg.htmlTag.lang ?? '') !== expectedLang) err(p, `<html lang="${pg.htmlTag.lang}"> but URL language is ${expectedLang}`)
  const expectedDir = pg.lang === 'en' ? 'ltr' : 'rtl'
  if ((pg.htmlTag.dir ?? 'ltr') !== expectedDir) err(p, `<html dir="${pg.htmlTag.dir}"> expected ${expectedDir}`)
  if (pg.noindex) {
    if (pg.alternates.length) err(p, 'noindex page carries hreflang alternates')
  } else {
    indexable.push(pg)
    if (pg.alternates.length) {
      const langs = new Set(pg.alternates.map((a) => a.lang))
      for (const l of HREFLANG) if (!langs.has(l)) err(p, `hreflang set incomplete: missing ${l}`)
      for (const a of pg.alternates) {
        if (!HREFLANG.has(a.lang)) err(p, `unexpected hreflang ${a.lang}`)
        if (!a.href.startsWith(ORIGIN)) { err(p, `hreflang href not absolute: ${a.href}`); continue }
        const tp = a.href.slice(ORIGIN.length) || '/'
        const target = pages.get(tp)
        if (!target) err(p, `hreflang ${a.lang} → ${tp} is not a prerendered page`)
        else if (target.noindex) err(p, `hreflang ${a.lang} → ${tp} is noindex`)
        else {
          const back = target.alternates.find((b) => b.lang === a.lang)
          const mine = pg.alternates.map((x) => `${x.lang}=${x.href}`).sort().join('|')
          const theirs = target.alternates.map((x) => `${x.lang}=${x.href}`).sort().join('|')
          if (!back || mine !== theirs) err(p, `hreflang not reciprocal with ${tp}`)
        }
      }
      const selfAlt = pg.alternates.find((a) => a.lang === expectedLang)
      if (!selfAlt || (selfAlt.href.slice(ORIGIN.length) || '/') !== p) err(p, `hreflang ${expectedLang} does not point to the page itself`)
    } else if (selfCanonical && pg.lang === 'en') {
      // self-canonical page without hreflang: fine unless a *self-canonical* translation exists
      const fa = pages.get(`/fa${p === '/' ? '' : p}`)
      if (fa && (fa.canonical[0]?.slice(ORIGIN.length) || '/') === fa.path) warn(p, 'self-canonical page with a self-canonical translation but no hreflang')
    }
  }
  if (pg.h1s !== 1) err(p, `expected 1 <h1>, found ${pg.h1s}`)
  for (const img of pg.imgs) {
    if (img.a.alt === undefined) err(p, `<img> without alt: ${img.raw.slice(0, 80)}`)
    if (!img.a.width || !img.a.height) {
      if (!/\bclass="[^"]*(?:h-|w-)/.test(img.raw) && img.a.loading !== 'lazy') warn(p, `<img> without width/height: ${(img.a.src ?? '').slice(0, 80)}`)
    }
  }
  for (const block of pg.jsonld) {
    try {
      const data = JSON.parse(block)
      const nodes = Array.isArray(data) ? data : data['@graph'] ?? [data]
      for (const n of nodes) if (!n['@type']) err(p, 'JSON-LD node without @type')
    } catch (e) {
      err(p, `JSON-LD does not parse: ${e.message}`)
    }
  }
  if (pg.size > 1_000_000) warn(p, `HTML larger than 1 MB (${pg.size})`)
}

/* ── site-wide: duplicates ────────────────────────────────────────────── */
const byTitle = new Map()
const byDesc = new Map()
for (const pg of indexable) {
  const t = pg.titles[0]
  const d = pg.descs[0]
  if (t) byTitle.set(t, [...(byTitle.get(t) ?? []), pg.path])
  if (d) byDesc.set(d, [...(byDesc.get(d) ?? []), pg.path])
}
const dupTitles = [...byTitle.entries()].filter(([, v]) => v.length > 1)
const dupDescs = [...byDesc.entries()].filter(([, v]) => v.length > 1)
// A translated page shares nothing with its siblings (titles differ by language). Duplicate
// titles between *different* canonical targets are errors; among pages that share a canonical
// (e.g. /fa/trademark/x → /trademark/x) they are expected only if the text is identical.
for (const [t, ps] of dupTitles) {
  const canon = new Set(ps.map((x) => pages.get(x).canonical[0]))
  if (canon.size <= 1) continue
  // language versions of one page (hreflang alternates) may legitimately share a title (same loanword)
  const alternates = new Set(pages.get(ps[0]).alternates.map((a) => a.href.slice(ORIGIN.length) || '/'))
  const sameCluster = ps.every((x) => x === ps[0] || alternates.has(x))
  if (sameCluster) warn(ps[0], `identical title on hreflang alternates: "${t}" (${ps.join(', ')})`)
  else err(ps[0], `duplicate title across ${ps.length} pages with different canonicals: "${t}" (${ps.slice(0, 3).join(', ')}…)`)
}
for (const [d, ps] of dupDescs) {
  const canon = new Set(ps.map((x) => pages.get(x).canonical[0]))
  if (canon.size > 1) warn(ps[0], `duplicate description across ${ps.length} pages with different canonicals (${ps.slice(0, 3).join(', ')}…): "${d.slice(0, 60)}…"`)
}

/* ── site-wide: internal links ────────────────────────────────────────── */
const assets = new Set((await walk(dist)).map((f) => '/' + path.relative(dist, f).split(path.sep).join('/')))
const appRoutes = [/^\/\?/, /^\/(fa|ps)\/?\?/, /^\/admin(\/|$)/, /^\/(fa|ps)\/admin(\/|$)/]
const linkProblems = new Map()
let internalLinks = 0
for (const pg of pages.values()) {
  for (const href of pg.anchors) {
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue
    let target = href
    if (/^https?:\/\//i.test(href)) {
      if (!href.startsWith(ORIGIN)) continue
      target = href.slice(ORIGIN.length) || '/'
    }
    if (!target.startsWith('/')) continue
    internalLinks++
    const clean = target.split('#')[0]
    const noQuery = clean.split('?')[0] || '/'
    if (pages.has(noQuery) || pages.has(noQuery.replace(/\/$/, '') || '/') || assets.has(noQuery) || appRoutes.some((r) => r.test(clean))) continue
    linkProblems.set(noQuery, (linkProblems.get(noQuery) ?? 0) + 1)
  }
}
for (const [t, n] of [...linkProblems.entries()].sort((a, b) => b[1] - a[1])) err('(links)', `${n} link(s) to ${t} — not a prerendered page, asset or app route`)

/* ── site-wide: sitemaps & robots ─────────────────────────────────────── */
const sitemapUrls = new Set()
const sitemapIndex = path.join(dist, 'sitemap.xml')
let sitemapFiles = []
try {
  const idx = await fs.readFile(sitemapIndex, 'utf8')
  const locs = [...idx.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decode(m[1]))
  if (/<sitemapindex/.test(idx)) {
    sitemapFiles = locs.map((l) => path.join(dist, l.replace(ORIGIN, '')))
  } else sitemapFiles = [sitemapIndex]
  for (const sf of sitemapFiles) {
    const xml = await fs.readFile(sf, 'utf8')
    for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const loc = decode((m[1].match(/<loc>([^<]+)<\/loc>/) ?? [])[1] ?? '')
      if (!loc.startsWith(ORIGIN)) err('(sitemap)', `loc not on ${ORIGIN}: ${loc}`)
      sitemapUrls.add(loc.slice(ORIGIN.length) || '/')
    }
  }
} catch (e) {
  err('(sitemap)', `cannot read sitemap: ${e.message}`)
}
const indexableSelf = indexable.filter((pg) => (pg.canonical[0]?.slice(ORIGIN.length) || '/') === pg.path).map((pg) => pg.path)
const indexableSelfSet = new Set(indexableSelf)
const notInSitemap = indexableSelf.filter((p) => !sitemapUrls.has(p))
const extraInSitemap = [...sitemapUrls].filter((p) => !indexableSelfSet.has(p))
for (const p of extraInSitemap) err('(sitemap)', `sitemap URL ${p} is ${pages.has(p) ? (pages.get(p).noindex ? 'noindex' : 'canonicalised elsewhere') : 'not prerendered'}`)
if (notInSitemap.length) err('(sitemap)', `${notInSitemap.length} indexable self-canonical page(s) missing from the sitemap, e.g. ${notInSitemap.slice(0, 5).join(', ')}`)
let robotsTxt = ''
try {
  robotsTxt = await fs.readFile(path.join(dist, 'robots.txt'), 'utf8')
  if (!/Sitemap:\s*https:\/\/tmistan\.com\/sitemap\.xml/i.test(robotsTxt)) err('(robots)', 'robots.txt does not reference https://tmistan.com/sitemap.xml')
  if (!/Disallow:\s*\/admin/i.test(robotsTxt)) err('(robots)', 'robots.txt does not disallow /admin')
} catch (e) {
  err('(robots)', `cannot read robots.txt: ${e.message}`)
}

/* ── summary ──────────────────────────────────────────────────────────── */
const count = (fn) => [...pages.values()].filter(fn).length
const summary = {
  dist,
  pages: pages.size,
  indexable: indexable.length,
  noindex: count((pg) => pg.noindex),
  byLanguage: { en: count((pg) => pg.lang === 'en'), fa: count((pg) => pg.lang === 'fa'), ps: count((pg) => pg.lang === 'ps') },
  records: { total: count((pg) => /^\/(fa\/|ps\/)?trademark\//.test(pg.path)), english: count((pg) => /^\/trademark\//.test(pg.path)) },
  withHreflang: count((pg) => pg.alternates.length > 0),
  selfCanonicalIndexable: indexableSelf.length,
  englishCanonicalised: count((pg) => !pg.noindex && (pg.canonical[0]?.slice(ORIGIN.length) || '/') !== pg.path),
  sitemap: { files: sitemapFiles.length, urls: sitemapUrls.size, missing: notInSitemap.length, extra: extraInSitemap.length },
  internalLinks,
  images: [...pages.values()].reduce((n, pg) => n + pg.imgs.length, 0),
  jsonldBlocks: [...pages.values()].reduce((n, pg) => n + pg.jsonld.length, 0),
  titleLength: stats(indexable.map((pg) => pg.titles[0]?.length ?? 0)),
  descriptionLength: stats(indexable.map((pg) => pg.descs[0]?.length ?? 0)),
  duplicateTitles: dupTitles.length,
  duplicateDescriptions: dupDescs.length,
  errors: problems.length,
  warnings: warnings.length,
}
function stats(xs) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  return { min: s[0], p10: q(0.1), median: q(0.5), p90: q(0.9), max: s[s.length - 1] }
}

console.log(`SEO check of ${dist}`)
console.log(JSON.stringify(summary, null, 2))
const group = (list) => {
  const m = new Map()
  for (const x of list) {
    const key = x.msg.replace(/\d[\d,.]*/g, '#').replace(/"[^"]*"/g, '"…"').replace(/: .*/, '')
    const g = m.get(key) ?? { n: 0, examples: [] }
    g.n++
    if (g.examples.length < 3) g.examples.push(`${x.page}: ${x.msg}`)
    m.set(key, g)
  }
  return [...m.entries()].sort((a, b) => b[1].n - a[1].n)
}
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`)
  for (const [k, g] of group(warnings)) console.log(`  [${g.n}] ${k}\n      ${g.examples.join('\n      ')}`)
}
if (problems.length) {
  console.log(`\n${problems.length} error(s):`)
  for (const [k, g] of group(problems).slice(0, maxErrors)) console.log(`  [${g.n}] ${k}\n      ${g.examples.join('\n      ')}`)
}
if (jsonOut) await fs.writeFile(jsonOut, JSON.stringify({ summary, errors: problems, warnings }, null, 2))
console.log(problems.length ? '\nFAIL' : '\nOK')
process.exit(problems.length ? 1 : 0)
