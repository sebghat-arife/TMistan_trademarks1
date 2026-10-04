import { useCallback, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Accessibility,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Briefcase,
  Building2,
  Clock,
  FilePlus2,
  FileText,
  GraduationCap,
  Image as ImageIcon,
  Info,
  Layers,
  Lightbulb,
  RefreshCw,
  Scale,
  Search,
  SquarePen,
  Users,
} from 'lucide-react'
import { deriveRecordTypeStats, filterOptionsQuery, registryStatsQuery, type RecordTypeStats } from '@/services'
import { cn, formatNumber } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { MASNAD_URL } from '@/lib/site'
import { ErrorState } from '@/components/AsyncState'

type Icon = React.ComponentType<{ className?: string }>

// ── Scroll reveal ────────────────────────────────────────────────────────────
// One shared IntersectionObserver; elements fade in once as they enter the
// viewport. Users with prefers-reduced-motion get everything visible at once
// (see .reveal in index.css).
let revealObserver: IntersectionObserver | null = null
function observeReveal(el: Element): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    el.classList.add('is-visible')
    return () => undefined
  }
  revealObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          revealObserver?.unobserve(entry.target)
        }
      }
    },
    { rootMargin: '0px 0px -6% 0px', threshold: 0.06 },
  )
  revealObserver.observe(el)
  return () => revealObserver?.unobserve(el)
}

function Reveal({
  as = 'div',
  className,
  delay = 0,
  children,
  ...rest
}: {
  as?: 'div' | 'section' | 'article' | 'li'
  className?: string
  delay?: number
  children?: ReactNode
  id?: string
  'aria-label'?: string
}) {
  // Callback ref: React 19 runs the returned cleanup when the element unmounts.
  const ref = useCallback((el: HTMLElement | null) => (el ? observeReveal(el) : undefined), [])
  const style: CSSProperties | undefined = delay ? { transitionDelay: `${delay}ms` } : undefined
  const Tag = as
  return (
    <Tag ref={ref} className={cn('reveal', className)} style={style} {...rest}>
      {children}
    </Tag>
  )
}

