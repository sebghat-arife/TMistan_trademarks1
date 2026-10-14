import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  ClipboardCheck,
  Clock,
  FileText,
  Headset,
  HelpCircle,
  Lightbulb,
  Link2,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  Plus,
  Scale,
  Search,
  Tag,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react'
import { ClosingBanner, FeatureCard, IconBadge, InfoBanner, SectionHeading, SidePanel, SplitHero } from '@/components/editorial'
import { readingMinutes, searchArticles } from '@/content/knowledge'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { SITE_CONTACT } from '@/lib/site'

/* ---------------------------------------------------------------------------
 * Help Center — questions and answers that describe what the site actually does
 * today, grouped by topic, with a search box over the FAQ and the Knowledge
 * Center articles. Contact details are shown only when they are configured.
 * ------------------------------------------------------------------------- */

/** Display order of the FAQ (keys help.q<n>/help.a<n>): general questions first, then the search walkthrough. */
const FAQ_ORDER = [1, 11, 12, 8, 9, 10, 2, 3, 4, 5, 6, 7] as const

const TOPICS: { key: string; Icon: LucideIcon; to: string }[] = [
  { key: 'searching', Icon: Search, to: '/knowledge-center?topic=searching' },
  { key: 'gazette', Icon: FileText, to: '/knowledge-center?topic=gazette' },
  { key: 'classes', Icon: Tag, to: '/knowledge-center?topic=classes' },
  { key: 'corrections', Icon: ClipboardCheck, to: '/data-corrections' },
  { key: 'legal', Icon: Scale, to: '/legal' },
  { key: 'technical', Icon: Wrench, to: '/contact' },
]

const GLOSSARY = ['class', 'gazette', 'objection', 'applicant'] as const

