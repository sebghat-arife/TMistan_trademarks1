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

/** Canonical public origin of the site (e.g. https://www.tmistan.com), without a trailing slash. */
export const CANONICAL_URL = /^https?:\/\//i.test(__SITE_CANONICAL_URL__ ?? '') ? __SITE_CANONICAL_URL__.replace(/\/+$/, '') : window.location.origin
