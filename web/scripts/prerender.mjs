#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * Static prerender + sitemap + robots.txt — runs after `vite build`
 * (package.json "build"), entirely at build time. Nothing changes at runtime:
 * the site is still a static Render deployment serving dist/.
 *
 * What it produces inside dist/:
 *   <route>/index.html            every public page in English, Dari (/fa) and
 *                                 Pashto (/ps); Knowledge Center articles and
 *                                 eligible trademark records in English
 *                                 (their canonical language)
 *   sitemap.xml                   sitemap index
 *   sitemap-pages.xml             static pages (3 languages, hreflang) + articles
 *   sitemap-records-<n>.xml       indexable trademark records (≤ 5 000 per file)
 *   robots.txt                    disallows /admin, points at the sitemap
 *
 * Trademark data is read through the public PostgREST API with the publishable
 * key only (SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY — the same variables the
 * browser build already needs). When they are missing (local builds without an
 * env file) only the static pages are prerendered. When they are present and
 * the API fails, the build FAILS — a deploy that silently dropped 3 500 record
 * pages from the sitemap would be worse than keeping the previous deploy live.
 * Set PRERENDER_ALLOW_PARTIAL=1 to override that in an emergency.
 * ------------------------------------------------------------------------- */
import { build } from 'vite'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const SSR_DIR = path.join(ROOT, 'dist-ssr')
const SITEMAP_CHUNK = 5000
const LOCALES = ['en', 'fa', 'ps']

const t0 = Date.now()
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const log = (msg) => console.log(`[prerender] ${msg}`)

// supabase-js constructs its realtime client eagerly and insists on a WebSocket
// constructor. Node 22+ (Render: NODE_VERSION 22.12.0) has one natively; on older
// Node a stand-in keeps the import working — prerendering never opens a socket.
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class WebSocket {
    constructor() {
      throw new Error('WebSocket connections are not available during prerendering')
    }
  }
}

// 1. SSR bundle of the same source (src/entry-server.tsx) — temporary, deleted at the end.
await rm(SSR_DIR, { recursive: true, force: true })
await build({
  root: ROOT,
  logLevel: 'warn',
  build: { ssr: 'src/entry-server.tsx', outDir: SSR_DIR, emptyOutDir: true, ssrEmitAssets: false, minify: false, rolldownOptions: { output: { codeSplitting: undefined } } },
  ssr: { noExternal: ['react-i18next', 'i18next'] },
})
const server = await import(pathToFileURL(path.join(SSR_DIR, 'entry-server.js')).href)
const { render, STATIC_ROUTES, ARTICLES, loadPrerenderDataset, recordIndexDecision, localizePath, CANONICAL_URL } = server

// 2. Template: the browser build's index.html (hashed asset tags included).
const template = await readFile(path.join(DIST, 'index.html'), 'utf8')
const ROOT_MARKER = '<div id="root"><!--seo:app--></div>'
for (const marker of ['<!--seo:head-->', '<!--/seo:head-->', ROOT_MARKER]) {
  if (!template.includes(marker)) throw new Error(`dist/index.html lacks the ${marker} marker`)
}

function pageHtml(urlPath, { html, headHtml, head, state }) {
  const stateTag = state ? `\n    <script id="__TMISTAN_STATE__" type="application/json">${state}</script>` : ''
  return template
    .replace(/^<!doctype html>\s*<html[^>]*>/i, `<!doctype html>\n<html lang="${head.lang}" dir="${head.dir}">`)
    .replace(/<!--seo:head-->[\s\S]*?<!--\/seo:head-->/, headHtml)
    .replace(ROOT_MARKER, `<div id="root" data-prerendered="${esc(urlPath)}">${html}</div>`)
    .replace('</body>', `${stateTag}\n  </body>`)
}

// Neutral SPA shell for every URL that is not prerendered (served through the
// /* → /app.html rewrite in render.yaml): default head, empty root.
async function writeShell() {
  const shell = template.replace(/<!--seo:head-->|<!--\/seo:head-->/g, '').replace(ROOT_MARKER, '<div id="root"></div>')
  await writeFile(path.join(DIST, 'app.html'), shell, 'utf8')
}

async function writePage(urlPath, result) {
  const dir = urlPath === '/' ? DIST : path.join(DIST, urlPath.replace(/^\//, ''))
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'index.html'), pageHtml(urlPath, result), 'utf8')
}

// 3. Data (optional — see header).
const env = {
  url: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '',
  key: process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '',
}
let dataset = null
if (env.url && env.key) {
  try {
    dataset = await loadPrerenderDataset(env)
    log(`loaded ${dataset.trademarks.length} published trademarks, images for ${dataset.imagesByTrademark.size} records, stats ${dataset.stats ? 'ok' : 'unavailable'}`)
  } catch (err) {
    const msg = `could not read trademark data from ${env.url}: ${err?.message ?? err}`
    if (process.env.PRERENDER_ALLOW_PARTIAL === '1') console.warn(`[prerender] WARNING ${msg} — continuing with static pages only`)
    else throw new Error(`${msg} (set PRERENDER_ALLOW_PARTIAL=1 to build without record pages)`)
  }
} else {
  console.warn('[prerender] SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not set — static pages only, no record pages in the sitemap')
}

