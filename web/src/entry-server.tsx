/* oxlint-disable react/only-export-components -- route tree / build entry, not a Fast Refresh boundary */
/* ---------------------------------------------------------------------------
 * Prerender entry (build time only — scripts/prerender.mjs).
 *
 * Renders one route in one language to static HTML with the same component
 * tree the browser runs (AppRoutes), collects the <head> written by that
 * page's <Seo>, and returns both. The browser bundle then takes over on load
 * (main.tsx), so visitors get the final HTML immediately and search engines
 * and link previews never depend on JavaScript.
 * ------------------------------------------------------------------------- */
import { StrictMode } from 'react'
import { prerender } from 'react-dom/static'
import { dehydrate, QueryClientProvider } from '@tanstack/react-query'
import { StaticRouter } from 'react-router'
import { AppRoutes, createQueryClient } from './App'
import { loadLanguage } from '@/i18n'
import { ssrHead, headToHtml, type HeadState } from '@/seo/head'
import { localeBasename, localizePath, type SiteLocaleCode } from '@/seo/locales'
import { loadPrerenderDataset, seedHome, seedRecord, type PrerenderDataset } from '@/seo/prerenderData'
import { recordIndexDecision } from '@/seo/recordPolicy'
import { ARTICLES } from '@/content/knowledge'
import { GUIDES } from '@/content/guides'
import { STATIC_ROUTES } from '@/seo/routes'
import type { TrademarkPublicRow } from '@/lib/database.types'
import { CANONICAL_URL } from '@/lib/site'

export { STATIC_ROUTES, ARTICLES, GUIDES, loadPrerenderDataset, recordIndexDecision, localizePath, CANONICAL_URL }

/** English-only pages (canonical = English URL): Knowledge Center articles and Guides. */
export const ENGLISH_PAGES: { path: string; lastmod: string; priority: number }[] = [
  ...GUIDES.map((g) => ({ path: `/guides/${g.slug}`, lastmod: g.updated ?? g.written, priority: 0.7 })),
  ...ARTICLES.map((a) => ({ path: `/knowledge-center/${a.slug}`, lastmod: a.updated ?? a.written, priority: 0.6 })),
]

export type RenderResult = {
  html: string
  headHtml: string
  head: HeadState
  /** Query cache for this page (embedded as JSON so the client starts with the data). */
  state: string | null
}

async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out + decoder.decode()
}

export async function render(opts: {
  path: string
  lng: SiteLocaleCode
  dataset?: PrerenderDataset | null
  record?: TrademarkPublicRow | null
}): Promise<RenderResult> {
  await loadLanguage(opts.lng)
  const qc = createQueryClient()
  if (opts.dataset) {
    if (opts.path === '/') seedHome(qc, opts.dataset)
    if (opts.record) seedRecord(qc, opts.dataset, opts.record)
  }
  ssrHead.current = null
  const location = localizePath(opts.path, opts.lng)
  const { prelude } = await prerender(
    <StrictMode>
      <QueryClientProvider client={qc}>
        <StaticRouter basename={localeBasename(opts.lng)} location={location}>
          <AppRoutes />
        </StaticRouter>
      </QueryClientProvider>
    </StrictMode>,
    {
      onError(err) {
        console.error(`[prerender] ${location}:`, err)
      },
    },
  )
  const html = await streamToString(prelude)
  const head = ssrHead.current
  if (!head) throw new Error(`No <Seo> rendered for ${location}`)
  const cache = dehydrate(qc)
  const state = cache.queries.length ? JSON.stringify(cache).replace(/</g, '\\u003c') : null
  qc.clear()
  return { html, headHtml: headToHtml(head), head, state }
}
