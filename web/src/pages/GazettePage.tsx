import { useCallback, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowRight, ChevronDown, ChevronRight, LayoutGrid, Search, Table2 } from 'lucide-react'
import { gazetteQuery, searchTrademarksQuery } from '@/services'
import { parseSearchParams, toRpcArgs, toSearchParams, type SearchState } from '@/lib/searchParams'
import { cn, formatNumber, formatRegistryDate } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { Pagination, ResultGrid, ResultTable } from '@/components/ResultCards'
import { EmptyState, ErrorState } from '@/components/AsyncState'

/** /gazette/:number — the same server-side search, pinned to one gazette. */
export function GazettePage() {
  const { number = '' } = useParams()
  const { t, i18n } = useTranslation()
  const [sp, setSp] = useSearchParams()
  const state = useMemo<SearchState>(() => {
    const s = { ...parseSearchParams(sp), gazette: number }
    if (sp.get('view') === null) s.view = 'table' // the mock-up shows the gazette as a table by default
    if (!s.q.trim() && s.sort === 'relevance') s.sort = 'serial'
    return s
  }, [sp, number])
  const [draftQ, setDraftQ] = useState(state.q)

  const { data: gazette, isLoading: gLoading, isError: gError, error: gErr, refetch: gRefetch } = useQuery(gazetteQuery(number))
  const { data: page, isFetching, isError, error } = useQuery(searchTrademarksQuery(toRpcArgs(state)))
  const data = page?.items

  useDocumentTitle(`${t('gazettes.gazetteN', { number })} · ${t('app.shortName')}`)

  const update = useCallback(
    (patch: Partial<SearchState>) => {
      const next = { ...state, ...patch, gazette: '' } // gazette lives in the path, not the query
      const params = toSearchParams(next)
      params.set('view', next.view) // persist explicitly (default here is table, not grid)
      setSp(params, { replace: !(Object.keys(patch).length === 1 && patch.page !== undefined) })
    },
    [state, setSp],
  )

  const total = page?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / state.perPage))
  const lng = i18n.resolvedLanguage

  if (gError) return <div className="container-x py-10"><ErrorState error={gErr} onRetry={() => void gRefetch()} /></div>
  if (!gLoading && gazette === null) {
    return (
      <div className="container-x py-10">
        <div className="card p-8 text-center">
          <p className="text-[15px] font-medium text-ink-900">{t('gazettes.notFound')}</p>
          <p className="mt-1 font-mono text-xs text-ink-500">{number}</p>
          <Link to="/gazettes" className="btn-secondary mt-4">{t('gazettes.allGazettes')}</Link>
        </div>
      </div>
    )
  }

  const pubDate = gazette?.publication_date ?? gazette?.first_publication_date
  const totalCount = gazette?.trademark_count ?? total

  return (
    <div className="container-x py-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[14px] text-ink-500">
        <Link to="/" className="hover:text-brand-600">{t('trademark.home')}</Link>
        <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
        <Link to="/gazettes" className="hover:text-brand-600">{t('gazettes.allGazettes')}</Link>
        <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
        <span className="text-ink-900">{t('gazettes.gazetteN', { number })}</span>
      </nav>

      <h1 className="mt-3 text-[30px] font-bold text-ink-900">{t('gazettes.gazetteN', { number })}</h1>
      <dl className="mt-1 space-y-0.5 text-[15px] text-ink-700">
        <div className="flex gap-1.5"><dt>{t('gazettes.publicationDate')}:</dt><dd className="text-ink-900">{formatRegistryDate(pubDate, lng) || '—'}</dd></div>
        <div className="flex gap-1.5"><dt>{t('gazettes.totalTrademarks')}:</dt><dd className="font-medium tabular-nums text-ink-900">{formatNumber(totalCount, lng)}</dd></div>
        {gazette?.source_file && <div className="flex gap-1.5 text-[13px] text-ink-500" dir="ltr"><dt>{t('gazettes.sourceFile')}:</dt><dd className="break-all">{gazette.source_file}</dd></div>}
      </dl>

      {/* Search within gazette */}
      <form
        onSubmit={(e) => { e.preventDefault(); update({ q: draftQ, page: 1, sort: draftQ.trim() ? 'relevance' : 'serial' }) }}
        role="search"
        className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center"
      >
        <div className="flex h-11 flex-1 items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
          <Search className="h-[18px] w-[18px] shrink-0 text-ink-400" aria-hidden />
          <input type="search" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} placeholder={t('gazettes.searchWithin')} aria-label={t('gazettes.searchWithin')} className="h-full w-full bg-transparent text-[15px] text-ink-900 outline-none placeholder:text-ink-400" />
        </div>
        <button type="submit" className="btn-primary h-11 px-6 text-[15px]">{t('home.searchButton')}</button>
      </form>

      {/* Toolbar */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
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
              {(['serial', 'relevance', 'mark_asc', 'mark_desc'] as const).map((s) => (
                <option key={s} value={s}>{t(`search.sort.${s}`)}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-500" aria-hidden />
          </span>
        </label>
      </div>

      {/* Results */}
      <div className={cn('mt-4 transition-opacity', isFetching && 'opacity-60')}>
        {isError ? (
          <ErrorState error={error} />
        ) : !data ? (
          <div className="card h-64 animate-pulse bg-ink-50" aria-hidden />
        ) : data.length === 0 ? (
          <EmptyState title={t('search.noResults')} />
        ) : state.view === 'grid' ? (
          <ResultGrid results={data} query={state.q} />
        ) : (
          <ResultTable results={data} query={state.q} compact />
        )}
      </div>

      <Pagination page={state.page} pages={pages} onPage={(p) => update({ page: p })} />

      {data && data.length > 0 && total > data.length && state.perPage < 100 && (
        <p className="mt-6 text-center">
          <button type="button" onClick={() => update({ perPage: 100, page: 1 })} className="link-green inline-flex items-center gap-1.5 text-[14px]">
            {t('gazettes.viewAllIn', { count: formatNumber(total, lng) })} <ArrowRight className="h-4 w-4 rtl:rotate-180" />
          </button>
        </p>
      )}
      {data && data.length > 0 && total <= data.length && (
        <p className="mt-6 text-center">
          <Link to={`/search?gazette=${encodeURIComponent(number)}&sort=serial`} className="link-green inline-flex items-center gap-1.5 text-[14px]">
            {t('gazettes.viewAllIn', { count: formatNumber(total, lng) })} <ArrowRight className="h-4 w-4 rtl:rotate-180" />
          </Link>
        </p>
      )}
    </div>
  )
}
