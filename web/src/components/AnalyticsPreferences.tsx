import { useTranslation } from 'react-i18next'
import { BarChart3, Check } from 'lucide-react'
import { analyticsConfigured, saveConsent, trackingOptedOut, useConsentChoice } from '@/seo/analytics'
import { useIsClient } from '@/lib/useIsClient'
import { cn } from '@/lib/utils'

/**
 * "Change your choice at any time" control promised by the consent notice — shown on the
 * Privacy Policy page. Displays the current analytics consent and lets the visitor grant or
 * withdraw it; Consent Mode is updated immediately (src/seo/analytics.ts). Rendered only in the
 * browser (the stored choice is per device) and only when Tag Manager is part of the build.
 */
export function AnalyticsPreferences({ className }: { className?: string }) {
  const { t } = useTranslation()
  const isClient = useIsClient()
  const current = useConsentChoice()
  if (!isClient || !analyticsConfigured()) return null
  const optedOut = trackingOptedOut()
  const status = optedOut ? t('consent.manage.optedOut') : current === 'granted' ? t('consent.manage.granted') : current === 'denied' ? t('consent.manage.denied') : t('consent.manage.unset')
  return (
    <section className={cn('rounded-xl border border-ink-200 bg-ink-50 p-5', className)} aria-labelledby="analytics-preferences-title" data-testid="analytics-preferences">
      <div className="flex items-start gap-3">
        <span className="icon-circle h-9 w-9 shrink-0"><BarChart3 className="h-4 w-4" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h3 id="analytics-preferences-title" className="font-serif text-[18px] font-semibold text-navy-900">{t('consent.manage.title')}</h3>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-700">{t('consent.manage.text')}</p>
          <p className="mt-3 text-[14px] text-ink-900" data-testid="analytics-status">
            <span className="font-semibold">{t('consent.manage.current')}</span> {status}
          </p>
          {!optedOut && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => saveConsent('granted')} className={cn('btn h-9 px-4 text-[13px]', current === 'granted' ? 'btn-primary' : 'btn-secondary')} aria-pressed={current === 'granted'} data-testid="analytics-allow">
                {current === 'granted' && <Check className="h-3.5 w-3.5" aria-hidden />}
                {t('consent.accept')}
              </button>
              <button type="button" onClick={() => saveConsent('denied')} className={cn('btn h-9 px-4 text-[13px]', current === 'denied' ? 'btn-primary' : 'btn-secondary')} aria-pressed={current === 'denied'} data-testid="analytics-decline">
                {current === 'denied' && <Check className="h-3.5 w-3.5" aria-hidden />}
                {t('consent.decline')}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
