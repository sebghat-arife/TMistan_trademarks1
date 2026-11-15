/* ---------------------------------------------------------------------------
 * Public static routes — the single list used by the prerenderer and the
 * sitemap (scripts/prerender.mjs via src/entry-server.tsx).
 *
 * `lastmod` is maintained by hand and must be bumped when the content of a
 * page changes materially; it is what search engines are told. Knowledge
 * Center articles are added automatically from src/content/knowledge.ts and
 * eligible trademark records from the database.
 * ------------------------------------------------------------------------- */

export type ChangeFreq = 'daily' | 'weekly' | 'monthly' | 'yearly'

export type StaticRoute = {
  /** Locale-less path. */
  path: string
  /** Date (YYYY-MM-DD) the page content last changed. */
  lastmod: string
  changefreq: ChangeFreq
  priority: number
}

/** Content/metadata release of the SEO programme — every public page changed on this date. */
export const SEO_RELEASE_DATE = '2026-11-15'

export const STATIC_ROUTES: readonly StaticRoute[] = [
  { path: '/', lastmod: SEO_RELEASE_DATE, changefreq: 'daily', priority: 1.0 },
  { path: '/services', lastmod: SEO_RELEASE_DATE, changefreq: 'monthly', priority: 0.8 },
  { path: '/data-sources', lastmod: SEO_RELEASE_DATE, changefreq: 'monthly', priority: 0.7 },
  { path: '/knowledge-center', lastmod: SEO_RELEASE_DATE, changefreq: 'weekly', priority: 0.8 },
  { path: '/data-corrections', lastmod: SEO_RELEASE_DATE, changefreq: 'monthly', priority: 0.5 },
  { path: '/about', lastmod: SEO_RELEASE_DATE, changefreq: 'monthly', priority: 0.7 },
  { path: '/help', lastmod: SEO_RELEASE_DATE, changefreq: 'monthly', priority: 0.6 },
  { path: '/contact', lastmod: SEO_RELEASE_DATE, changefreq: 'yearly', priority: 0.5 },
  { path: '/legal', lastmod: SEO_RELEASE_DATE, changefreq: 'yearly', priority: 0.3 },
  { path: '/legal/terms', lastmod: SEO_RELEASE_DATE, changefreq: 'yearly', priority: 0.3 },
  { path: '/legal/privacy', lastmod: SEO_RELEASE_DATE, changefreq: 'yearly', priority: 0.3 },
  { path: '/legal/disclaimer', lastmod: SEO_RELEASE_DATE, changefreq: 'yearly', priority: 0.3 },
  { path: '/legal/intellectual-property', lastmod: SEO_RELEASE_DATE, changefreq: 'yearly', priority: 0.3 },
]

/** Paths that must never be prerendered, indexed or listed: admin area, auth, legacy redirects, search URLs. */
export const PRIVATE_PATH_PREFIXES = ['/admin'] as const
