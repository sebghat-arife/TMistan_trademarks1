import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { analyticsConfigured, saveConsent, storedConsent, trackingOptedOut, type ConsentChoice } from '@/seo/analytics'
import { useIsClient } from '@/lib/useIsClient'

/**
 * Small, dismissible analytics consent notice. Rendered only when a GA4
 * measurement ID is configured for the build, the visitor has not decided yet
 * and the browser does not already signal an opt-out. Never prerendered.
 */
export function ConsentBar() {
  const { t } = useTranslation()
  const isClient = useIsClient()
  const [choice, setChoice] = useState<ConsentChoice | null>(null)
  if (!isClient || !analyticsConfigured() || trackingOptedOut() || choice || storedConsent()) return null
  const decide = (c: ConsentChoice) => {
    saveConsent(c)
    setChoice(c)
  }
  return (
    <aside
      role="region"
      aria-label={t('consent.title')}
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-xl border border-ink-200 bg-white p-4 shadow-[0_18px_50px_-24px_rgba(16,35,58,0.45)] sm:inset-x-auto sm:end-5 sm:bottom-5"
      data-testid="consent-bar"
    >
      <p className="text-[14px] font-semibold text-ink-900">{t('consent.title')}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-700">
        {t('consent.text')}{' '}
        <Link to="/legal/privacy" className="font-medium text-brand-700 underline underline-offset-2">{t('consent.privacy')}</Link>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => decide('granted')} className="btn-primary h-9 px-4 text-[13px]">{t('consent.accept')}</button>
        <button type="button" onClick={() => decide('denied')} className="btn-secondary h-9 px-4 text-[13px]">{t('consent.decline')}</button>
      </div>
    </aside>
  )
}
