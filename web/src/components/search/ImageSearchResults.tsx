import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { cn, formatNumber } from '@/lib/utils'
import { TrademarkCard } from '@/components/ResultCards'
import { EmptyState } from '@/components/AsyncState'
import type { ImageSearchController } from './useImageSearch'

/** Results of an image search (rendered below the hero). */
export function ImageSearchResults({ c, className }: { c: ImageSearchController; className?: string }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const { phase, results, filtered, searchedWith } = c

  if (phase === 'analysing' || phase === 'searching' || phase === 'loading-example') {
    return (
      <div className={cn('card flex items-center gap-3 p-5 text-[14px] text-ink-700', className)} role="status" aria-live="polite">
        <Loader2 className="h-5 w-5 animate-spin text-brand-600" aria-hidden />
        {phase === 'loading-example' ? t('search.image.examples.loading') : phase === 'analysing' ? t('search.image.analysing') : t('search.image.searching')}
      </div>
    )
  }
  if (phase !== 'done' || !results || !filtered) return null

  const refined = searchedWith === 'advanced'
  return (
    <section className={className} aria-live="polite" data-testid="image-results-section">
      {results.length === 0 ? (
        <EmptyState title={t('search.image.noResults')} hint={t('search.image.noResultsHint')} />
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[17px] font-semibold text-ink-900">
                {refined
                  ? t('search.image.resultsRefined', { count: filtered.length, total: formatNumber(results.length, lng) })
                  : t('search.image.resultsFound', { count: results.length })}
              </p>
              <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-500">{t('search.image.indicatorNote')}</p>
            </div>
          </div>
          {filtered.length === 0 ? (
            <EmptyState className="mt-4" title={t('search.image.noRefined')} hint={t('search.image.noRefinedHint')} />
          ) : (
            <ul className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4" data-testid="image-results">
              {filtered.map((r) => (
                <li key={r.id} className="relative flex">
                  <TrademarkCard r={r} className="w-full" detailed />
                  <SimilarityBadge value={r.similarity} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

export function SimilarityBadge({ value }: { value: number }) {
  const { t, i18n } = useTranslation()
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  const level = value >= 0.8 ? 'high' : value >= 0.65 ? 'moderate' : 'low'
  return (
    <span
      className={cn(
        'pointer-events-none absolute end-3 top-3 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums shadow-sm',
        level === 'high' ? 'bg-brand-600 text-white' : level === 'moderate' ? 'bg-amber-100 text-amber-900' : 'bg-ink-100 text-ink-700',
      )}
      title={t(`search.image.level.${level}`)}
      dir="ltr"
    >
      {t('search.image.similarity', { percent: formatNumber(pct, i18n.resolvedLanguage) })}
    </span>
  )
}
