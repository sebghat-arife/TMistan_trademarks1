import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowRight, BookOpen, Search } from 'lucide-react'
import { gazettesQuery } from '@/lib/queries'
import { formatDate, formatNumber, gazettePath } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export function GazettesPage() {
  const { t, i18n } = useTranslation()
  const { data, isLoading, isError, error } = useQuery(gazettesQuery())
  const [filter, setFilter] = useState('')
  useDocumentTitle(`${t('gazettes.title')} · ${t('app.shortName')}`)
  const lng = i18n.resolvedLanguage

  // This list is small (one row per gazette — hundreds at most), so a
  // client-side quick filter over it is appropriate; trademarks are never
  // filtered client-side.
  const rows = useMemo(() => {
    const list = (data ?? []).filter((g) => g.trademark_count > 0)
    const f = filter.trim()
    return f ? list.filter((g) => g.gazette_number.includes(f)) : list
  }, [data, filter])

  const totals = useMemo(
    () => (data ?? []).reduce((acc, g) => ({ tm: acc.tm + g.trademark_count, img: acc.img + g.image_count }), { tm: 0, img: 0 }),
    [data],
  )

  return (
    <div className="container-x py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-bold text-ink-900">{t('gazettes.title')}</h1>
          <p className="muted mt-1 text-[14px]">{t('gazettes.subtitle')}</p>
        </div>
        <p className="text-[14px] text-ink-600 tabular-nums">
          {formatNumber(rows.length, lng)} {t('nav.gazettes')} · {t('gazettes.count', { count: totals.tm })}
        </p>
      </div>

      <div className="mt-5 flex h-11 max-w-md items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
        <Search className="h-[18px] w-[18px] text-ink-400" aria-hidden />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('filters.gazette')} aria-label={t('filters.gazette')} className="h-full w-full bg-transparent text-[15px] outline-none placeholder:text-ink-400" inputMode="numeric" dir="ltr" />
      </div>

      {isLoading && <p className="mt-6 text-sm text-ink-500">{t('common.loading')}</p>}
      {isError && <p className="mt-6 text-sm text-red-700">{(error as Error).message}</p>}
      {data && rows.length === 0 && <p className="mt-6 text-sm text-ink-500">{t('gazettes.empty')}</p>}

      {rows.length > 0 && (
        <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((g) => (
            <li key={g.id}>
              <Link to={gazettePath(g.gazette_number)} className="card flex h-full flex-col p-5 transition-shadow hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
                <div className="flex items-center gap-3">
                  <span className="icon-circle h-11 w-11"><BookOpen className="h-5 w-5" /></span>
                  <div>
                    <div className="text-[17px] font-semibold text-ink-900">{t('gazettes.gazetteN', { number: g.gazette_number })}</div>
                    <div className="muted tabular-nums">{formatDate(g.publication_date ?? g.first_publication_date, lng) || '—'}</div>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-[13px]">
                  <div><dt className="text-ink-500">{t('gazettes.totalTrademarks')}</dt><dd className="text-[15px] font-semibold tabular-nums text-ink-900">{formatNumber(g.trademark_count, lng)}</dd></div>
                  <div><dt className="text-ink-500">{t('gazettes.images')}</dt><dd className="text-[15px] font-semibold tabular-nums text-ink-900">{formatNumber(g.image_count, lng)}</dd></div>
                </dl>
                <span className="link-green mt-4 inline-flex items-center gap-1.5">
                  {t('gazettes.viewAllIn', { count: formatNumber(g.trademark_count, lng) })} <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
