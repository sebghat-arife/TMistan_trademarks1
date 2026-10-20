import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, BookOpen, ChevronRight, Clock, FileText, GraduationCap, HelpCircle, Lightbulb, Search, ShieldCheck, Tag, X, type LucideIcon } from 'lucide-react'
import { ClosingBanner, FeatureCard, IconBadge, SectionHeading, SidePanel, SplitHero } from '@/components/editorial'
import { GeometricLattice } from '@/components/ornament'
import { ARTICLES, KNOWLEDGE_CATEGORIES, KNOWLEDGE_TOPICS, readingMinutes, searchArticles, type Article, type KnowledgeCategory } from '@/content/knowledge'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { cn } from '@/lib/utils'

/** Hero photograph: Kabul University Central Library (CC BY 2.0, cropped) — see public/img/CREDITS.md. */
const HERO_PHOTO_SOURCE = 'https://commons.wikimedia.org/wiki/File:Kabul_University_Central_Library.jpg'

const TOPIC_ICON: Record<KnowledgeCategory, LucideIcon> = { fundamentals: BookOpen, searching: Search, gazette: FileText, classes: Tag, limits: ShieldCheck }

const isCategory = (v: string | null): v is KnowledgeCategory => !!v && (KNOWLEDGE_CATEGORIES as string[]).includes(v)

