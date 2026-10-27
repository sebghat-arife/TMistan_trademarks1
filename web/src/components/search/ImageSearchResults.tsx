import { useTranslation } from 'react-i18next'
import { Info, Loader2 } from 'lucide-react'
import { cn, formatNumber } from '@/lib/utils'
import { TrademarkCard } from '@/components/ResultCards'
import { EmptyState } from '@/components/AsyncState'
import type { ImageSearchController, MatchFilter, MatchGroup, UnifiedResult } from './useImageSearch'

const GROUPS: MatchGroup[] = ['text', 'variant', 'visual', 'symbol']

/** Results of an image search (rendered below the hero). */
export function ImageSearchResults({ c, className }: { c: ImageSearchController; className?: string }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const { phase, results, filtered, searchedWith, searchedMode, searchedTerms, searchedModalities, matchFilter, setMatchFilter, groupCounts, mode } = c

  if (phase === 'analysing' || phase === 'searching' || phase === 'loading-example') {
    return (
      <div className={cn('card flex items-center gap-3 p-5 text-[14px] text-ink-700', className)} role="status" aria-live="polite">
        <Loader2 className="h-5 w-5 animate-spin text-brand-600" aria-hidden />
        {phase === 'loading-example' ? t('search.image.examples.loading') : phase === 'analysing' ? t('search.image.recognising') : t('search.image.searching')}
      </div>
    )
  }
  if (phase !== 'done' || !results || !filtered) return null

  const refined = searchedWith === 'advanced'
  const intelligent = searchedMode === 'intelligent'
  const modalityKeys = [
    searchedModalities.text ? 'text' : null,
    searchedModalities.visual ? 'visual' : null,
    searchedModalities.duplicate ? 'duplicate' : null,
  ].filter(Boolean) as ('text' | 'visual' | 'duplicate')[]
  // Intelligent mode was available but the picture yielded no usable words (symbol-only mark,
  // unreadable lettering, recognition failed) → only the near-duplicate channel could be used; say so.
  const limited = mode === 'intelligent' && !searchedModalities.text

  return (
    <section className={className} aria-live="polite" data-testid="image-results-section">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[17px] font-semibold text-ink-900">
            {results.length === 0
              ? t('search.image.noResults')
              : refined && !intelligent
                ? t('search.image.resultsRefined', { count: filtered.length, total: formatNumber(results.length, lng) })
                : intelligent
                  ? t('search.image.resultsCandidates', { count: results.length })
                  : t('search.image.resultsFound', { count: results.length })}
          </p>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-600" data-testid="image-searched-with">
            {intelligent
              ? t('search.image.searchedWith', { list: modalityKeys.map((k) => t(`search.image.modality.${k}`)).join(' · ') })
              : t('search.image.searchedBasic')}
            {intelligent && searchedTerms.length > 0 && (
              <>
                {' '}
                <span className="text-ink-500">{t('search.image.searchedWords')}</span>{' '}
                <span className="font-medium text-ink-800" dir="auto">{searchedTerms.join(' ')}</span>
              </>
            )}
          </p>
          {limited && (
            <p className="mt-1 flex items-start gap-1.5 text-[12px] text-amber-900" role="status" data-testid="image-limited-note">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {t('search.image.limited.noText')}
            </p>
          )}
        </div>
      </div>

      {results.length === 0 ? (
        <EmptyState className="mt-4" title={t('search.image.noResults')} hint={t('search.image.noResultsHint')} />
      ) : (
        <>
          {intelligent && (
            <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label={t('search.image.groups.filterLabel')} data-testid="match-filters">
              <FilterChip value="all" current={matchFilter} count={results.length} onSelect={setMatchFilter} label={t('search.image.groups.all')} />
              {GROUPS.filter((g) => groupCounts[g] > 0).map((g) => (
                <FilterChip key={g} value={g} current={matchFilter} count={groupCounts[g]} onSelect={setMatchFilter} label={t(`search.image.groups.${g}`)} />
              ))}
            </div>
          )}
          <p className="mt-3 max-w-3xl text-[12px] leading-relaxed text-ink-500">{t('search.image.indicatorNote')}</p>

          {filtered.length === 0 ? (
            <EmptyState className="mt-4" title={t('search.image.noRefined')} hint={t('search.image.noRefinedHint')} />
          ) : (
            <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="image-results">
              {filtered.map((r) => (
                <li key={r.id} className="flex min-w-0 flex-col" data-group={r.group}>
                  <div className="relative flex flex-1">
                    <TrademarkCard r={r} className="w-full" detailed />
                    <GroupBadge group={r.group} />
                  </div>
                  <Evidence r={r} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function FilterChip({ value, current, count, onSelect, label }: { value: MatchFilter; current: MatchFilter; count: number; onSelect: (v: MatchFilter) => void; label: string }) {
  const { i18n } = useTranslation()
  const on = current === value
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onSelect(value)}
      className={cn('inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold transition-colors', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-brand-400')}
      data-testid={`match-filter-${value}`}
    >
      {label}
      <span className={cn('rounded-full px-1.5 text-[11px] tabular-nums', on ? 'bg-white/20' : 'bg-ink-100 text-ink-600')} dir="ltr">{formatNumber(count, i18n.resolvedLanguage)}</span>
    </button>
  )
}

const GROUP_STYLE: Record<MatchGroup, string> = {
  text: 'bg-brand-600 text-white',
  variant: 'bg-amber-100 text-amber-900',
  visual: 'bg-navy-900 text-white',
  symbol: 'bg-ink-100 text-ink-700',
}

export function GroupBadge({ group }: { group: MatchGroup }) {
  const { t } = useTranslation()
  return (
    <span className={cn('pointer-events-none absolute end-3 top-3 max-w-[70%] truncate rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-sm', GROUP_STYLE[group])} data-testid="match-group">
      {t(`search.image.groups.${group}`)}
    </span>
  )
}

/** Scores (separately: text / visual / combined) and the plain-language reasons for one candidate. */
function Evidence({ r }: { r: UnifiedResult }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const pct = (v: number) => formatNumber(Math.round(Math.min(1, Math.max(0, v)) * 100), lng)
  const reasons = reasonKeys(r)
  const basic = r.mode === 'basic'
  return (
    <div className="mt-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-[12px] text-ink-700" data-testid="evidence">
      <dl className="flex flex-wrap gap-x-3 gap-y-1 tabular-nums" dir="ltr">
        {!basic && r.text_score > 0 && (
          <div className="flex gap-1"><dt className="text-ink-500">{t('search.image.scores.text')}</dt><dd className="font-semibold text-ink-900">{pct(r.text_score)}%</dd></div>
        )}
        {r.visual_score > 0 && (
          <div className="flex gap-1"><dt className="text-ink-500">{t('search.image.scores.visual')}</dt><dd className="font-semibold text-ink-900">{pct(r.visual_score)}%</dd></div>
        )}
        {!basic && (
          <div className="flex gap-1"><dt className="text-ink-500">{t('search.image.scores.combined')}</dt><dd className="font-semibold text-brand-800">{pct(r.combined_score)}%</dd></div>
        )}
      </dl>
      {reasons.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 ps-4 text-ink-600">
          {reasons.map((k) => (
            <li key={k.key}>
              {t(`search.image.reasons.${k.key}`)}
              {k.detail && (
                <>
                  {': '}
                  <span className="font-medium text-ink-800" dir="auto">{k.detail}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function reasonKeys(r: UnifiedResult): { key: string; detail?: string }[] {
  const out: { key: string; detail?: string }[] = []
  const tr = r.reasons?.text
  if (tr) {
    const detail = tr.matched && tr.term && tr.matched !== tr.term ? `${tr.term} ↔ ${tr.matched}` : undefined
    if (tr.kind === 'exact') out.push({ key: 'sameWording', detail })
    else if (tr.variant) out.push({ key: 'transliteration', detail })
    else if (tr.kind === 'phonetic') out.push({ key: 'soundsAlike', detail })
    else out.push({ key: 'similarWording', detail })
    if (tr.field === 'ocr') out.push({ key: 'ocrOfStoredImage' })
  }
  const types = r.match_types ?? []
  if (types.includes('near_duplicate')) out.push({ key: 'nearIdentical' })
  else if (types.includes('visual_high')) out.push({ key: 'highVisual' })
  else if (types.includes('visual')) out.push({ key: 'similarLayout' })
  if (r.reasons?.class_filter) out.push({ key: 'matchingClass' })
  return out
}
