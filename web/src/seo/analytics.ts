/* ---------------------------------------------------------------------------
 * Google Analytics 4 — loaded only when
 *   (a) a measurement ID was supplied at build time (SITE_GA4_MEASUREMENT_ID), and
 *   (b) the visitor has agreed (components/ConsentBar) and has not asked
 *       browsers not to track them (Do Not Track / Global Privacy Control).
 * Nothing is loaded, and no cookie is written, before both hold.
 * ------------------------------------------------------------------------- */
declare const __SITE_GA4_ID__: string

export const GA4_ID: string = /^G-[A-Z0-9]+$/i.test(__SITE_GA4_ID__ ?? '') ? __SITE_GA4_ID__ : ''

export const CONSENT_STORAGE_KEY = 'tmistan.consent.analytics.v1'
export type ConsentChoice = 'granted' | 'denied'

type Gtag = (...args: unknown[]) => void
declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: Gtag
  }
  interface Navigator {
    globalPrivacyControl?: boolean
  }
}

export function analyticsConfigured(): boolean {
  return GA4_ID !== ''
}

/** Browser-level opt-out signals are honoured without asking. */
export function trackingOptedOut(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true
}

export function storedConsent(): ConsentChoice | null {
  try {
    const v = localStorage.getItem(CONSENT_STORAGE_KEY)
    return v === 'granted' || v === 'denied' ? v : null
  } catch {
    return null
  }
}

export function saveConsent(choice: ConsentChoice) {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, choice)
  } catch {
    /* ignore */
  }
  if (choice === 'granted') startAnalytics()
}

let started = false

/** Inject gtag.js once. Page views for SPA navigations come from GA4 "Enhanced measurement" (history changes). */
export function startAnalytics() {
  if (started || !analyticsConfigured() || typeof document === 'undefined') return
  started = true
  window.dataLayer = window.dataLayer ?? []
  const gtag: Gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments)
  }
  window.gtag = gtag
  gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' })
  gtag('js', new Date())
  gtag('config', GA4_ID, { anonymize_ip: true })
  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA4_ID)}`
  document.head.appendChild(s)
}

/** Called once at start-up: resume analytics for visitors who already agreed. */
export function resumeAnalyticsIfConsented() {
  if (!analyticsConfigured() || trackingOptedOut()) return
  if (storedConsent() === 'granted') startAnalytics()
}
