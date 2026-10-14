import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  Accessibility,
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  ChevronRight,
  Database,
  Eye,
  FileText,
  Handshake,
  Headset,
  Image as ImageIcon,
  Info,
  Lightbulb,
  Newspaper,
  Printer,
  Quote,
  Search,
  ShieldCheck,
  Tag,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { ClosingBanner, FeatureCard, IconBadge, InfoBanner, Mountains, SectionHeading, SectionLabel, SidePanel, SplitHero } from '@/components/editorial'
import { registryStatsQuery, trademarksByClassQuery } from '@/services'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { formatNumber } from '@/lib/utils'

/* ---------------------------------------------------------------------------
 * About TMistan — mission, values, what the platform offers and live figures
 * from the registry. Text comes from i18n `about.*`; the figures come from the
 * database (registry_stats / trademarks_by_class) and are never estimated.
 * ------------------------------------------------------------------------- */

const KABUL_PHOTO = '/img/about-kabul.jpg'
const KABUL_PHOTO_SOURCE = 'https://commons.wikimedia.org/wiki/File:Gul-e-Surkh-Square_Panorama.jpg'

const VALUES: { key: string; Icon: LucideIcon }[] = [
  { key: 'accuracy', Icon: ShieldCheck },
  { key: 'transparency', Icon: Eye },
  { key: 'accessibility', Icon: Accessibility },
  { key: 'responsibility', Icon: Handshake },
]

const OFFER: { key: string; Icon: LucideIcon; to: string }[] = [
  { key: 'database', Icon: Search, to: '/search' },
  { key: 'gazette', Icon: Newspaper, to: '/data-sources' },
  { key: 'images', Icon: ImageIcon, to: '/search' },
  { key: 'reports', Icon: Printer, to: '/help#faq' },
]

const GLANCE: { key: string; Icon: LucideIcon; to: string }[] = [
  { key: 'records', Icon: FileText, to: '/data-sources' },
  { key: 'search', Icon: Search, to: '/search' },
  { key: 'learn', Icon: BookOpen, to: '/knowledge-center' },
  { key: 'users', Icon: ShieldCheck, to: '/help' },
]

