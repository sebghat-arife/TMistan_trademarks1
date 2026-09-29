import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, BookOpen, FilePlus2, FileText, RefreshCw, Search, SquarePen } from 'lucide-react'
import { deriveRecordTypeStats, filterOptionsQuery, registryStatsQuery, type RecordTypeStats } from '@/services'
import { formatNumber } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { ErrorState } from '@/components/AsyncState'

const TYPE_CARDS: { key: keyof RecordTypeStats; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'registrations', icon: FilePlus2 },
  { key: 'renewals', icon: RefreshCw },
  { key: 'assignments', icon: ArrowLeftRight },
  { key: 'changes', icon: SquarePen },
]

export function HomePage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const stats = useQuery(registryStatsQuery())
  const options = useQuery(filterOptionsQuery())
  const types = useMemo(() => deriveRecordTypeStats(options.data?.application_types), [options.data])
  useDocumentTitle(t('app.name'), t('footer.blurb'))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const sp = new URLSearchParams()
    if (q.trim()) sp.set('q', q.trim())
    navigate(`/search?${sp.toString()}`)
  }

  const lng = i18n.resolvedLanguage
  const loadingTotals = stats.isPending
  const loadingTypes = options.isPending

  return (
    <div>
      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-ink-200 bg-white">
        <img
          src="/img/hero-mosque.png"
          alt=""
          aria-hidden
          className="hero-art pointer-events-none absolute inset-y-0 end-0 hidden h-full w-[62%] object-cover object-left rtl:-scale-x-100 md:block"
        />
        <div className="container-x relative py-16 md:py-20">
          <div className="max-w-3xl">
            <h1 className="text-[40px] font-bold leading-[1.12] tracking-tight text-ink-900 md:text-[46px]">{t('home.title')}</h1>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-ink-600">{t('home.subtitle')}</p>

            <form onSubmit={submit} role="search" className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex h-12 flex-1 items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 shadow-sm focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100 sm:max-w-xl">
                <Search className="h-[18px] w-[18px] shrink-0 text-ink-400" aria-hidden />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t('home.searchPlaceholder')}
                  aria-label={t('home.searchPlaceholder')}
                  className="h-full w-full bg-transparent text-[15px] text-ink-900 outline-none placeholder:text-ink-400"
                />
              </div>
              <button type="submit" className="btn-primary h-12 px-6 text-[15px]">
                <Search className="h-4 w-4" /> {t('home.searchButton')}
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* ── Statistics (live Supabase aggregates) ─────────────────────── */}
      <div className="container-x py-8">
        {stats.isError ? (
          <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
        ) : (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('home.stats.ariaLabel')} aria-busy={loadingTotals || loadingTypes}>
            <StatCard icon={FileText} loading={loadingTotals} value={formatNumber(stats.data?.trademarks, lng)} label={t('home.stats.records')} sub={t('home.stats.recordsSub')} />
            <StatCard icon={BookOpen} loading={loadingTotals} value={formatNumber(stats.data?.gazettes, lng)} label={t('home.stats.gazettes')} sub={t('home.stats.gazettesSub')} />
            {/* Record-type totals come from the real application_type counts; a category
                with no published notices is omitted rather than shown as a number. */}
            {!options.isError &&
              TYPE_CARDS.filter((c) => loadingTypes || types[c.key] > 0).map((c) => (
                <StatCard key={c.key} icon={c.icon} loading={loadingTypes} value={formatNumber(types[c.key], lng)} label={t(`home.stats.${c.key}`)} sub={t(`home.stats.${c.key}Sub`)} />
              ))}
          </section>
        )}
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, value, label, sub, loading }: { icon: React.ComponentType<{ className?: string }>; value: string; label: string; sub: string; loading?: boolean }) {
  return (
    <div className="card flex items-center gap-4 p-5">
      <span className="icon-circle h-14 w-14"><Icon className="h-6 w-6" /></span>
      <div className="min-w-0">
        {loading ? <div className="mb-1 h-6 w-16 animate-pulse rounded bg-ink-100" /> : <div className="text-[24px] font-bold leading-tight tabular-nums text-ink-900">{value}</div>}
        <div className="text-[15px] font-semibold text-ink-900">{label}</div>
        <div className="muted">{sub}</div>
      </div>
    </div>
  )
}
