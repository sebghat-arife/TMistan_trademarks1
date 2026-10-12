import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Building2,
  CalendarDays,
  CheckCircle2,
  FileSearch,
  FileText,
  Hash,
  Image as ImageIcon,
  Info,
  Layers,
  ListTree,
  Newspaper,
  Package,
  Search,
  ShieldCheck,
  Tag,
} from 'lucide-react'
import { PageHero, SectionTitle } from '@/components/PageHero'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { REPORT_DISCLAIMER } from '@/lib/pdf/disclaimer'

const FIELD_ICONS = {
  mark: Tag,
  serial: Hash,
  applicant: Building2,
  class: Layers,
  goods: Package,
  gazette: Newspaper,
  date: CalendarDays,
  page: FileText,
  other: ListTree,
} as const

const FLOW = [
  { key: 'gazette', Icon: BookOpen },
  { key: 'source', Icon: FileText },
  { key: 'record', Icon: FileSearch },
  { key: 'result', Icon: Search },
] as const

/** /data-sources — where the records come from, how they are organised, and what they can and cannot tell a reader. */
export function DataSourcesPage() {
  const { t } = useTranslation()
  useDocumentTitle(t('dataSources.metaTitle'), t('dataSources.metaDescription'))

  const approach = t('dataSources.quality.approach', { returnObjects: true }) as string[]
  const points = t('dataSources.coverage.points', { returnObjects: true }) as string[]
  const fieldKeys = Object.keys(FIELD_ICONS) as (keyof typeof FIELD_ICONS)[]

  return (
    <div data-testid="data-sources-page">
      <PageHero eyebrow={t('dataSources.eyebrow')} title={t('dataSources.title')} imagePosition="75% 40%" imageOpacity={0.45}>
        <p>{t('dataSources.intro1')}</p>
        <p>{t('dataSources.intro2')}</p>
      </PageHero>

      <div className="container-x py-12 md:py-16">
        {/* 1 — Official Gazette */}
        <section aria-labelledby="ds-gazette" className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
          <div>
            <SectionTitle number={1} id="ds-gazette" title={t('dataSources.gazette.title')} />
            <div className="mt-5 space-y-4 prose-p">
              <p>{t('dataSources.gazette.p1')}</p>
              <p>{t('dataSources.gazette.p2')}</p>
              <p>{t('dataSources.gazette.p3')}</p>
            </div>
            <p className="mt-5 flex items-start gap-2 rounded-lg border border-ink-200 bg-ink-50 p-4 text-[13.5px] leading-relaxed text-ink-700">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
              <span>{t('dataSources.gazette.notOfficial')}</span>
            </p>
          </div>
          <div className="card self-start p-6">
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-ink-500">{t('dataSources.gazette.flowTitle')}</h3>
            <ol className="mt-5 space-y-1">
              {FLOW.map(({ key, Icon }, i) => (
                <li key={key} className="relative flex items-start gap-4 pb-5 last:pb-0">
                  {i < FLOW.length - 1 && <span className="absolute start-[19px] top-10 bottom-0 w-px bg-brand-100" aria-hidden />}
                  <span className="icon-circle relative h-10 w-10 border border-brand-100">
                    <Icon className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <div className="min-w-0 pt-1">
                    <p className="text-[15px] font-semibold text-ink-900">{t(`dataSources.gazette.flow.${key}.title`)}</p>
                    <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-600">{t(`dataSources.gazette.flow.${key}.text`)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 2 — Fields */}
        <section aria-labelledby="ds-fields" className="mt-16 md:mt-20">
          <SectionTitle number={2} id="ds-fields" title={t('dataSources.fields.title')} lead={t('dataSources.fields.lead')} />
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {fieldKeys.map((key) => {
              const Icon = FIELD_ICONS[key]
              return (
                <li key={key} className="card flex gap-4 p-5">
                  <span className="icon-circle h-10 w-10">
                    <Icon className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold text-ink-900">{t(`dataSources.fields.items.${key}.title`)}</h3>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-ink-600">{t(`dataSources.fields.items.${key}.text`)}</p>
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="muted mt-4 text-[13px]">{t('dataSources.fields.note')}</p>
        </section>

        {/* 3 — Processing & quality */}
        <section aria-labelledby="ds-quality" className="mt-16 grid gap-10 md:mt-20 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
          <div>
            <SectionTitle number={3} id="ds-quality" title={t('dataSources.quality.title')} />
            <div className="mt-5 space-y-4 prose-p">
              <p>{t('dataSources.quality.p1')}</p>
              <p>{t('dataSources.quality.p2')}</p>
              <p>{t('dataSources.quality.p3')}</p>
            </div>
          </div>
          <div className="card self-start p-6">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink-900">
              <ShieldCheck className="h-5 w-5 text-brand-600" aria-hidden />
              {t('dataSources.quality.approachTitle')}
            </h3>
            <ul className="mt-4 space-y-3">
              {approach.map((item) => (
                <li key={item} className="flex items-start gap-3 text-[14px] leading-relaxed text-ink-700">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 4 — Images */}
        <section aria-labelledby="ds-images" className="mt-16 md:mt-20">
          <SectionTitle number={4} id="ds-images" title={t('dataSources.images.title')} />
          <div className="mt-6 grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
            <div className="space-y-4 prose-p">
              <p>{t('dataSources.images.p1')}</p>
              <p>{t('dataSources.images.p2')}</p>
              <p>{t('dataSources.images.p3')}</p>
            </div>
            <div className="self-start rounded-xl border border-brand-100 bg-brand-50/60 p-6">
              <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink-900">
                <ImageIcon className="h-5 w-5 text-brand-600" aria-hidden />
                {t('dataSources.images.calloutTitle')}
              </h3>
              <p className="mt-3 text-[14px] leading-relaxed text-ink-700">{t('dataSources.images.callout')}</p>
              <Link to="/contact?type=data-correction&issue=incorrect_image" className="link-green mt-4 inline-flex items-center gap-1.5">
                {t('dataSources.images.report')}
                <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
              </Link>
            </div>
          </div>
        </section>

        {/* Coverage */}
        <section aria-labelledby="ds-coverage" className="mt-16 md:mt-20">
          <SectionTitle id="ds-coverage" title={t('dataSources.coverage.title')} />
          <div className="mt-6 grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
            <div className="space-y-4 prose-p">
              <p>{t('dataSources.coverage.p1')}</p>
              <p>{t('dataSources.coverage.p2')}</p>
              <p>{t('dataSources.coverage.p3')}</p>
            </div>
            <ul className="space-y-3 self-start">
              {points.map((item, i) => (
                <li key={item} className="card flex items-start gap-3 p-4 text-[14px] leading-relaxed text-ink-800">
                  <span className="num-badge h-7 w-7 text-[12px]" aria-hidden>{i + 1}</span>
                  <span className="pt-0.5">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Important information */}
        <section aria-labelledby="ds-disclaimer" className="mt-16 rounded-xl border border-amber-200 bg-amber-50/70 p-6 md:mt-20 md:p-8">
          <h2 id="ds-disclaimer" className="flex items-center gap-2 font-serif text-[24px] font-semibold text-navy-900">
            <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden />
            {t('dataSources.disclaimer.title')}
          </h2>
          <p className="mt-3 text-[15px] leading-[1.75] text-ink-800">{t('dataSources.disclaimer.text')}</p>
          <details className="mt-4 text-[13.5px] text-ink-700">
            <summary className="cursor-pointer font-semibold text-ink-800">{t('dataSources.disclaimer.showReport')}</summary>
            <p className="mt-2 text-[13px] text-ink-600">{t('dataSources.disclaimer.reportNote')}</p>
            <blockquote className="mt-2 border-s-2 border-amber-300 ps-4 leading-relaxed" lang="en" dir="ltr">
              {REPORT_DISCLAIMER}
            </blockquote>
          </details>
        </section>

        {/* Closing links */}
        <section aria-label={t('dataSources.cta.title')} className="mt-12 flex flex-col items-start justify-between gap-5 rounded-xl bg-navy-900 px-6 py-8 text-white md:mt-16 md:flex-row md:items-center md:px-10">
          <h2 className="font-serif text-[24px] font-semibold">{t('dataSources.cta.title')}</h2>
          <div className="flex flex-wrap gap-3">
            <Link to="/search" className="btn btn-primary">
              <Search className="h-4 w-4" aria-hidden />
              {t('dataSources.cta.search')}
            </Link>
            <Link to="/contact?type=data-correction" className="btn border-white/30 bg-white/10 text-white hover:bg-white/20">
              {t('dataSources.cta.report')}
            </Link>
          </div>
        </section>
      </div>
    </div>
  )
}