export function AboutPage() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  useDocumentTitle(`${t('about.title')} · ${t('app.shortName')}`, t('about.metaDescription'))

  const stats = useQuery(registryStatsQuery())
  const byClass = useQuery(trademarksByClassQuery())
  const loading = stats.isPending || byClass.isPending
  const hasRecords = (stats.data?.trademarks ?? 0) > 0
  const showNumbers = stats.isError || loading || hasRecords

  const find = t('about.find', { returnObjects: true }) as string[]

  const benefits = [
    { Icon: ShieldCheck, title: t('about.trust.sources.title'), text: t('about.trust.sources.text') },
    { Icon: Users, title: t('about.trust.researchers.title'), text: t('about.trust.researchers.text') },
    { Icon: Eye, title: t('about.trust.transparency.title'), text: t('about.trust.transparency.text') },
  ]

  const numbers: { key: string; Icon: LucideIcon; value: number | undefined }[] = [
    { key: 'records', Icon: FileText, value: stats.data?.trademarks },
    { key: 'gazettes', Icon: Newspaper, value: stats.data?.gazettes },
    { key: 'applicants', Icon: Building2, value: stats.data?.applicants },
    { key: 'classes', Icon: Tag, value: byClass.data ? byClass.data.length : undefined },
  ]

  return (
    <div data-testid="about-page">
      <SplitHero
        label={t('about.label')}
        title={t('about.title')}
        text={t('about.intro')}
        benefits={benefits}
        image="/img/hero-about.jpg"
        imagePosition="55% 50%"
        credit={{ text: t('about.photoCredit'), href: 'https://commons.wikimedia.org/wiki/File:Stolica_Afganistanu_Kabul_w_2009_roku_02.jpg' }}
        testId="about-hero"
      />

      <div className="container-x py-12 md:py-14">
        {/* Mission + values with the sidebar */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] lg:gap-10">
          <div className="min-w-0">
            <section aria-labelledby="about-mission" className="grid gap-6 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] md:items-start">
              <div>
                <SectionLabel>{t('about.mission.label')}</SectionLabel>
                <h2 id="about-mission" className="ed-h2 mt-2">{t('about.mission.title')}</h2>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-600">{t('about.mission.text')}</p>
              </div>
              <blockquote className="ed-panel relative flex gap-4 md:mt-2">
                <Quote className="h-6 w-6 shrink-0 text-brand-600 rtl:-scale-x-100" aria-hidden strokeWidth={1.75} />
                <p className="font-serif text-[16px] italic leading-relaxed text-ink-800">“{t('about.mission.quote')}”</p>
              </blockquote>
            </section>

            <section aria-labelledby="about-values" className="mt-12">
              <SectionHeading label={t('about.values.label')} title={t('about.values.title')} text={t('about.values.text')} id="about-values" />
              <ul className="mt-6 grid gap-4 sm:grid-cols-2">
                {VALUES.map(({ key, Icon }) => (
                  <li key={key}>
                    <FeatureCard Icon={Icon} title={t(`about.values.items.${key}.title`)} text={t(`about.values.items.${key}.text`)} testId={`about-value-${key}`} />
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <aside className="space-y-5">
            <SidePanel title={t('about.glance.title')} tone="white" testId="about-glance">
              <ul className="mt-3 divide-y divide-ink-100">
                {GLANCE.map(({ key, Icon, to }) => (
                  <li key={key}>
                    <Link to={to} className="group flex items-center gap-3 py-3 text-ink-900 hover:text-brand-700">
                      <IconBadge Icon={Icon} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-semibold">{t(`about.glance.items.${key}.title`)}</span>
                        <span className="block text-[12px] text-ink-500">{t(`about.glance.items.${key}.text`)}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-ink-400 transition-colors group-hover:text-brand-600 rtl:-scale-x-100" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </SidePanel>

            <SidePanel title={t('about.findTitle')} Icon={Check} tone="white">
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-600">{t('about.findIntro')}</p>
              <ul className="mt-3 space-y-1.5 text-[14px] text-ink-800">
                {find.map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <Check className="mt-[3px] h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </SidePanel>

            <SidePanel tone="green" testId="about-help">
              <div className="flex gap-4">
                <IconBadge Icon={Headset} className="bg-white" />
                <div className="min-w-0">
                  <h2 className="font-serif text-[17px] font-semibold text-navy-900">{t('about.help.title')}</h2>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-ink-700">{t('about.help.text')}</p>
                  <Link to="/help" className="btn btn-outline-green mt-3 h-9 text-[13px]">
                    {t('about.help.button')}
                    <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                  </Link>
                </div>
              </div>
            </SidePanel>
          </aside>
        </div>

        {/* What we offer */}
        <div className="mt-14 grid gap-8 border-t border-ink-100 pt-12 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] lg:gap-10">
          <section aria-labelledby="about-offer" className="min-w-0">
            <SectionHeading label={t('about.offer.label')} title={t('about.offer.title')} text={t('about.offer.text')} id="about-offer" />
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {OFFER.map(({ key, Icon, to }) => (
                <li key={key}>
                  <FeatureCard Icon={Icon} title={t(`about.offer.items.${key}.title`)} text={t(`about.offer.items.${key}.text`)} to={to} linkLabel={t('about.offer.learnMore')} testId={`about-offer-${key}`} />
                </li>
              ))}
            </ul>
          </section>
          <SidePanel tone="green" className="relative overflow-hidden lg:mt-[76px]">
            <Mountains className="opacity-[0.16]" />
            <div className="relative flex gap-4">
              <IconBadge Icon={Lightbulb} size="lg" className="bg-white" />
              <h2 className="font-serif text-[20px] font-semibold leading-snug text-navy-900">{t('about.tomorrow.title')}</h2>
            </div>
            <p className="relative mt-4 pb-10 text-[14px] leading-relaxed text-ink-700">{t('about.tomorrow.text')}</p>
          </SidePanel>
        </div>

        {/* What TMistan is — and is not */}
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <InfoBanner Icon={Info} title={t('about.toolTitle')}>
            <p>{t('about.tool')}</p>
          </InfoBanner>
          <InfoBanner Icon={Database} title={t('about.sourceTitle')}>
            <p>{t('about.source')}</p>
          </InfoBanner>
        </div>
      </div>

      {/* Live figures */}
      {showNumbers && (
        <section className="split-hero border-t" style={{ '--hero-img': `url('${KABUL_PHOTO}')`, '--hero-pos': '50% 40%' } as CSSProperties} aria-labelledby="about-numbers" data-testid="about-stats">
          <div className="split-hero-media" aria-hidden />
          <div className="split-hero-band" aria-hidden />
          <p className="pointer-events-none absolute end-[7%] top-10 hidden max-w-[300px] -rotate-3 text-end font-serif text-[26px] font-semibold italic leading-snug text-white [text-shadow:0_2px_14px_rgba(0,0,0,0.55)] md:block lg:text-[30px]" aria-hidden>
            {t('about.numbers.tagline')}
          </p>
          <a className="split-hero-credit" href={KABUL_PHOTO_SOURCE} target="_blank" rel="noreferrer">
            {t('about.numbers.photoCredit')}
          </a>
          <div className="container-x relative py-12 md:py-14">
            <div className="max-w-[520px]">
              <SectionLabel>{t('about.numbers.label')}</SectionLabel>
              <h2 id="about-numbers" className="ed-h2 mt-2">{t('about.numbers.title')}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-600">{t('about.numbers.text')}</p>
              {stats.isError ? (
                <p className="mt-6 rounded-lg border border-ink-200 bg-white/80 p-4 text-[14px] text-ink-700" role="status">{t('about.numbers.unavailable')}</p>
              ) : (
                <ul className="mt-6 grid grid-cols-2 gap-3">
                  {numbers.map(({ key, Icon, value }) => (
                    <li key={key} className="rounded-lg border border-ink-200/80 bg-white/90 p-4" data-testid={`about-stat-${key}`}>
                      <IconBadge Icon={Icon} size="sm" />
                      {loading ? (
                        <span className="mt-3 block h-8 w-16 animate-pulse rounded bg-ink-100" aria-hidden />
                      ) : (
                        <span className="mt-3 block font-serif text-[32px] font-semibold leading-none tabular-nums text-navy-900">{formatNumber(value, lng)}</span>
                      )}
                      <span className="mt-1.5 block text-[13px] leading-snug text-ink-600">{t(`about.numbers.${key}`)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <figure className="relative mt-8 overflow-hidden rounded-xl md:hidden">
              <img src={KABUL_PHOTO} alt="" loading="lazy" width={1400} height={900} className="h-56 w-full object-cover object-[50%_72%]" />
              <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-4 font-serif text-[20px] font-semibold italic text-white">{t('about.numbers.tagline')}</figcaption>
            </figure>
            <p className="mt-2 text-[11px] text-ink-500 md:hidden">
              <a href={KABUL_PHOTO_SOURCE} target="_blank" rel="noreferrer" className="hover:underline">{t('about.numbers.photoCredit')}</a>
            </p>
          </div>
        </section>
      )}

      <div className="container-x py-12 md:py-14">
        <ClosingBanner
          label={t('about.commitment.label')}
          title={t('about.commitment.title')}
          text={t('about.commitment.text')}
          testId="about-commitment"
          action={
            <Link to="/data-sources" className="btn btn-outline-green">
              {t('about.commitment.button')}
              <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
            </Link>
          }
        />
      </div>
    </div>
  )
}
