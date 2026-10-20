import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Copy,
  FileCheck2,
  FileSpreadsheet,
  History,
  Info,
  Search,
  SearchCheck,
  Send,
  Users,
} from 'lucide-react'
import { PageHero, SectionTitle } from '@/components/PageHero'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

/** Service cards; `research` maps to the research-type option preselected on the contact form. */
const SERVICES = [
  { key: 'availability', Icon: SearchCheck, research: 'availability' },
  { key: 'similar', Icon: Copy, research: 'similar' },
  { key: 'historical', Icon: History, research: 'historical' },
  { key: 'review', Icon: FileCheck2, research: 'review' },
  { key: 'portfolio', Icon: Briefcase, research: 'portfolio' },
  { key: 'custom', Icon: FileSpreadsheet, research: 'custom' },
] as const

const REQUEST_URL = '/contact?type=trademark-research'

/** /services — professional research assistance offered through Masnad Law Firm (inquiry-based, never automated). */
export function ServicesPage() {
  const { t } = useTranslation()
  useDocumentTitle(t('services.metaTitle'), t('services.metaDescription'))

  const steps = t('services.process.steps', { returnObjects: true }) as { title: string; text: string }[]
  const audience = t('services.audience.items', { returnObjects: true }) as string[]
  const info = t('services.info.items', { returnObjects: true }) as string[]
  const faq = t('services.faq.items', { returnObjects: true }) as { q: string; a: string }[]

  return (
    <div data-testid="services-page">
      <PageHero
        eyebrow={t('services.eyebrow')}
        title={t('services.title')}
        motif="arch"
        accent
        actions={
          <>
            <Link to={REQUEST_URL} className="btn btn-primary" data-testid="services-request">
              <Send className="h-4 w-4" aria-hidden />
              {t('services.request')}
            </Link>
            <Link to="/" className="btn btn-secondary">
              <Search className="h-4 w-4" aria-hidden />
              {t('services.explore')}
            </Link>
          </>
        }
      >
        <p>{t('services.intro1')}</p>
        <p>{t('services.intro2')}</p>
      </PageHero>

      <div className="container-x py-12 md:py-16">
        {/* From record search to focused research */}
        <section aria-labelledby="sv-from" className="grid gap-8 lg:grid-cols-[1fr_1.4fr] lg:gap-14">
          <SectionTitle id="sv-from" title={t('services.fromSearch.title')} />
          <div className="space-y-4 prose-p">
            <p>{t('services.fromSearch.p1')}</p>
            <p>{t('services.fromSearch.p2')}</p>
          </div>
        </section>

        {/* Service cards */}
        <section aria-labelledby="sv-cards" className="mt-16 md:mt-20">
          <SectionTitle id="sv-cards" title={t('services.cards.title')} lead={t('services.cards.lead')} />
          <ul className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {SERVICES.map(({ key, Icon, research }) => (
              <li key={key} className="card flex flex-col p-6" data-testid={`service-${key}`}>
                <span className="icon-circle h-11 w-11">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="mt-4 text-[17px] font-semibold text-ink-900">{t(`services.cards.items.${key}.title`)}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-700">{t(`services.cards.items.${key}.text`)}</p>
                <dl className="mt-4 space-y-3 border-t border-ink-100 pt-4 text-[13.5px] leading-relaxed">
                  <div>
                    <dt className="font-semibold text-ink-900">{t('services.cards.deliverable')}</dt>
                    <dd className="mt-0.5 text-ink-600">{t(`services.cards.items.${key}.deliverable`)}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-ink-900">{t('services.cards.note')}</dt>
                    <dd className="mt-0.5 text-ink-600">{t(`services.cards.items.${key}.note`)}</dd>
                  </div>
                </dl>
                <Link to={`${REQUEST_URL}&research=${research}`} className="link-green mt-auto inline-flex items-center gap-1.5 pt-5">
                  {t('services.cards.inquire')}
                  <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* Process */}
        <section aria-labelledby="sv-process" className="mt-16 rounded-xl border border-mist-100 bg-mist-50 p-6 md:mt-20 md:p-10">
          <SectionTitle id="sv-process" title={t('services.process.title')} />
          <ol className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            {steps.map((step, i) => (
              <li key={step.title} className="relative">
                <span className="num-badge" aria-hidden>{i + 1}</span>
                <h3 className="mt-3 text-[15px] font-semibold text-ink-900">{step.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-600">{step.text}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 flex items-start gap-2 text-[13px] text-ink-600">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            <span>{t('services.process.note')}</span>
          </p>
        </section>

        {/* Audience + what to provide */}
        <section className="mt-16 grid gap-8 md:mt-20 lg:grid-cols-2 lg:gap-10">
          <div className="card p-6 md:p-8">
            <h2 className="flex items-center gap-2 font-serif text-[24px] font-semibold text-navy-900">
              <Users className="h-5 w-5 text-brand-600" aria-hidden />
              {t('services.audience.title')}
            </h2>
            <ul className="mt-5 space-y-3">
              {audience.map((item) => (
                <li key={item} className="flex items-start gap-3 text-[14px] leading-relaxed text-ink-700">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="muted mt-5 text-[13px] leading-relaxed">{t('services.audience.note')}</p>
          </div>
          <div className="card p-6 md:p-8">
            <h2 className="flex items-center gap-2 font-serif text-[24px] font-semibold text-navy-900">
              <ClipboardList className="h-5 w-5 text-brand-600" aria-hidden />
              {t('services.info.title')}
            </h2>
            <p className="mt-2 text-[14px] text-ink-600">{t('services.info.lead')}</p>
            <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {info.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-[14px] leading-relaxed text-ink-700">
                  <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] leading-relaxed text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <span>{t('services.info.warning')}</span>
            </p>
          </div>
        </section>

        {/* Scope & limitations */}
        <section aria-labelledby="sv-limits" className="mt-16 md:mt-20">
          <SectionTitle id="sv-limits" title={t('services.limits.title')} />
          <div className="mt-5 max-w-3xl space-y-4 prose-p">
            <p>{t('services.limits.p1')}</p>
            <p>{t('services.limits.p2')}</p>
            <p className="font-semibold text-ink-900">{t('services.limits.note')}</p>
          </div>
        </section>

        {/* FAQ */}
        <section aria-labelledby="sv-faq" className="mt-16 md:mt-20">
          <SectionTitle id="sv-faq" title={t('services.faq.title')} />
          <div className="card mt-6 divide-y divide-ink-100">
            {faq.map((item, i) => (
              <details key={item.q} className="faq p-5" open={i === 0}>
                <summary>
                  <span>{item.q}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-ink-500 transition-transform" aria-hidden />
                </summary>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-700">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section aria-labelledby="sv-cta" className="mt-12 rounded-xl bg-navy-900 px-6 py-10 text-white md:mt-16 md:px-10">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <h2 id="sv-cta" className="font-serif text-[26px] font-semibold leading-tight">{t('services.cta.title')}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-white/80">{t('services.cta.text')}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link to={REQUEST_URL} className="btn btn-primary">
                <Send className="h-4 w-4" aria-hidden />
                {t('services.cta.request')}
              </Link>
              <Link to="/" className="btn border-white/30 bg-white/10 text-white hover:bg-white/20">
                <Search className="h-4 w-4" aria-hidden />
                {t('services.cta.search')}
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
