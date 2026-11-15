import { isSiteLocale, localeBasename, localizePath, splitLocalePath, type SiteLocaleCode } from './locales'

/** Browser language tags that mean Dari / Pashto (Dari is `prs` in BCP 47, `fa-AF` in practice). */
function fromNavigatorTag(tag: string): SiteLocaleCode | null {
  const t = tag.toLowerCase()
  if (t === 'prs' || t.startsWith('prs-') || t === 'fa' || t.startsWith('fa-')) return 'fa'
  if (t === 'ps' || t.startsWith('ps-')) return 'ps'
  if (t === 'en' || t.startsWith('en-')) return 'en'
  return null
}

export type ClientLocale = {
  lng: SiteLocaleCode
  basename: string
  /** Same-document URL to switch to (history.replaceState) when a stored or browser preference applies. */
  redirect: string | null
}

/**
 * Decide the language for this page load.
 *  1. A locale prefix in the URL always wins (/fa/…, /ps/…).
 *  2. Otherwise an explicit `?lang=` (old share links), then the stored preference,
 *     then the browser language move the visitor to the matching prefixed URL once.
 *  3. Everything else is English at the bare path.
 * Crawlers have neither storage nor a Dari/Pashto Accept-Language, so they always
 * see the English pages at their canonical URLs.
 */
export function resolveClientLocale(
  loc: { pathname: string; search: string; hash: string },
  prefs: { stored: SiteLocaleCode | null; navigatorLangs: readonly string[] },
): ClientLocale {
  const { lng: urlLng, path } = splitLocalePath(loc.pathname)
  const params = new URLSearchParams(loc.search)
  const queryLang = params.get('lang')
  if (queryLang !== null) params.delete('lang')
  const search = params.toString() ? `?${params.toString()}` : ''

  if (urlLng !== 'en') {
    const redirect = queryLang !== null ? `${localizePath(path, urlLng)}${search}${loc.hash}` : null
    return { lng: urlLng, basename: localeBasename(urlLng), redirect }
  }

  let preferred: SiteLocaleCode | null = isSiteLocale(queryLang) ? queryLang : null
  if (!preferred) preferred = prefs.stored
  if (!preferred) {
    for (const tag of prefs.navigatorLangs) {
      const candidate = fromNavigatorTag(tag)
      if (candidate) {
        preferred = candidate
        break
      }
    }
  }
  const lng: SiteLocaleCode = preferred ?? 'en'
  const target = `${localizePath(path, lng)}${search}${loc.hash}`
  const current = `${loc.pathname}${loc.search}${loc.hash}`
  return { lng, basename: localeBasename(lng), redirect: target !== current ? target : null }
}

/** Full-page navigation to the same route in another language (used by the language switcher). */
export function languageSwitchUrl(loc: { pathname: string; search: string; hash: string }, lng: SiteLocaleCode): string {
  const { path } = splitLocalePath(loc.pathname)
  return `${localizePath(path, lng)}${loc.search}${loc.hash}`
}
