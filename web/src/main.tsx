import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import type { DehydratedState } from '@tanstack/react-query'
import i18n, { applyDocumentDirection, loadLanguage, rememberLanguage, storedLanguage } from '@/i18n'
import { resolveClientLocale } from '@/seo/clientLocale'
import { resumeAnalyticsIfConsented } from '@/seo/analytics'
import './index.css'
import App from './App.tsx'

/** Query cache embedded by the prerenderer (scripts/prerender.mjs) for this page, if any. */
function readDehydratedState(): DehydratedState | null {
  const el = document.getElementById('__TMISTAN_STATE__')
  if (!el?.textContent) return null
  try {
    return JSON.parse(el.textContent) as DehydratedState
  } catch {
    return null
  }
}

async function start() {
  const { lng, basename, redirect } = resolveClientLocale(window.location, {
    stored: storedLanguage(),
    navigatorLangs: navigator.languages ?? [navigator.language],
  })
  if (redirect) {
    // First visit with a remembered/browser language, or an old ?lang= link: load the
    // document of that language (prerendered per language) instead of re-rendering this one.
    rememberLanguage(lng)
    window.location.replace(redirect)
    return
  }
  rememberLanguage(lng)
  await loadLanguage(lng)
  applyDocumentDirection(i18n.resolvedLanguage ?? lng)
  resumeAnalyticsIfConsented()

  const root = document.getElementById('root')!
  const app = (
    <StrictMode>
      <App basename={basename} dehydratedState={readDehydratedState()} />
    </StrictMode>
  )
  // Pages prerendered at build time (scripts/prerender.mjs) are hydrated in place, so
  // the content stays on screen while the JavaScript loads. Anything else — the
  // SPA shell for non-prerendered URLs, or a prerendered page opened with a query
  // string (a search) — is rendered from scratch.
  const prerenderedPath = root.dataset.prerendered
  if (prerenderedPath && prerenderedPath === window.location.pathname && !window.location.search) {
    hydrateRoot(root, app, {
      onRecoverableError(err) {
        console.warn('[tmistan] hydration recovered:', err instanceof Error ? err.message : err)
      },
    })
  } else {
    createRoot(root).render(app)
  }
}

void start()