export function HelpPage() {
  const { t } = useTranslation()
  useDocumentTitle(`${t('help.title')} · ${t('app.shortName')}`, t('help.metaDescription'))
  const [params, setParams] = useSearchParams()
  const query = (params.get('q') ?? '').trim()
  const [draft, setDraft] = useState(query)
  // Keep the input in sync when the URL changes through a link (e.g. back/forward).
  const [prevQuery, setPrevQuery] = useState(query)
  if (query !== prevQuery) {
    setPrevQuery(query)
    setDraft(query)
  }
  const resultsRef = useRef<HTMLDivElement>(null)

  const faqs = useMemo(() => FAQ_ORDER.map((n) => ({ n, q: t(`help.q${n}`), a: t(`help.a${n}`) })), [t])

  const results = useMemo(() => {
    if (!query) return null
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const matchingFaqs = faqs.filter(({ q, a }) => {
      const hay = `${q} ${a}`.toLowerCase()
      return terms.every((term) => hay.includes(term))
    })
    return { faqs: matchingFaqs, articles: searchArticles(query) }
  }, [query, faqs])

  const setQuery = (value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set('q', value)
    else next.delete('q')
    setParams(next, { replace: true })
  }
  const onSearch = (ev: FormEvent) => {
    ev.preventDefault()
    const value = draft.trim()
    setQuery(value || null)
    if (value) window.setTimeout(() => resultsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30)
  }
  const clear = () => {
    setDraft('')
    setQuery(null)
  }

  const quickLinks: { Icon: LucideIcon; label: string; to: string }[] = [
    { Icon: HelpCircle, label: t('help.quick.faq'), to: '/help#faq' },
    { Icon: FileText, label: t('help.quick.howTo'), to: '/knowledge-center/how-to-search-trademark-records' },
    { Icon: Tag, label: t('help.quick.classes'), to: '/knowledge-center/understanding-trademark-classes' },
    { Icon: BookOpen, label: t('help.quick.gazette'), to: '/knowledge-center/how-to-read-gazette-entries' },
    { Icon: Mail, label: t('help.quick.contact'), to: '/contact' },
  ]
  const phoneHref = SITE_CONTACT.phone ? `tel:${SITE_CONTACT.phone.replace(/[^\d+]/g, '')}` : ''

  const searchForm = (
    <form onSubmit={onSearch} role="search" className="w-full max-w-[520px] rounded-xl border border-brand-100 bg-white/80 p-2 shadow-[0_10px_30px_-18px_rgba(16,35,58,0.35)] backdrop-blur-sm" data-testid="help-search">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="help-search" className="sr-only">{t('help.search.label')}</label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <input id="help-search" type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('help.search.placeholder')} className="field h-11 border-transparent bg-transparent ps-10 shadow-none" autoComplete="off" />
        </div>
        <button type="submit" className="btn btn-primary h-11 min-w-[120px]">{t('help.search.button')}</button>
      </div>
    </form>
  )

  return (
    <div data-testid="help-page">
      <SplitHero
        label={t('help.label')}
        title={t('help.heroTitle')}
        text={t('help.intro')}
        image="/img/hero-help.jpg"
        imagePosition="50% 55%"
        credit={{ text: t('help.photoCredit'), href: 'https://commons.wikimedia.org/wiki/File:Computer_lab_at_Herat_University.jpg' }}
        actions={searchForm}
        testId="help-hero"
      />

      <div className="container-x py-12 md:py-14">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] lg:gap-10">
          <div className="min-w-0">
            {/* Search results (only while a query is present) */}
            <div ref={resultsRef} className="scroll-mt-24" aria-live="polite">
              {results && (
                <section className="mb-10 rounded-xl border border-ink-200 bg-white p-5 md:p-6" aria-labelledby="help-results-title" data-testid="help-results">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 id="help-results-title" className="font-serif text-[22px] font-semibold text-navy-900">{t('help.search.resultsTitle')}</h2>
                      <p className="mt-1 text-[13.5px] text-ink-600">{t('help.search.for', { query })}</p>
                    </div>
                    <button type="button" onClick={clear} className="btn btn-secondary h-9 text-[13px]">
                      <X className="h-3.5 w-3.5" aria-hidden />
                      {t('help.search.clear')}
                    </button>
                  </div>
                  {results.faqs.length === 0 && results.articles.length === 0 ? (
                    <div className="mt-5 rounded-lg border border-dashed border-ink-200 bg-ink-50 p-5 text-[14px] text-ink-700">
                      <p>{t('help.search.empty', { query })}</p>
                      <Link to="/contact" className="link-green mt-3 inline-flex items-center gap-1.5">
                        {t('help.quick.contact')}
                        <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                      </Link>
                    </div>
                  ) : (
                    <div className="mt-5 space-y-6">
                      {results.faqs.length > 0 && (
                        <div>
                          <p className="eyebrow">{t('help.search.faqs')}</p>
                          <ul className="mt-3 divide-y divide-ink-100 border-y border-ink-100">
                            {results.faqs.map(({ n, q, a }) => (
                              <li key={n} className="py-3.5">
                                <h3 className="text-[15px] font-semibold text-ink-900">{q}</h3>
                                <p className="mt-1.5 text-[14px] leading-relaxed text-ink-700">{a}</p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {results.articles.length > 0 && (
                        <div>
                          <p className="eyebrow">{t('help.search.articles')}</p>
                          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                            {results.articles.map((a) => (
                              <li key={a.slug}>
                                <Link to={`/knowledge-center/${a.slug}`} className="ed-card flex h-full flex-col p-4 hover:border-brand-200">
                                  <span className="eyebrow">{a.label ? t(`knowledge.labels.${a.label}`) : t(`knowledge.categories.${a.category}.title`)}</span>
                                  <span className="ed-title mt-1.5 text-[16px]">{t(`knowledge.articles.${a.slug}.title`, { defaultValue: a.title })}</span>
                                  <span className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-ink-600">{t(`knowledge.articles.${a.slug}.summary`, { defaultValue: a.summary })}</span>
                                  <span className="mt-auto flex items-center justify-between pt-3 text-[12.5px] text-ink-500">
                                    <span className="inline-flex items-center gap-1.5">
                                      <Clock className="h-3.5 w-3.5" aria-hidden />
                                      {t('knowledge.readTime', { count: readingMinutes(a) })}
                                    </span>
                                    <span className="link-green inline-flex items-center gap-1">
                                      {t('help.search.readArticle')}
                                      <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                                    </span>
                                  </span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )}
            </div>

            {/* Topics */}
            <section aria-labelledby="help-topics">
              <SectionHeading label={t('help.topics.label')} title={t('help.topics.title')} text={t('help.topics.text')} id="help-topics" />
              <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {TOPICS.map(({ key, Icon, to }) => (
                  <li key={key}>
                    <FeatureCard Icon={Icon} title={t(`help.topics.items.${key}.title`)} text={t(`help.topics.items.${key}.text`)} to={to} linkLabel={t(`help.topics.items.${key}.link`)} testId={`help-topic-${key}`} />
                  </li>
                ))}
              </ul>
            </section>

            <InfoBanner Icon={Lightbulb} title={t('help.before.title')} className="mt-8">
              <p>{t('help.before.text')}</p>
            </InfoBanner>

            {/* FAQ */}
            <section id="faq" className="mt-12 scroll-mt-24" aria-labelledby="help-faq-title">
              <SectionHeading label={t('help.faq.label')} title={t('help.faq.title')} text={t('help.faq.text')} id="help-faq-title" />
              <div className="mt-6 divide-y divide-ink-100 rounded-xl border border-ink-200 bg-white px-5" data-testid="help-faq">
                {faqs.map(({ n, q, a }) => (
                  <details key={n} className="group py-1" data-testid={`help-faq-${n}`}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-3.5 text-[14.5px] font-medium text-ink-900 marker:content-none [&::-webkit-details-marker]:hidden">
                      <span>{q}</span>
                      <Plus className="h-4 w-4 shrink-0 text-brand-600 transition-transform duration-200 group-open:rotate-45" aria-hidden />
                    </summary>
                    <p className="pb-4 pe-8 text-[14px] leading-relaxed text-ink-700">{a}</p>
                  </details>
                ))}
              </div>
            </section>

            {/* Glossary */}
            <section className="mt-8 rounded-xl border border-ink-200 bg-white p-5 md:p-6" aria-labelledby="help-glossary">
              <h2 id="help-glossary" className="font-serif text-[20px] font-semibold text-navy-900">{t('help.glossary')}</h2>
              <ul className="mt-3 grid gap-x-8 gap-y-2.5 text-[14px] leading-relaxed text-ink-700 md:grid-cols-2">
                {GLOSSARY.map((g) => (
                  <li key={g} className="flex gap-2.5">
                    <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" aria-hidden />
                    <span>{t(`help.g.${g}`)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* Sidebar */}
          <aside className="space-y-5">
            <SidePanel tone="green" className="p-6" testId="help-support">
              <IconBadge Icon={Headset} size="lg" className="bg-white" />
              <h2 className="mt-4 font-serif text-[20px] font-semibold text-navy-900">{t('help.support.title')}</h2>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-700">{t('help.support.text')}</p>
              <ul className="mt-4 space-y-2">
                {SITE_CONTACT.email && (
                  <li>
                    <a href={`mailto:${SITE_CONTACT.email}`} className="flex items-center gap-3 rounded-lg border border-brand-100 bg-white px-4 py-3 text-ink-900 transition-colors hover:border-brand-300">
                      <Mail className="h-5 w-5 shrink-0 text-brand-600" aria-hidden strokeWidth={1.75} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-semibold">{t('help.support.email')}</span>
                        <span className="block truncate text-[12px] text-ink-500" dir="ltr">{SITE_CONTACT.email}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-ink-400 rtl:-scale-x-100" aria-hidden />
                    </a>
                  </li>
                )}
                {SITE_CONTACT.phone && (
                  <li>
                    <a href={phoneHref} className="flex items-center gap-3 rounded-lg border border-brand-100 bg-white px-4 py-3 text-ink-900 transition-colors hover:border-brand-300">
                      <Phone className="h-5 w-5 shrink-0 text-brand-600" aria-hidden strokeWidth={1.75} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-semibold">{t('help.support.phone')}</span>
                        <span className="block text-[12px] text-ink-500" dir="ltr">{SITE_CONTACT.phone}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-ink-400 rtl:-scale-x-100" aria-hidden />
                    </a>
                  </li>
                )}
                <li>
                  <Link to="/contact" className="flex items-center gap-3 rounded-lg border border-brand-100 bg-white px-4 py-3 text-ink-900 transition-colors hover:border-brand-300">
                    <MessageSquare className="h-5 w-5 shrink-0 text-brand-600" aria-hidden strokeWidth={1.75} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold">{t('help.support.form')}</span>
                      <span className="block text-[12px] text-ink-500">{t('help.support.formSub')}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-ink-400 rtl:-scale-x-100" aria-hidden />
                  </Link>
                </li>
              </ul>
            </SidePanel>

            <SidePanel title={t('help.quick.title')} Icon={Link2} tone="white">
              <ul className="mt-3 divide-y divide-ink-100">
                {quickLinks.map(({ Icon, label, to }) => (
                  <li key={to}>
                    <Link to={to} className="flex items-center gap-3 py-2.5 text-[14px] text-ink-800 hover:text-brand-700">
                      <Icon className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                      <span className="flex-1">{label}</span>
                      <ChevronRight className="h-4 w-4 text-ink-400 rtl:-scale-x-100" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </SidePanel>

            <SidePanel tone="green" testId="help-knowledge">
              <div className="flex gap-4">
                <IconBadge Icon={BookOpen} className="bg-white" />
                <div className="min-w-0">
                  <h2 className="font-serif text-[17px] font-semibold text-navy-900">{t('help.knowledge.title')}</h2>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-ink-700">{t('help.knowledge.text')}</p>
                  <Link to="/knowledge-center" className="btn btn-outline-green mt-3 h-9 text-[13px]">
                    {t('help.knowledge.button')}
                    <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                  </Link>
                </div>
              </div>
            </SidePanel>
          </aside>
        </div>

        <ClosingBanner
          className="mt-12"
          title={t('help.closing.title')}
          text={t('help.closing.text')}
          Icon={MessageCircle}
          testId="help-closing"
          action={
            <Link to="/contact" className="btn btn-outline-green">
              {t('help.closing.button')}
              <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
            </Link>
          }
        />
      </div>
    </div>
  )
}
