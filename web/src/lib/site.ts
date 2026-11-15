/** Public, non-secret site metadata injected at build time (see vite.config.ts). */
declare const __SITE_CONTACT__: {
  email: string
  phone: string
  address: string
  facebook: string
  twitter: string
  linkedin: string
  masnad: string
}
declare const __APP_VERSION__: string
declare const __SITE_CANONICAL_URL__: string

export const SITE_CONTACT = __SITE_CONTACT__
export const APP_VERSION = __APP_VERSION__

/** Public website of Masnad Law Firm, or '' when not configured (links are then omitted). */
export const MASNAD_URL = /^https?:\/\//i.test(SITE_CONTACT.masnad ?? '') ? SITE_CONTACT.masnad : ''

/**
 * Canonical public origin of the site (https://tmistan.com — the apex domain is the primary
 * host; www.tmistan.com redirects to it), without a trailing slash. Used for canonical links,
 * hreflang alternates, Open Graph URLs, structured data, the sitemap and PDF reports.
 */
export const CANONICAL_URL = /^https?:\/\//i.test(__SITE_CANONICAL_URL__ ?? '')
  ? __SITE_CANONICAL_URL__.replace(/\/+$/, '')
  : typeof window !== 'undefined'
    ? window.location.origin
    : 'https://tmistan.com'
