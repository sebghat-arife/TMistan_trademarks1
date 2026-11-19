/* ---------------------------------------------------------------------------
 * Analytics bridge for Google Tag Manager.
 *
 * The consent-first GTM loader is part of the shared HTML document (web/index.html,
 * hence every prerendered page and the SPA shell): it sets the Consent Mode v2
 * defaults from the stored choice and requests gtm.js only while analytics
 * consent is granted. This module
 *
 *   1. keeps Google Consent Mode in sync with the visitor's choice
 *      (components/ConsentBar, components/AnalyticsPreferences) and triggers the
 *      container load the moment consent is given; browser opt-out signals
 *      (Do Not Track / Global Privacy Control) always win;
 *
 *   2. pushes one `page_view` dataLayer event per document / client-side
 *      navigation *after* <Seo> has written the final title and canonical URL —
 *      so GA4, configured inside GTM, receives correct SPA page views without the
 *      stale-title problem of history-change triggers and without duplicates.
 *      Nothing is recorded before consent: the current page is reported once the
 *      visitor agrees.
 *
 * GA4 itself is configured in the GTM container (docs/ANALYTICS.md).
 * ------------------------------------------------------------------------- */
import { useSyncExternalStore } from 'react'

declare const __SITE_GTM_ID__: string

export const GTM_ID: string = /^GTM-[A-Z0-9]+$/.test(__SITE_GTM_ID__ ?? '') ? __SITE_GTM_ID__ : ''

export const CONSENT_STORAGE_KEY = 'tmistan.consent.analytics.v1'
export type ConsentChoice = 'granted' | 'denied'

type Gtag = (...args: unknown[]) => void
declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: Gtag
    /** Defined by the inline loader in index.html; loads gtm.js once. */
    __tmistanLoadGtm?: () => void
  }
  interface Navigator {
    globalPrivacyControl?: boolean
  }
}

export function analyticsConfigured(): boolean {
  return GTM_ID !== ''
}

/** Browser-level opt-out signals are honoured without asking. */
export function trackingOptedOut(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true
}

/** In-memory copy of the choice: keeps the UI consistent when localStorage is unavailable. */
let sessionChoice: ConsentChoice | null = null
const listeners = new Set<() => void>()

export function storedConsent(): ConsentChoice | null {
  try {
    const v = localStorage.getItem(CONSENT_STORAGE_KEY)
    if (v === 'granted' || v === 'denied') return v
  } catch {
    /* ignore */
  }
  return sessionChoice
}

function subscribeConsent(cb: () => void): () => void {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === CONSENT_STORAGE_KEY) cb()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

const serverChoice = () => null

/** The visitor's current choice, shared live by every consent control on the page. */
export function useConsentChoice(): ConsentChoice | null {
  return useSyncExternalStore(subscribeConsent, storedConsent, serverChoice)
}

function dataLayer(): unknown[] {
  window.dataLayer = window.dataLayer ?? []
  return window.dataLayer
}

/** Consent commands must be pushed as an `arguments` object (that is what gtag.js / GTM recognise). */
function gtag(..._args: unknown[]): void {
  // eslint-disable-next-line prefer-rest-params
  dataLayer().push(arguments)
}

/** Persist the visitor's choice and tell the tags about it (Consent Mode `update` + a dataLayer event). */
export function saveConsent(choice: ConsentChoice) {
  sessionChoice = choice
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, choice)
  } catch {
    /* private mode etc. — the choice then lasts for this page only */
  }
  applyConsent(choice)
  for (const cb of listeners) cb()
}

export function applyConsent(choice: ConsentChoice) {
  if (typeof window === 'undefined' || !analyticsConfigured()) return
  const granted = choice === 'granted' && !trackingOptedOut()
  gtag('consent', 'update', { analytics_storage: granted ? 'granted' : 'denied' })
  dataLayer().push({ event: 'tmistan_consent', consent_analytics: granted ? 'granted' : 'denied' })
  if (granted) {
    window.__tmistanLoadGtm?.()
    flushPageView() // the page on which the visitor agreed
  }
}

/** True while analytics may run: explicit consent and no browser opt-out signal. */
export function consentGranted(): boolean {
  return storedConsent() === 'granted' && !trackingOptedOut()
}

/* ── Page views ─────────────────────────────────────────────────────────── */

export type PageType = 'home' | 'search' | 'record' | 'guide' | 'guides' | 'article' | 'knowledge' | 'legal' | 'not_found' | 'page'

export type PageViewInfo = {
  /** Locale-less route path ('/guides/trademark-search-afghanistan'). */
  routePath: string
  title: string
  language: string
  robots?: string
  /** Explicit classification (e.g. the not-found view); otherwise derived from the path. */
  pageType?: PageType
}

let current: { url: string; event: Record<string, unknown> } | null = null
let pushedUrl: string | null = null

/** Classify a route for the `page_type` parameter (helps GA4 reports; carries no personal data). */
export function pageTypeFor(routePath: string, search: string): PageType {
  if (routePath === '/') {
    const params = new URLSearchParams(search)
    return params.has('q') || params.get('mode') === 'image' ? 'search' : 'home'
  }
  if (routePath.startsWith('/trademark/')) return 'record'
  if (routePath === '/guides') return 'guides'
  if (routePath.startsWith('/guides/')) return 'guide'
  if (routePath === '/knowledge-center') return 'knowledge'
  if (routePath.startsWith('/knowledge-center/')) return 'article'
  if (routePath.startsWith('/legal')) return 'legal'
  return 'page'
}

/**
 * Record a page view for the current document URL. Called by <Seo> once the head is final;
 * repeated calls for the same URL (re-renders, data arriving later) are ignored. Admin pages
 * are never reported. Without consent the event is only kept in memory for the current page
 * and pushed if the visitor agrees while on it.
 */
export function trackPageView(info: PageViewInfo) {
  if (typeof window === 'undefined' || !analyticsConfigured()) return
  const { pathname, search, href } = window.location
  if (pathname.startsWith('/admin') || info.routePath.startsWith('/admin')) {
    current = null
    return
  }
  const url = pathname + search
  if (current?.url === url) return
  const type = info.pageType ?? pageTypeFor(info.routePath, search)
  const event: Record<string, unknown> = {
    event: 'page_view',
    page_location: href,
    page_path: url,
    page_title: info.title,
    page_language: info.language,
    page_type: type,
    page_indexable: info.robots?.includes('noindex') ? 'no' : 'yes',
  }
  const q = new URLSearchParams(search).get('q')
  if (type === 'search' && q) event.search_term = q
  current = { url, event }
  flushPageView()
}

function flushPageView() {
  if (!current || pushedUrl === current.url || !consentGranted()) return
  pushedUrl = current.url
  dataLayer().push(current.event)
}

