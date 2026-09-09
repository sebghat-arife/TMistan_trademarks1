import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronDown, LayoutGrid, Search, Table2 } from 'lucide-react'
import { searchTrademarksQuery } from '@/services'
import { hasAnyCriteria, parseSearchParams, toRpcArgs, toSearchParams, type SearchState } from '@/lib/searchParams'
import { cn, formatNumber } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { FilterBar } from '@/components/FilterBar'
import { Pagination, ResultGrid, ResultTable } from '@/components/ResultCards'
import { EmptyState, ErrorState } from '@/components/AsyncState'

interface Props {
  /** `/trademarks`: list the whole registry (newest gazette first) even with no criteria. */
  browseAll?: boolean
}

export function SearchPage({ browseAll = false }: Props) {
  const { t, i18n } = useTranslation()
  const [sp, setSp] = useSearchParams()
  const state = useMemo(() => {
    const s = parseSearchParams(sp)
    // Browse mode has no query to rank by, so "relevance" degrades to newest.
    if (browseAll && !s.q.trim() && s.sort === 'relevance') s.sort = 'newest'
    return s
  }, [sp, browseAll])
  const [draftQ, setDraftQ] = useState(state.q)

  useEffect(() => {
    setDraftQ(state.q)
  }, [state.q])

  const update = useCallback(
    (patch: Partial<SearchState>) => {
      const next = { ...state, ...patch }
      const onlyPage = Object.keys(patch).length === 1 && patch.page !== undefined
      setSp(toSearchParams(next), { replace: !onlyPage })
      if (onlyPage) window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [state, setSp],
  )

  const enabled = browseAll || hasAnyCriteria(state)
  const { data: page, isFetching, isError, error, refetch } = useQuery({ ...searchTrademarksQuery(toRpcArgs(state)), enabled })
  const data = page?.items

  const total = page?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / state.perPage))

  const pageTitle = browseAll ? t('trademarksPage.title') : t('search.title')
  useDocumentTitle(state.q ? `${state.q} — ${pageTitle} · ${t('app.shortName')}` : `${pageTitle} · ${t('app.shortName')}`)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    update({ q: draftQ, page: 1, sort: draftQ.trim() ? 'relevance' : state.sort === 'relevance' ? 'newest' : state.sort })
  }

  return (
    <div className="container-x py-6">
      {browseAll && (
        <div className="mb-4">
          <h1 className="text-[26px] font-bold text-ink-900">{t('trademarksPage.title')}</h1>
          <p className="muted mt-1 text-[14px]">{t('trademarksPage.subtitle')}</p>
        </div>
      )}

      {/* ── Search bar ─────────────────────────────────────────────────── */}
      <form onSubmit={submit} role="search" className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex h-11 flex-1 items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
          <Search className="h-[18px] w-[18px] shrink-0 text-ink-400" aria-hidden />
          <input
            type="search"
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
            placeholder={t('home.searchPlaceholder')}
            aria-label={t('home.searchPlaceholder')}
            className="h-full w-full bg-transparent text-[15px] text-ink-900 outline-none placeholder:text-ink-400"
          />
        </div>
        <button type="submit" className="btn-primary h-11 px-6 text-[15px]">
          {t('home.searchButton')}
        </button>
      </form>

      {/* ── Filters row ────────────────────────────────────────────────── */}
      <div className="mt-4">
        <FilterBar state={state} onApply={update} />
      </div>

      {/* ── Results header ─────────────────────────────────────────────── */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[15px] text-ink-800" aria-live="polite">
          {enabled && data ? (
            <>
              <span className="font-semibold">{t('search.resultsFound', { count: total })}</span>
              {state.q.trim() && <> {t('search.resultsFor', { query: state.q.trim() })}</>}
            </>
          ) : enabled ? (
            <span className="text-ink-500">{t('common.loading')}</span>
          ) : (
            <span className="text-ink-500">{t('search.startPrompt')}</span>
          )}
        </p>
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-1" role="group" aria-label="View">
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

      {/* ── Results ────────────────────────────────────────────────────── */}
      <div className={cn('mt-4 transition-opacity', isFetching && 'opacity-60')}>
        {isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : !enabled ? null : !data ? (
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4" aria-hidden>
            {Array.from({ length: 8 }).map((_, i) => <li key={i} className="card h-[250px] animate-pulse bg-ink-50" />)}
          </ul>
        ) : data.length === 0 ? (
          <EmptyState title={t('search.noResults')} hint={t('search.noResultsHint')} />
        ) : state.view === 'table' ? (
          <ResultTable results={data} query={state.q} />
        ) : (
          <ResultGrid results={data} query={state.q} />
        )}
      </div>

      {enabled && data && data.length > 0 && (
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
    </div>
  )
}
