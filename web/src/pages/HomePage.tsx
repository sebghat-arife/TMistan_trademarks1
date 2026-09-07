import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowRight, BookOpen, FileText, Image as ImageIcon, Search, ShieldCheck, SlidersHorizontal, User, Users } from 'lucide-react'
import { recentTrademarksQuery, registryStatsQuery } from '@/lib/queries'
import { formatNumber } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { TrademarkCard } from '@/components/ResultCards'

export function HomePage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const { data: stats } = useQuery(registryStatsQuery())
  const { data: recent } = useQuery(recentTrademarksQuery(8))
  useDocumentTitle(t('app.name'))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const sp = new URLSearchParams()
    if (q.trim()) sp.set('q', q.trim())
    navigate(`/search?${sp.toString()}`)
  }

  const lng = i18n.resolvedLanguage

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
            <h1 className="text-[40px] font-bold leading-[1.12] tracking-tight text-ink-900 md:text-[46px]">
              {t('home.titleA')}
              <span className="text-brand-600">{t('home.titleHighlight')}</span>
              <br />
              {t('home.titleB')}
            </h1>
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
              <div className="flex items-center gap-3">
                <button type="submit" className="btn-primary h-12 px-6 text-[15px]">
                  <Search className="h-4 w-4" /> {t('home.searchButton')}
                </button>
                <Link to="/search?adv=1" className="inline-flex items-center gap-2 text-[15px] font-medium text-brand-600 hover:underline">
                  <SlidersHorizontal className="h-4 w-4" /> {t('home.advanced')}
                </Link>
              </div>
            </form>
          </div>
        </div>
      </section>

      <div className="container-x space-y-6 py-8">
        {/* ── Stats ─────────────────────────────────────────────────────── */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Registry statistics">
          <StatCard icon={User} value={formatNumber(stats?.trademarks, lng)} label={t('home.stats.trademarks')} sub={t('home.stats.trademarksSub')} />
          <StatCard icon={BookOpen} value={formatNumber(stats?.gazettes, lng)} label={t('home.stats.gazettes')} sub={t('home.stats.gazettesSub')} />
          <StatCard icon={ImageIcon} value={formatNumber(stats?.images, lng)} label={t('home.stats.images')} sub={t('home.stats.imagesSub')} />
          <StatCard icon={Users} value={formatNumber(stats?.applicants, lng)} label={t('home.stats.applicants')} sub={t('home.stats.applicantsSub')} />
        </section>

        {/* ── Recently added ────────────────────────────────────────────── */}
        <section className="card p-5 md:p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-[20px] font-semibold text-ink-900">{t('home.recent')}</h2>
            <Link to="/trademarks" className="link-green inline-flex items-center gap-1.5">
              {t('home.viewAll')} <ArrowRight className="h-4 w-4 rtl:rotate-180" />
            </Link>
          </div>
          <ul className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
            {(recent ?? Array.from({ length: 8 }).map(() => null)).map((r, i) =>
              r ? (
                <li key={r.id} className="flex"><TrademarkCard r={r} className="w-full" /></li>
              ) : (
                <li key={i} className="card h-[250px] animate-pulse bg-ink-50" aria-hidden />
              ),
            )}
          </ul>
        </section>

        {/* ── Features ──────────────────────────────────────────────────── */}
        <section className="card grid grid-cols-1 gap-6 p-6 sm:grid-cols-2 lg:grid-cols-4">
          <Feature icon={ShieldCheck} title={t('home.features.official')} sub={t('home.features.officialSub')} />
          <Feature icon={FileText} title={t('home.features.source')} sub={t('home.features.sourceSub')} />
          <Feature icon={Search} title={t('home.features.search')} sub={t('home.features.searchSub')} />
          <Feature icon={ImageIcon} title={t('home.features.images')} sub={t('home.features.imagesSub')} />
        </section>
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, value, label, sub }: { icon: React.ComponentType<{ className?: string }>; value: string; label: string; sub: string }) {
  return (
    <div className="card flex items-center gap-4 p-5">
      <span className="icon-circle h-14 w-14"><Icon className="h-6 w-6" /></span>
      <div className="min-w-0">
        <div className="text-[24px] font-bold leading-tight tabular-nums text-ink-900">{value}</div>
        <div className="text-[15px] font-semibold text-ink-900">{label}</div>
        <div className="muted">{sub}</div>
      </div>
    </div>
  )
}

export function Feature({ icon: Icon, title, sub }: { icon: React.ComponentType<{ className?: string }>; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-4">
      <span className="icon-circle h-14 w-14"><Icon className="h-6 w-6" /></span>
      <div>
        <div className="text-[15px] font-semibold text-ink-900">{title}</div>
        <div className="muted mt-0.5 leading-snug">{sub}</div>
      </div>
    </div>
  )
}
