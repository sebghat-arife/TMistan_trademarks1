/* ---------------------------------------------------------------------------
 * Locale-prefixed URLs.
 *
 * English is served at the bare path (https://tmistan.com/services); Dari and
 * Pashto live under a one-segment prefix (/fa/services, /ps/services). The
 * prefix is the React Router `basename`, so every <Link to="/x"> in the app
 * automatically stays inside the current language — nothing else in the
 * component tree needs to know about it.
 *
 * Why prefixes (and not the previous localStorage-only switch): search engines
 * can only index a language version that has its own URL. The prefix gives
 * every page three stable, crawlable addresses that reference each other with
 * hreflang (see seo/head.tsx) and appear in the sitemap (scripts/prerender.mjs).
 * ------------------------------------------------------------------------- */

export const SITE_LOCALES = [
  { code: 'en', prefix: '', hreflang: 'en', htmlLang: 'en', ogLocale: 'en_US', dir: 'ltr' },
  { code: 'fa', prefix: '/fa', hreflang: 'fa-AF', htmlLang: 'fa-AF', ogLocale: 'fa_AF', dir: 'rtl' },
  { code: 'ps', prefix: '/ps', hreflang: 'ps-AF', htmlLang: 'ps-AF', ogLocale: 'ps_AF', dir: 'rtl' },
] as const

export type SiteLocale = (typeof SITE_LOCALES)[number]
export type SiteLocaleCode = SiteLocale['code']

export const DEFAULT_LOCALE: SiteLocaleCode = 'en'

export function isSiteLocale(value: string | null | undefined): value is SiteLocaleCode {
  return SITE_LOCALES.some((l) => l.code === value)
}

export function siteLocale(code: string | null | undefined): SiteLocale {
  return SITE_LOCALES.find((l) => l.code === code) ?? SITE_LOCALES[0]
}

/** Router basename for a locale ('' for English, '/fa', '/ps'). */
export function localeBasename(code: SiteLocaleCode): string {
  return siteLocale(code).prefix
}

/**
 * Split a pathname into its locale and the locale-less route path.
 *   '/fa/services' → { lng: 'fa', path: '/services' }
 *   '/fa'          → { lng: 'fa', path: '/' }
 *   '/services'    → { lng: 'en', path: '/services' }
 */
export function splitLocalePath(pathname: string): { lng: SiteLocaleCode; path: string } {
  const m = /^\/(fa|ps)(?=\/|$)(.*)$/.exec(pathname)
  if (m) return { lng: m[1] as SiteLocaleCode, path: m[2] || '/' }
  return { lng: 'en', path: pathname || '/' }
}

/**
 * Prefix a locale-less route path for a locale: '/services' → '/fa/services',
 * '/' → '/fa'. No URL carries a trailing slash except the English home ('/'),
 * which is also exactly what React Router renders for <Link> under a basename,
 * so links, canonicals, hreflang and the sitemap all agree.
 */
export function localizePath(path: string, lng: SiteLocaleCode): string {
  const prefix = localeBasename(lng)
  const clean = normalizePath(path)
  if (!prefix) return clean
  return clean === '/' ? prefix : `${prefix}${clean}`
}

/** Collapse duplicate slashes and drop a trailing slash (except for the root). */
export function normalizePath(path: string): string {
  const p = ('/' + (path || '')).replace(/\/{2,}/g, '/')
  return p.length > 1 ? p.replace(/\/+$/, '') : '/'
}

/** One hreflang entry per language (plus x-default = English) for a locale-less path. */
export function alternatePaths(path: string): { hreflang: string; path: string }[] {
  return [
    ...SITE_LOCALES.map((l) => ({ hreflang: l.hreflang, path: localizePath(path, l.code) })),
    { hreflang: 'x-default', path: localizePath(path, DEFAULT_LOCALE) },
  ]
}
