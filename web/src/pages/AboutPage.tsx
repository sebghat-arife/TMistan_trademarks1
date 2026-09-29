import { useTranslation } from 'react-i18next'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

/**
 * About TMistan — the client-approved text (i18n `about.*`), presented as a
 * plain, readable document: headings, paragraphs and lists only.
 */
export function AboutPage() {
  const { t } = useTranslation()
  useDocumentTitle(`${t('about.title')} · ${t('app.shortName')}`, t('about.intro'))

  const find = t('about.find', { returnObjects: true }) as string[]
  const audience = t('about.audience', { returnObjects: true }) as string[]
  const approach = ['accessibility', 'transparency', 'clarity'] as const

  return (
    <div className="container-x py-10 md:py-14">
      <article className="mx-auto max-w-3xl">
        <header>
          <h1 className="text-[34px] font-bold leading-tight tracking-tight text-ink-900 md:text-[40px]">{t('about.title')}</h1>
          <p className="mt-2 text-[18px] font-medium text-brand-600">{t('about.subtitle')}</p>
          <p className="mt-6 text-[17px] font-semibold leading-relaxed text-ink-900">{t('about.intro')}</p>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-700">{t('about.intro2')}</p>
        </header>

        <Section title={t('about.findTitle')}>
          <p>{t('about.findIntro')}</p>
          <List items={find} />
        </Section>

        <Section title={t('about.purposeTitle')}>
          <p>{t('about.purpose')}</p>
        </Section>

        <Section title={t('about.sourceTitle')}>
          <p>{t('about.source')}</p>
        </Section>

        <Section title={t('about.audienceTitle')}>
          <p>{t('about.audienceIntro')}</p>
          <List items={audience} />
        </Section>

        <Section title={t('about.toolTitle')}>
          <p>{t('about.tool')}</p>
        </Section>

        <Section title={t('about.approachTitle')}>
          <dl className="mt-3 space-y-3">
            {approach.map((k) => (
              <div key={k} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <dt className="shrink-0 font-semibold text-ink-900 sm:w-44">{t(`about.approach.${k}`)}</dt>
                <dd className="text-ink-700">{t(`about.approach.${k}Text`)}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <footer className="mt-12 border-t border-ink-200 pt-8">
          <p className="text-[22px] font-bold text-ink-900">{t('about.closingTitle')}</p>
          <p className="mt-1 text-[16px] font-medium text-brand-600">{t('about.closingSubtitle')}</p>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-ink-700">{t('about.closingText')}</p>
        </footer>
      </article>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 text-[15px] leading-relaxed text-ink-700">
      <h2 className="mb-3 text-[22px] font-semibold text-ink-900">{title}</h2>
      {children}
    </section>
  )
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 list-disc space-y-1.5 ps-6 marker:text-brand-600">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}
