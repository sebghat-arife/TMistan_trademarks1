import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Trans, useTranslation } from 'react-i18next'
import { AlertTriangle, BookOpenText, ChevronDown, Clock3, LayoutGrid, Lock, Scale, Search, ShieldCheck, SlidersHorizontal, Table2 } from 'lucide-react'
import { filterOptionsQuery, registryStatsQuery, searchByNumbersSupportedQuery, searchTrademarksQuery } from '@/services'
import { CLEARED_FILTERS, countActiveFilters, hasAnyCriteria, parseSearchParams, toRpcArgs, toSearchParams, type SearchState } from '@/lib/searchParams'
import { cn, formatNumber } from '@/lib/utils'
import { CornerAccent, GirihMotif } from '@/components/ornament'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { Pagination, ResultGrid, ResultTable } from '@/components/ResultCards'
import { EmptyState, ErrorState } from '@/components/AsyncState'
import { SearchModeSwitch, type SearchMode } from '@/components/search/SearchModeSwitch'
import { AdvancedSearchPanel, type AdvancedDraft } from '@/components/search/AdvancedSearchPanel'
import { ActiveFilters } from '@/components/search/ActiveFilters'
import { SearchTips } from '@/components/search/SearchTips'
import { ImageSearchCard } from '@/components/search/ImageSearchCard'
import { ImageSearchResults } from '@/components/search/ImageSearchResults'
import { ImageSearchExamples } from '@/components/search/ImageSearchExamples'
import { useImageSearch } from '@/components/search/useImageSearch'

/** Source of the hero photograph (attribution required by its licence — see public/img/CREDITS.md). */
const HERO_PHOTO_SOURCE = 'https://commons.wikimedia.org/wiki/File:Darulaman_palace.jpg'

type FormDraft = AdvancedDraft & { q: string }

const toDraft = (s: SearchState): FormDraft => ({
  q: s.q, mark: s.mark, serial: s.serial, applicant: s.applicant, applicationNumber: s.applicationNumber, registrationNumber: s.registrationNumber,
  gazette: s.gazette, classes: s.classes, goods: s.goods, type: s.type, from: s.from, to: s.to, fuzzy: s.fuzzy,
})

/**
 * The search experience of the landing page (`/`): hero with the mode switch and
 * the search card, then the results. The URL is the single source of truth (see
 * lib/searchParams), so every search is linkable: /?q=nike&class=25. Two modes
 * share the hero:
 *   • Search by Name or Details → database function search_trademarks
 *   • Search by Image           → browser-side descriptor + search_trademarks_by_image
 * Results, filters and paging are all server-side; nothing is filtered in the
 * browser except the optional refinement of an image search's candidate set.
 *
 * `landing` (the rest of the home page) is rendered below the hero while no
 * search is running; as soon as results are shown — or the image search is
 * open — the page is the results page and the landing sections step aside.
 */