/** /knowledge-center — static editorial hub for the launch articles (see src/content/knowledge.ts). */
export function KnowledgeCenterPage() {
  const { t } = useTranslation()
  useDocumentTitle(t('knowledge.metaTitle'), t('knowledge.metaDescription'))
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const topicParam = params.get('topic')
  const category: KnowledgeCategory | 'all' = isCategory(topicParam) ? topicParam : 'all'
  const [draft, setDraft] = useState(query)
  // Keep the input in sync when the URL changes through a link (e.g. back/forward).
  const [prevQuery, setPrevQuery] = useState(query)
  if (query !== prevQuery) {
    setPrevQuery(query)
    setDraft(query)
  }
  const listRef = useRef<HTMLDivElement>(null)
  const filtering = query.trim() !== '' || category !== 'all' || params.get('all') === '1'

  const results = useMemo(() => searchArticles(query, category), [query, category])

  const update = (patch: Record<string, string | null>, scroll = true) => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    setParams(next, { replace: true })
    if (scroll) window.setTimeout(() => listRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30)
  }
  const onSearch = (ev: FormEvent) => {
    ev.preventDefault()
    update({ q: draft.trim() || null, all: draft.trim() ? null : '1' })
  }
  const clearAll = () => {
    setDraft('')
    update({ q: null, topic: null, all: null }, false)
  }

  const benefits = [
    { Icon: BookOpen, key: 'guides' },
    { Icon: Lightbulb, key: 'tips' },
    { Icon: Tag, key: 'concepts' },
    { Icon: ShieldCheck, key: 'clear' },
  ] as const

  const featured = ARTICLES.filter((a) => a.featured)
  const quickLinks: { Icon: LucideIcon; label: string; to: string }[] = [
    { Icon: FileText, label: t('knowledge.quickLinks.howTo'), to: '/help' },
    { Icon: Tag, label: t('knowledge.quickLinks.classes'), to: '/knowledge-center/understanding-trademark-classes' },
    { Icon: FileText, label: t('knowledge.quickLinks.gazette'), to: '/data-sources#ds-gazette' },
    { Icon: HelpCircle, label: t('knowledge.quickLinks.faq'), to: '/help' },
  ]

  return (
    <div data-testid="knowledge-page">
      <SplitHero
        label={t('knowledge.label')}
        title={t('knowledge.title')}
        text={t('knowledge.intro')}
        image="/img/hero-knowledge.jpg"
        imagePosition="40% 55%"
        credit={{ text: t('knowledge.photoCredit'), href: HERO_PHOTO_SOURCE }}
        benefits={benefits.map(({ Icon, key }) => ({ Icon, title: t(`knowledge.benefits.${key}.title`), text: t(`knowledge.benefits.${key}.text`) }))}
      />

      <div className="container-x py-12 md:py-14">
        {/* Browse by topic */}
        <SectionHeading label={t('knowledge.topics.label')} title={t('knowledge.topics.title')} text={t('knowledge.topics.text')} id="topics" />
        <ul className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {KNOWLEDGE_TOPICS.map((key) => (
            <li key={key}>
              <FeatureCard
                Icon={TOPIC_ICON[key]}
                title={t(`knowledge.categories.${key}.title`)}
                text={t(`knowledge.categories.${key}.text`)}
                onClick={() => update({ topic: category === key ? null : key, all: '1' })}
                selected={category === key}
                arrow
                testId={`topic-${key}`}
              />
            </li>
          ))}
        </ul>

        {/* Search bar */}
        <form onSubmit={onSearch} role="search" className="relative mt-6 overflow-hidden rounded-xl border border-brand-100 bg-brand-50/70 p-4 md:p-5" data-testid="knowledge-search">
          <div className="relative flex flex-col gap-3 sm:flex-row">
            <label htmlFor="kc-search" className="sr-only">{t('knowledge.search.label')}</label>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
              <input id="kc-search" type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('knowledge.search.placeholder')} className="field h-11 ps-10" autoComplete="off" />
            </div>
            <button type="submit" className="btn btn-primary h-11 min-w-[120px]">{t('knowledge.search.button')}</button>
          </div>
        </form>

        {/* Article list (shown when searching / filtering) */}
        <div ref={listRef} className="scroll-mt-24" aria-live="polite">
          {filtering && (
            <section className="mt-8" data-testid="knowledge-results">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-serif text-[22px] font-semibold text-navy-900">
                    {t('knowledge.search.resultsTitle')}
                    <span className="ms-2 text-[14px] font-normal text-ink-500" data-testid="knowledge-results-count">
                      {t('knowledge.search.results', { count: results.length })}
                      {query.trim() && ` ${t('knowledge.search.for', { query: query.trim() })}`}
                    </span>
                  </h2>
                </div>
                <button type="button" onClick={clearAll} className="btn btn-ghost h-9 gap-1.5 text-[13px]">
                  <X className="h-3.5 w-3.5" aria-hidden /> {t('knowledge.search.clear')}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t('knowledge.topics.title')}>
                <Chip active={category === 'all'} onClick={() => update({ topic: null, all: '1' }, false)}>{t('knowledge.search.all')}</Chip>
                {KNOWLEDGE_CATEGORIES.map((c) => (
                  <Chip key={c} active={category === c} onClick={() => update({ topic: c, all: '1' }, false)}>{t(`knowledge.categories.${c}.title`)}</Chip>
                ))}
              </div>
              {results.length > 0 ? (
                <ul className="mt-5 grid gap-4 md:grid-cols-2">
                  {results.map((a) => (
                    <li key={a.slug}><ArticleCard article={a} /></li>
                  ))}
                </ul>
              ) : (
                <div className="mt-5 rounded-xl border border-dashed border-ink-200 bg-white p-8 text-center" data-testid="knowledge-empty">
                  <IconBadge Icon={Search} className="mx-auto" />
                  <p className="mt-3 text-[15px] font-semibold text-ink-900">{t('knowledge.search.empty')}</p>
                  <p className="mt-1 text-[13.5px] text-ink-600">{t('knowledge.search.emptyHint')}</p>
                  <button type="button" onClick={clearAll} className="btn btn-secondary mt-4">{t('knowledge.search.showAll')}</button>
                </div>
              )}
            </section>
          )}
        </div>

        {/* Popular guides + sidebar */}
        <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] lg:gap-10">
          <section aria-labelledby="popular-guides" className="relative isolate overflow-hidden rounded-xl border border-ink-200 bg-ivory-100 p-5 md:p-6">
            <GeometricLattice className="text-navy-900" size={48} opacity={0.06} fade="corner" />
            <SectionHeading label={t('knowledge.featured.label')} title={t('knowledge.featured.title')} text={t('knowledge.featured.text')} id="popular-guides" />
            <ul className="mt-6 grid gap-4 md:grid-cols-2">
              {featured.map((a) => (
                <li key={a.slug}><ArticleCard article={a} /></li>
              ))}
            </ul>
          </section>

          <aside className="space-y-5">
            <SidePanel title={t('knowledge.quickLinks.title')} tone="white">
              <ul className="mt-3 divide-y divide-ink-100">
                {quickLinks.map(({ Icon, label, to }) => (
                  <li key={label}>
                    <Link to={to} className="flex items-center gap-3 py-2.5 text-[14px] text-ink-800 hover:text-brand-700">
                      <Icon className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                      <span className="flex-1">{label}</span>
                      <ChevronRight className="h-4 w-4 text-ink-400 rtl:-scale-x-100" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </SidePanel>
            <SidePanel tone="green">
              <div className="flex gap-4">
                <IconBadge Icon={BookOpen} className="bg-white" />
                <div className="min-w-0">
                  <h2 className="font-serif text-[17px] font-semibold text-navy-900">{t('knowledge.help.title')}</h2>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-ink-700">{t('knowledge.help.text')}</p>
                  <Link to="/help" className="btn btn-secondary mt-3 h-9 text-[13px]">
                    {t('knowledge.help.button')}
                    <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                  </Link>
                </div>
              </div>
            </SidePanel>
            <SidePanel tone="dark" className="relative overflow-hidden">
              <GraduationCap className="h-8 w-8 text-brand-200" aria-hidden strokeWidth={1.5} />
              <h2 className="mt-3 font-serif text-[20px] font-semibold text-white">{t('knowledge.keep.title')}</h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-white/80">{t('knowledge.keep.text')}</p>
            </SidePanel>
          </aside>
        </div>

        <ClosingBanner
          className="mt-12"
          title={t('knowledge.path.title')}
          text={t('knowledge.path.text')}
          Icon={BookOpen}
          testId="knowledge-path"
          action={
            <button type="button" onClick={() => update({ all: '1', topic: null, q: null })} className="btn btn-outline-green">
              {t('knowledge.path.button')}
              <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
            </button>
          }
        />
      </div>
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn('rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors', active ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-brand-300 hover:text-brand-700')}>
      {children}
    </button>
  )
}

/** Article card: thumbnail, category label, title, summary, reading time. Shared with the article page (related). */
export function ArticleCard({ article, compact }: { article: Article; compact?: boolean }) {
  const { t } = useTranslation()
  const minutes = readingMinutes(article)
  const label = article.label ? t(`knowledge.labels.${article.label}`) : t(`knowledge.categories.${article.category}.title`)
  return (
    <Link to={`/knowledge-center/${article.slug}`} className="ed-card flex h-full gap-4 p-3 sm:p-4" data-testid={`article-card-${article.slug}`}>
      {!compact && (
        <img src={article.thumbnail} alt="" width={160} height={120} loading="lazy" decoding="async" className="hidden h-[120px] w-[150px] shrink-0 rounded-md border border-ink-100 object-cover sm:block" />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="inline-flex w-fit rounded-sm bg-brand-50 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-brand-700">{label}</span>
        <h3 className="mt-2 font-serif text-[16px] font-semibold leading-snug text-navy-900">{t(`knowledge.articles.${article.slug}.title`, { defaultValue: article.title })}</h3>
        <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-ink-600">{t(`knowledge.articles.${article.slug}.summary`, { defaultValue: article.summary })}</p>
        <div className="mt-auto flex items-center justify-between pt-3 text-[12px] text-ink-500">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {t('knowledge.readTime', { count: minutes })}
          </span>
          <ArrowRight className="h-4 w-4 text-brand-600 rtl:-scale-x-100" aria-hidden />
        </div>
      </div>
    </Link>
  )
}