// ── Static section content (icons only; all wording lives in the locale files) ──
const WHY_POINTS: { key: string; icon: Icon }[] = [
  { key: 'searchable', icon: Search },
  { key: 'source', icon: FileText },
  { key: 'structured', icon: Layers },
  { key: 'accessible', icon: Accessibility },
]
const MATTERS: { key: string; icon: Icon }[] = [
  { key: 'before', icon: Clock },
  { key: 'with', icon: Search },
  { key: 'professionals', icon: Users },
]
const CAPABILITIES: { key: string; icon: Icon }[] = [
  { key: 'search', icon: Search },
  { key: 'record', icon: FileText },
  { key: 'source', icon: BookOpen },
  { key: 'images', icon: ImageIcon },
]
const STEPS = ['published', 'structured', 'explore'] as const
const AUDIENCE: { key: string; icon: Icon }[] = [
  { key: 'businesses', icon: Building2 },
  { key: 'professionals', icon: Briefcase },
  { key: 'lawyers', icon: Scale },
  { key: 'researchers', icon: GraduationCap },
  { key: 'entrepreneurs', icon: Lightbulb },
]
const TYPE_CARDS: { key: keyof RecordTypeStats; icon: Icon }[] = [
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
  const types = deriveRecordTypeStats(options.data?.application_types)
  useDocumentTitle(t('app.name'), t('home.hero.lead'))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const sp = new URLSearchParams()
    if (q.trim()) sp.set('q', q.trim())
    navigate(`/search?${sp.toString()}`)
  }

  const lng = i18n.resolvedLanguage
  const loadingTotals = stats.isPending
  const loadingTypes = options.isPending
  // Figures are always live aggregates from the database. With no published
  // records the whole section is omitted instead of showing zeros.
  const hasRecords = (stats.data?.trademarks ?? 0) > 0
  const showStats = stats.isError || loadingTotals || hasRecords
  const searchItems = t('home.capabilities.search.items', { returnObjects: true }) as string[]

  return (
    // -mb-12 cancels the footer's top margin so the final CTA band sits flush against it.
    <div className="-mb-12 bg-white">
      {/* ── Hero / Search ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-ink-200 bg-mist-50">
        <div className="hero-photo" aria-hidden />
        <div className="container-x relative py-16 md:py-24 lg:py-28">
          <Reveal className="max-w-[640px] md:max-w-[50%] lg:max-w-[56%] xl:max-w-[640px]">
            <p className="eyebrow">{t('home.hero.eyebrow')}</p>
            <h1 className="mt-4 font-serif text-[40px] font-semibold leading-[1.08] tracking-[-0.015em] text-navy-900 sm:text-[48px] lg:text-[58px]">
              {t('home.hero.title')}
            </h1>
            <p className="mt-6 max-w-[560px] text-[17px] leading-relaxed text-ink-700">{t('home.hero.lead')}</p>
            <p className="mt-3 max-w-[560px] text-[15px] leading-relaxed text-ink-600">{t('home.hero.secondary')}</p>

            <form
              onSubmit={submit}
              role="search"
              className="mt-8 flex items-center gap-2 rounded-xl border border-ink-200 bg-white p-1.5 shadow-[0_14px_40px_-16px_rgba(16,35,58,0.28)] focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100"
            >
              <Search className="ms-3 h-5 w-5 shrink-0 text-ink-400" aria-hidden />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('home.hero.searchPlaceholder')}
                aria-label={t('home.hero.searchPlaceholder')}
                className="h-11 w-full min-w-0 bg-transparent text-[15px] text-ink-900 outline-none placeholder:text-ink-400"
              />
              <button type="submit" className="btn-primary h-11 shrink-0 px-5 text-[15px]">
                {t('home.hero.searchButton')}
              </button>
            </form>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-500">{t('home.hero.examples')}</p>

            <Link to="/about" className="mt-7 inline-flex items-center gap-1.5 text-[14px] font-semibold text-brand-600 transition-colors hover:text-brand-700">
              {t('home.hero.learn')}
              <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
            </Link>
          </Reveal>
        </div>
      </section>

      {/* ── Why TMistan ───────────────────────────────────────────────── */}
      <section id="why" className="scroll-mt-20 bg-white">
        <div className="container-x grid gap-12 py-20 lg:grid-cols-[1.05fr_1fr] lg:gap-20 lg:py-24">
          <Reveal>
            <p className="eyebrow">{t('home.why.eyebrow')}</p>
            <h2 className="section-title mt-3">{t('home.why.title')}</h2>
            <p className="mt-6 text-[16px] leading-relaxed text-ink-700">{t('home.why.p1')}</p>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-700">{t('home.why.p2')}</p>
            <p className="mt-8 border-s-2 border-brand-600 ps-5 font-serif text-[21px] leading-snug text-navy-900">{t('home.why.statement')}</p>
          </Reveal>
          <Reveal className="grid gap-x-10 gap-y-10 sm:grid-cols-2" delay={120}>
            {WHY_POINTS.map(({ key, icon: PointIcon }) => (
              <div key={key}>
                <span className="icon-circle h-12 w-12">
                  <PointIcon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 font-serif text-[18px] font-semibold text-navy-900">{t(`home.why.points.${key}.title`)}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-ink-600">{t(`home.why.points.${key}.text`)}</p>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ── Built by Masnad Law Firm ──────────────────────────────────── */}
      <section id="masnad" className="scroll-mt-20 grid border-t border-ink-200 bg-mist-50 lg:grid-cols-2">
        <Reveal className="flex items-center">
          <div className="w-full px-6 py-16 sm:px-8 lg:ms-auto lg:max-w-[590px] lg:py-24 lg:pe-14 lg:ps-6">
            <p className="eyebrow">{t('home.masnad.eyebrow')}</p>
            <h2 className="section-title mt-3">{t('home.masnad.title')}</h2>
            <p className="mt-6 text-[16px] leading-relaxed text-ink-700">{t('home.masnad.p1')}</p>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-700">{t('home.masnad.p2')}</p>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-700">{t('home.masnad.p3')}</p>
            {MASNAD_URL && (
              <a href={MASNAD_URL} target="_blank" rel="noreferrer" className="btn-primary mt-8 h-11 px-6 text-[15px]">
                {t('home.masnad.button')}
                <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
              </a>
            )}
          </div>
        </Reveal>
        <Reveal className="dark-grid relative flex items-center bg-teal-950 text-white" delay={120}>
          <div className="pointer-events-none absolute inset-0 bg-linear-to-br from-transparent via-transparent to-brand-800/25" aria-hidden />
          <div className="relative w-full px-6 py-16 sm:px-8 lg:me-auto lg:max-w-[590px] lg:py-24 lg:pe-6 lg:ps-14">
            <span className="block h-px w-12 bg-brand-400" aria-hidden />
            <h3 className="mt-7 font-serif text-[28px] font-semibold leading-tight md:text-[34px]">{t('home.masnad.panelTitle')}</h3>
            <p className="mt-6 max-w-[500px] text-[15px] leading-relaxed text-white/75">{t('home.masnad.panelText')}</p>
          </div>
        </Reveal>
      </section>

      {/* ── Why it matters ────────────────────────────────────────────── */}
      <section className="border-t border-ink-200 bg-white">
        <div className="container-x grid gap-10 py-20 lg:grid-cols-[1fr_2.2fr] lg:gap-14 lg:py-24">
          <Reveal>
            <p className="eyebrow">{t('home.matters.eyebrow')}</p>
            <h2 className="section-title mt-3">{t('home.matters.title')}</h2>
          </Reveal>
          <Reveal className="grid gap-10 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-ink-200 lg:border-s lg:border-ink-200 lg:ps-10 sm:[&>*+*]:ps-8 sm:[&>*:not(:last-child)]:pe-8" delay={100}>
            {MATTERS.map(({ key, icon: MatterIcon }) => (
              <div key={key}>
                <MatterIcon className="h-6 w-6 text-brand-600" aria-hidden />
                <h3 className="mt-4 text-[17px] font-semibold text-navy-900">{t(`home.matters.${key}.title`)}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-600">{t(`home.matters.${key}.text`)}</p>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ── Platform capabilities ─────────────────────────────────────── */}
      <section id="capabilities" className="scroll-mt-20 border-t border-ink-200 bg-mist-50">
        <div className="container-x py-20 lg:py-24">
          <Reveal className="max-w-xl">
            <p className="eyebrow">{t('home.capabilities.eyebrow')}</p>
            <h2 className="section-title mt-3">{t('home.capabilities.title')}</h2>
          </Reveal>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {CAPABILITIES.map(({ key, icon: CapIcon }, i) => (
              <Reveal key={key} as="article" className="card p-7 transition-shadow hover:shadow-md" delay={i * 80}>
                <span className="icon-circle h-12 w-12">
                  <CapIcon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 font-serif text-[19px] font-semibold text-navy-900">{t(`home.capabilities.${key}.title`)}</h3>
                {key === 'search' ? (
                  <>
                    <p className="mt-2 text-[14px] leading-relaxed text-ink-600">{t('home.capabilities.search.intro')}</p>
                    <ul className="mt-2 space-y-1 text-[14px] leading-relaxed text-ink-600">
                      {searchItems.map((item) => (
                        <li key={item} className="flex gap-2">
                          <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-brand-600" aria-hidden />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="mt-2 text-[14px] leading-relaxed text-ink-600">{t(`home.capabilities.${key}.text`)}</p>
                )}
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── TMistan at a glance (live database aggregates) ────────────── */}
      {showStats && (
        <section className="border-t border-ink-200 bg-white" aria-label={t('home.stats.ariaLabel')} aria-busy={loadingTotals || loadingTypes}>
          <div className="container-x grid items-center gap-10 py-16 lg:grid-cols-[1fr_2.7fr] lg:gap-14 lg:py-20">
            <Reveal>
              <h2 className="font-serif text-[28px] font-semibold leading-tight text-navy-900">{t('home.stats.title')}</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-600">{t('home.stats.subtitle')}</p>
              <p className="mt-3 text-[12px] leading-relaxed text-ink-500">{t('home.stats.note')}</p>
            </Reveal>
            {stats.isError ? (
              <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
            ) : (
              <Reveal className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" delay={100}>
                <StatCard icon={FileText} loading={loadingTotals} value={formatNumber(stats.data?.trademarks, lng)} label={t('home.stats.records')} title={t('home.stats.recordsSub')} />
                <StatCard icon={BookOpen} loading={loadingTotals} value={formatNumber(stats.data?.gazettes, lng)} label={t('home.stats.gazettes')} title={t('home.stats.gazettesSub')} />
                {/* Record-type totals come from the real application_type counts; a category
                    with no published notices is omitted rather than shown as a number. */}
                {!options.isError &&
                  TYPE_CARDS.filter((c) => loadingTypes || types[c.key] > 0).map((c) => (
                    <StatCard key={c.key} icon={c.icon} loading={loadingTypes} value={formatNumber(types[c.key], lng)} label={t(`home.stats.${c.key}`)} title={t(`home.stats.${c.key}Sub`)} />
                  ))}
              </Reveal>
            )}
          </div>
        </section>
      )}

      {/* ── How it works · Sources · Who it is for ────────────────────── */}
      <section className="border-t border-ink-200 bg-mist-50">
        <div className="container-x grid gap-14 py-20 lg:grid-cols-3 lg:gap-0 lg:divide-x lg:divide-ink-200 lg:py-24 lg:[&>*+*]:ps-10 lg:[&>*:not(:last-child)]:pe-10">
          <Reveal id="how-it-works" className="scroll-mt-20">
            <p className="eyebrow">{t('home.how.eyebrow')}</p>
            <h2 className="section-title-sm mt-3">{t('home.how.title')}</h2>
            <ol className="mt-8 grid gap-7 sm:grid-cols-3 sm:gap-6 lg:grid-cols-1 lg:gap-6">
              {STEPS.map((step, i) => (
                <li key={step} className="flex gap-4 sm:block lg:flex">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[12px] font-bold tabular-nums text-brand-700">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="sm:mt-4 lg:mt-0">
                    <h3 className="text-[15px] font-semibold text-navy-900">{t(`home.how.steps.${step}.title`)}</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-600">{t(`home.how.steps.${step}.text`)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Reveal>

          <Reveal id="sources" className="scroll-mt-20" delay={100}>
            <p className="eyebrow">{t('home.sources.eyebrow')}</p>
            <h2 className="section-title-sm mt-3">{t('home.sources.title')}</h2>
            <p className="mt-6 text-[14px] leading-relaxed text-ink-700">{t('home.sources.text')}</p>
            <div className="mt-6 flex gap-3 rounded-lg border border-ink-200 bg-white p-4">
              <Info className="mt-0.5 h-[18px] w-[18px] shrink-0 text-ink-500" aria-hidden />
              <p className="text-[13px] leading-relaxed text-ink-700">{t('home.sources.disclaimer')}</p>
            </div>
          </Reveal>

          <Reveal id="who" className="scroll-mt-20" delay={200}>
            <p className="eyebrow">{t('home.audience.eyebrow')}</p>
            <h2 className="section-title-sm mt-3">{t('home.audience.title')}</h2>
            <ul className="mt-7 space-y-4">
              {AUDIENCE.map(({ key, icon: AudIcon }) => (
                <li key={key} className="flex gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600">
                    <AudIcon className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <div>
                    <h3 className="text-[14px] font-semibold text-navy-900">{t(`home.audience.${key}.title`)}</h3>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-ink-600">{t(`home.audience.${key}.text`)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ── Built for Afghanistan · Pioneering digital trademark research ── */}
      <section className="afg-band text-white">
        <div className="container-x grid gap-12 py-20 lg:grid-cols-[1.25fr_1fr] lg:gap-16 lg:py-24">
          <Reveal>
            <p className="eyebrow text-brand-300">{t('home.afghanistan.eyebrow')}</p>
            <p className="mt-4 font-serif text-[30px] font-semibold leading-[1.15] md:text-[38px]">{t('home.afghanistan.statement')}</p>
            <p className="mt-7 max-w-[560px] text-[15px] leading-relaxed text-white/80">{t('home.afghanistan.p1')}</p>
            <p className="mt-3 max-w-[560px] text-[15px] leading-relaxed text-white/80">{t('home.afghanistan.p2')}</p>
          </Reveal>
          <Reveal className="lg:border-s lg:border-white/15 lg:ps-16" delay={120}>
            <p className="eyebrow text-brand-300">{t('home.afghanistan.pioneerEyebrow')}</p>
            <p className="mt-4 text-[15px] leading-relaxed text-white/85">{t('home.afghanistan.pioneer1')}</p>
            <p className="mt-3 text-[15px] leading-relaxed text-white/85">{t('home.afghanistan.pioneer2')}</p>
          </Reveal>
        </div>
      </section>

      {/* ── Masnad + TMistan vision ───────────────────────────────────── */}
      <section className="dark-grid bg-teal-950 text-white">
        <div className="container-x grid gap-12 py-20 lg:grid-cols-2 lg:gap-16 lg:py-24">
          <Reveal>
            <p className="eyebrow text-brand-300">{t('home.vision.eyebrow')}</p>
            <h2 className="mt-3 font-serif text-[30px] font-semibold leading-[1.15] tracking-[-0.01em] md:text-[36px]">{t('home.vision.title')}</h2>
            <p className="mt-6 text-[15px] leading-relaxed text-white/80">{t('home.vision.p1')}</p>
            <p className="mt-3 text-[15px] leading-relaxed text-white/80">{t('home.vision.p2')}</p>
            {MASNAD_URL && (
              <a href={MASNAD_URL} target="_blank" rel="noreferrer" className="btn-primary mt-8 h-11 px-6 text-[15px]">
                {t('home.vision.button')}
                <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
              </a>
            )}
          </Reveal>
          <Reveal className="flex flex-col justify-center lg:border-s lg:border-white/10 lg:ps-16" delay={120}>
            <p className="font-serif text-[30px] leading-[1.25] md:text-[38px]">
              {t('home.vision.statement1')}
              <br />
              {t('home.vision.statement2')}
              <br />
              {t('home.vision.statement3')}
            </p>
            <p className="mt-8 text-[12px] font-semibold uppercase tracking-[0.2em] text-white/55">{t('home.vision.product')}</p>
          </Reveal>
        </div>
      </section>

      {/* ── Final call to action ──────────────────────────────────────── */}
      <section className="border-t border-ink-200 bg-linear-to-r from-mist-100 via-mist-50 to-white">
        <div className="container-x flex flex-col gap-8 py-16 lg:flex-row lg:items-center lg:justify-between lg:py-20">
          <Reveal>
            <p className="eyebrow">{t('home.cta.eyebrow')}</p>
            <h2 className="section-title mt-3">{t('home.cta.title')}</h2>
            <p className="mt-4 max-w-[560px] text-[15px] leading-relaxed text-ink-700">{t('home.cta.text')}</p>
          </Reveal>
          <Reveal className="flex flex-wrap gap-3" delay={100}>
            <Link to="/search" className="btn-primary h-12 px-6 text-[15px]">
              {t('home.cta.search')}
              <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
            </Link>
            <Link to="/about" className="btn-secondary h-12 px-6 text-[15px]">
              {t('home.cta.learn')}
            </Link>
          </Reveal>
        </div>
      </section>
    </div>
  )
}

function StatCard({ icon: StatIcon, value, label, title, loading }: { icon: Icon; value: string; label: string; title: string; loading?: boolean }) {
  return (
    <div className="card flex flex-col items-center px-3 py-5 text-center" title={title}>
      <span className="icon-circle h-10 w-10">
        <StatIcon className="h-[18px] w-[18px]" />
      </span>
      <span className="mt-3 flex min-h-[30px] items-center text-[12px] font-medium leading-tight text-ink-600">{label}</span>
      {loading ? (
        <span className="mt-2 h-7 w-12 animate-pulse rounded bg-ink-100" aria-hidden />
      ) : (
        <span className="mt-1.5 text-[26px] font-semibold leading-none tabular-nums text-navy-900">{value}</span>
      )}
    </div>
  )
}