// 4. Pages.
await writeShell()
const pageEntries = [] // sitemap-pages.xml
let count = 0
for (const route of STATIC_ROUTES) {
  for (const lng of LOCALES) {
    const urlPath = localizePath(route.path, lng)
    const result = await render({ path: route.path, lng, dataset })
    await writePage(urlPath, result)
    count++
  }
  pageEntries.push({ path: route.path, lastmod: route.lastmod, changefreq: route.changefreq, priority: route.priority, languages: true })
}
for (const a of ARTICLES) {
  const p = `/knowledge-center/${a.slug}`
  const result = await render({ path: p, lng: 'en', dataset })
  await writePage(p, result)
  count++
  pageEntries.push({ path: p, lastmod: a.updated ?? a.written, changefreq: 'monthly', priority: 0.6, languages: false })
}
log(`${count} static pages written`)

const recordEntries = []
if (dataset) {
  let skipped = 0
  const seen = new Set()
  for (const tm of dataset.trademarks) {
    if (!recordIndexDecision(tm).indexable || seen.has(tm.serial_number)) {
      skipped++
      continue
    }
    seen.add(tm.serial_number)
    const p = `/trademark/${encodeURIComponent(tm.serial_number)}`
    const result = await render({ path: p, lng: 'en', dataset, record: tm })
    await writePage(p, result)
    recordEntries.push({ path: p, lastmod: (tm.updated_at ?? tm.created_at ?? '').slice(0, 10) || undefined })
  }
  log(`${recordEntries.length} trademark record pages written (${skipped} records not eligible for indexing — see src/seo/recordPolicy.ts)`)
}

// 5. Sitemaps + robots.txt.
const abs = (p) => `${CANONICAL_URL}${p}`
const HREFLANG = { en: 'en', fa: 'fa-AF', ps: 'ps-AF' }

function urlEntry(loc, { lastmod, changefreq, priority, alternates }) {
  let x = `  <url>\n    <loc>${esc(loc)}</loc>\n`
  if (lastmod) x += `    <lastmod>${lastmod}</lastmod>\n`
  if (changefreq) x += `    <changefreq>${changefreq}</changefreq>\n`
  if (priority !== undefined) x += `    <priority>${priority.toFixed(1)}</priority>\n`
  for (const a of alternates ?? []) x += `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${esc(a.href)}"/>\n`
  return x + '  </url>\n'
}

const pagesXml = ['<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n']
for (const e of pageEntries) {
  if (e.languages) {
    const alternates = [
      ...LOCALES.map((l) => ({ hreflang: HREFLANG[l], href: abs(localizePath(e.path, l)) })),
      { hreflang: 'x-default', href: abs(localizePath(e.path, 'en')) },
    ]
    for (const l of LOCALES) pagesXml.push(urlEntry(abs(localizePath(e.path, l)), { ...e, alternates }))
  } else {
    pagesXml.push(urlEntry(abs(e.path), e))
  }
}
pagesXml.push('</urlset>\n')
await writeFile(path.join(DIST, 'sitemap-pages.xml'), pagesXml.join(''), 'utf8')

const sitemapFiles = ['sitemap-pages.xml']
for (let i = 0; i < recordEntries.length; i += SITEMAP_CHUNK) {
  const name = `sitemap-records-${i / SITEMAP_CHUNK + 1}.xml`
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n']
  for (const e of recordEntries.slice(i, i + SITEMAP_CHUNK)) xml.push(urlEntry(abs(e.path), { lastmod: e.lastmod, changefreq: 'monthly', priority: 0.5 }))
  xml.push('</urlset>\n')
  await writeFile(path.join(DIST, name), xml.join(''), 'utf8')
  sitemapFiles.push(name)
}
const today = new Date().toISOString().slice(0, 10)
const index = ['<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n']
for (const f of sitemapFiles) index.push(`  <sitemap>\n    <loc>${esc(abs('/' + f))}</loc>\n    <lastmod>${today}</lastmod>\n  </sitemap>\n`)
index.push('</sitemapindex>\n')
await writeFile(path.join(DIST, 'sitemap.xml'), index.join(''), 'utf8')

await writeFile(
  path.join(DIST, 'robots.txt'),
  [
    '# TMistan — Afghanistan trademark research platform',
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /admin/',
    '',
    `Sitemap: ${abs('/sitemap.xml')}`,
    '',
  ].join('\n'),
  'utf8',
)

await rm(SSR_DIR, { recursive: true, force: true })
log(`done: ${count + recordEntries.length} pages, ${sitemapFiles.length + 1} sitemap files, robots.txt — ${((Date.now() - t0) / 1000).toFixed(1)}s`)