export function SearchExperience({ landing }: { landing?: ReactNode }) {
  const { t, i18n } = useTranslation()
  const [sp, setSp] = useSearchParams()
  const state = useMemo(() => parseSearchParams(sp), [sp])
  const imageMode = sp.get('mode') === 'image'
  const enabled = !imageMode && hasAnyCriteria(state)
  const compact = enabled
  const idle = !imageMode && !enabled

  // Form draft, re-derived whenever the URL changes (back/forward, chips, links).
  const urlKey = sp.toString()
  const [draftState, setDraftState] = useState(() => ({ key: urlKey, draft: toDraft(state) }))
  if (draftState.key !== urlKey) setDraftState({ key: urlKey, draft: toDraft(state) })
  const draft = draftState.draft
  const patchDraft = (patch: Partial<FormDraft>) => setDraftState((d) => ({ key: d.key, draft: { ...d.draft, ...patch } }))

  const [advancedOpen, setAdvancedOpen] = useState(() => countActiveFilters(state) > 0)
  const numbers = useQuery({ ...searchByNumbersSupportedQuery(), enabled: advancedOpen && !imageMode })
  const { data: options } = useQuery({ ...filterOptionsQuery(), enabled: !imageMode && (advancedOpen || enabled) })
  const stats = useQuery({ ...registryStatsQuery(), enabled: !imageMode && !compact })
  const img = useImageSearch(imageMode)

  const update = useCallback(
    (patch: Partial<SearchState>) => {
      const next = { ...state, ...patch }
      const onlyPage = Object.keys(patch).length === 1 && patch.page !== undefined
      const nextSp = toSearchParams(next)
      if (sp.get('mode') === 'image') nextSp.set('mode', 'image')
      setSp(nextSp, { replace: !onlyPage })
      if (onlyPage) window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [state, sp, setSp],
  )

  const setMode = (mode: SearchMode) => {
    const next = new URLSearchParams(sp)
    if (mode === 'image') next.set('mode', 'image')
    else next.delete('mode')
    setSp(next, { replace: true })
  }

  const { data: page, isFetching, isError, error, refetch } = useQuery({ ...searchTrademarksQuery(toRpcArgs(state)), enabled })
  const data = page?.items
  const total = page?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / state.perPage))

  useDocumentTitle(
    imageMode
      ? `${t('search.image.title')} · ${t('app.shortName')}`
      : enabled
        ? `${state.q.trim() ? `${state.q.trim()} — ` : ''}${t('search.resultsTitle')} · ${t('app.shortName')}`
        : t('app.name'),
    idle ? t('search.lead') : undefined,
  )

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const { q, ...adv } = draft
    update({ q, ...adv, page: 1, sort: q.trim() ? 'relevance' : state.sort === 'relevance' ? 'newest' : state.sort })
  }
  const clearAdvanced = () => {
    const { page: _page, ...cleared } = CLEARED_FILTERS
    void _page
    patchDraft({ ...cleared, fuzzy: true })
  }

  return (
    <div>
      {/* ── Hero: heading, mode switch, search card (+ aside) ─────────────── */}
      {/* Idle: ivory hero with the Darulaman photograph. Results / image mode: a compact
          navy title band with a faint lattice — the controls and results below stay on plain surfaces. */}
      <section id="search" className={cn('search-hero scroll-mt-[68px]', compact && 'search-hero-compact')} data-testid="search-hero">
        {compact ? (
          <GirihMotif corner="top-end" size={520} offset={0.45} opacity={0.09} detail="ring" className="hidden text-turquoise-200 md:block" />
        ) : (
          <CornerAccent corner="top-start" size={200} className="hidden lg:block" />
        )}
        {!compact && <div className="search-hero-photo" aria-hidden />}
        {!compact && <a className="search-hero-credit" href={HERO_PHOTO_SOURCE} target="_blank" rel="noreferrer">{t('search.photoCredit')}</a>}
        <div className={cn('container-x relative', compact ? 'pb-7 pt-6 md:pt-8' : 'pb-10 pt-10 md:pb-14 md:pt-14')}>
          {!compact && <p className="eyebrow">{t('search.eyebrow')}</p>}
          <h1 className={cn('max-w-3xl font-serif font-semibold leading-[1.1] tracking-[-0.015em]', compact ? 'text-[26px] text-white md:text-[30px]' : 'mt-3 text-[34px] text-navy-900 sm:text-[42px] lg:text-[50px]')}>
            <Trans i18nKey="search.titleRich" components={{ 1: <span className={compact ? 'text-turquoise-200' : 'text-brand-700'} /> }} />
          </h1>
          {!compact && <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-700 md:text-[17px]">{t('search.lead')}</p>}

          <SearchModeSwitch mode={imageMode ? 'image' : 'text'} onChange={setMode} className={cn('w-full sm:w-auto', compact ? 'mt-4' : 'mt-7')} />

          <div className={cn('mt-4 grid items-start gap-5', !compact && 'lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px]')}>
            {imageMode ? (
              <ImageSearchCard c={img} />
            ) : (
              <form id="search-panel-text" role="search" aria-labelledby="search-tab-text" onSubmit={submit} className="card p-4 shadow-[0_18px_50px_-24px_rgba(16,35,58,0.35)] md:p-5" data-testid="text-search-card">
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute start-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-400" aria-hidden />
                    <input
                      type="search"
                      value={draft.q}
                      onChange={(e) => patchDraft({ q: e.target.value })}
                      placeholder={t('search.keywordPlaceholder')}
                      aria-label={t('search.keywordPlaceholder')}
                      className="h-12 w-full rounded-md border border-ink-200 bg-white pe-4 ps-11 text-[15px] text-ink-900 outline-none placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                      data-testid="keyword-input"
                      enterKeyHint="search"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" className="btn-primary h-12 flex-1 px-6 text-[15px] md:flex-none" data-testid="search-submit">
                      <Search className="h-4 w-4" aria-hidden /> {t('search.searchButton')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdvancedOpen((v) => !v)}
                      aria-expanded={advancedOpen}
                      aria-controls="advanced-search"
                      className={cn('btn-secondary h-12 px-4 text-[14px]', advancedOpen && 'border-brand-200 bg-brand-50 text-brand-800 hover:bg-brand-50')}
                      data-testid="advanced-toggle"
                    >
                      <SlidersHorizontal className="h-4 w-4" aria-hidden />
                      <span className="hidden sm:inline">{t('search.advanced.toggle')}</span>
                      <ChevronDown className={cn('h-4 w-4 transition-transform', advancedOpen && 'rotate-180')} aria-hidden />
                    </button>
                  </div>
                </div>
                {advancedOpen && (
                  <AdvancedSearchPanel
                    id="advanced-search"
                    className="mt-4"
                    draft={draft}
                    onChange={patchDraft}
                    onClear={clearAdvanced}
                    numbersSupported={numbers.data}
                    options={options}
                  />
                )}
              </form>
            )}

            {!compact && (imageMode ? (
              <SearchTips />
            ) : (
              <aside className="card border-ink-200/80 bg-white/85 p-5 backdrop-blur-sm" aria-labelledby="gazette-aside-title">
                <div className="flex items-start gap-3 border-s-[3px] border-brand-600 ps-3">
                  <BookOpenText className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden />
                  <div>
                    <h2 id="gazette-aside-title" className="text-[14px] font-semibold text-ink-900">{t('search.aside.title')}</h2>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-600">{t('search.aside.text')}</p>
                    {stats.data && stats.data.trademarks > 0 && (
                      <p className="mt-2 text-[12px] font-medium text-ink-500" data-testid="aside-stats">
                        {t('search.aside.stats', { records: formatNumber(stats.data.trademarks, i18n.resolvedLanguage), gazettes: formatNumber(stats.data.gazettes, i18n.resolvedLanguage) })}
                      </p>
                    )}
                  </div>
                </div>
              </aside>
            ))}
          </div>
        </div>
      </section>

      {/* ── Below the hero: results / examples / trust strip ─────────────── */}
      <div className="container-x py-8 md:py-10">
        {imageMode ? (
          <div className="space-y-10">
            <ImageSearchResults c={img} />
            {img.phase !== 'done' && <ImageSearchExamples onPick={(ex) => void img.useExample(ex)} disabled={!img.available || img.busy} />}
            {img.phase !== 'done' && <TrustStrip />}
          </div>
        ) : idle ? (
          <TrustStrip />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[15px] text-ink-800" aria-live="polite" data-testid="results-summary">
                {data ? (
                  <>
                    <span className="font-semibold">{t('search.resultsFound', { count: total })}</span>
                    {state.q.trim() && <> {t('search.resultsFor', { query: state.q.trim() })}</>}
                  </>
                ) : (
                  <span className="text-ink-500">{t('common.loading')}</span>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center gap-1" role="group" aria-label={t('search.view.grid')}>
                  <button type="button" onClick={() => update({ view: 'grid' })} className={cn('toggle', state.view === 'grid' && 'toggle-on')} aria-pressed={state.view === 'grid'}>
                    <LayoutGrid className="h-4 w-4" /> {t('search.view.grid')}
                  </button>
                  <button type="button" onClick={() => update({ view: 'table' })} className={cn('toggle', state.view === 'table' && 'toggle-on')} aria-pressed={state.view === 'table'}>
                    <Table2 className="h-4 w-4" /> {t('search.view.table')}
                  </button>
                </div>
                <label className="inline-flex items-center gap-2 text-[14px] text-ink-700">
                  <span className="whitespace-nowrap">{t('search.sortBy')}</span>
                  <span className="relative">
                    <select
                      value={state.sort}
                      onChange={(e) => update({ sort: e.target.value as SearchState['sort'], page: 1 })}
                      className="h-9 appearance-none rounded-md border border-ink-200 bg-white pe-8 ps-3 text-[13px] font-medium text-ink-800 outline-none focus:border-brand-500"
                    >
                      {(['relevance', 'newest', 'oldest', 'mark_asc', 'mark_desc', 'serial'] as const).map((s) => (
                        <option key={s} value={s}>{t(`search.sort.${s}`)}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-500" aria-hidden />
                  </span>
                </label>
              </div>
            </div>

            <ActiveFilters state={state} onApply={update} className="mt-3" />

            {page?.numbersIgnored && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900" role="status" data-testid="numbers-ignored">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <p>{t('search.advanced.numbersIgnored')}</p>
              </div>
            )}

            <div className={cn('mt-4 transition-opacity', isFetching && 'opacity-60')}>
              {isError ? (
                <ErrorState error={error} onRetry={() => void refetch()} />
              ) : !data ? (
                <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4" aria-hidden>
                  {Array.from({ length: 8 }).map((_, i) => <li key={i} className="card h-[250px] animate-pulse bg-ink-50" />)}
                </ul>
              ) : data.length === 0 ? (
                <EmptyState title={t('search.noResults')} hint={t('search.noResultsHint')} />
              ) : state.view === 'table' ? (
                <ResultTable results={data} query={state.q} />
              ) : (
                <ResultGrid results={data} query={state.q} detailed />
              )}
            </div>

            {data && data.length > 0 && (
              <>
                <Pagination page={state.page} pages={pages} onPage={(p) => update({ page: p })} />
                <p className="muted mt-3 flex items-center justify-center gap-3">
                  <span>
                    {t('search.showing', {
                      from: formatNumber((state.page - 1) * state.perPage + 1, i18n.resolvedLanguage),
                      to: formatNumber(Math.min(total, state.page * state.perPage), i18n.resolvedLanguage),
                      total: formatNumber(total, i18n.resolvedLanguage),
                    })}
                  </span>
                  <label className="inline-flex items-center gap-1.5">
                    <span>{t('search.perPage')}</span>
                    <select
                      value={state.perPage}
                      onChange={(e) => update({ perPage: Number(e.target.value) as SearchState['perPage'], page: 1 })}
                      className="h-7 rounded-md border border-ink-200 bg-white px-1.5 text-[12px] font-medium text-ink-800 outline-none focus:border-brand-500"
                      aria-label={t('search.perPage')}
                    >
                      {[20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                </p>
              </>
            )}
          </>
        )}
      </div>

      {idle && landing}
    </div>
  )
}

/** Four short, factual statements from the client's design (no numbers, nothing invented). */
function TrustStrip() {
  const { t } = useTranslation()
  const items = [
    { k: 'sources', icon: ShieldCheck },
    { k: 'legal', icon: Scale },
    { k: 'efficient', icon: Clock3 },
    { k: 'secure', icon: Lock },
  ] as const
  return (
    <ul className="card grid grid-cols-1 divide-y divide-ink-200 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x rtl:lg:divide-x-reverse" data-testid="trust-strip">
      {items.map(({ k, icon: Icon }) => (
        <li key={k} className="flex items-start gap-3 p-5">
          <span className="icon-circle h-10 w-10"><Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden /></span>
          <div>
            <p className="text-[14px] font-semibold text-ink-900">{t(`search.trust.${k}.title`)}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-600">{t(`search.trust.${k}.text`)}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
