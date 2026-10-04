import { useTranslation } from 'react-i18next'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

/** Help — questions and answers that describe what the site actually does today. */
export function HelpPage() {
  const { t } = useTranslation()
  useDocumentTitle(`${t('help.title')} · ${t('app.shortName')}`)
  const qa = [1, 2, 3, 4, 5, 6, 7] as const
  const glossary = ['class', 'gazette', 'objection', 'applicant'] as const

  return (
    <div className="container-x py-8">
      <h1 className="text-[30px] font-bold text-ink-900">{t('help.title')}</h1>
      <p className="muted mt-1 text-[14px]">{t('help.subtitle')}</p>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="card divide-y divide-ink-100">
          {qa.map((n) => (
            <details key={n} className="group p-5" open={n === 1}>
              <summary className="cursor-pointer list-none text-[15px] font-semibold text-ink-900 marker:hidden">
                {t(`help.q${n}`)}
              </summary>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-700">{t(`help.a${n}`)}</p>
            </details>
          ))}
        </section>
        <section id="glossary" className="card h-fit p-5">
          <h2 className="text-[17px] font-semibold text-ink-900">{t('help.glossary')}</h2>
          <ul className="mt-3 space-y-3 text-[14px] leading-relaxed text-ink-700">
            {glossary.map((k) => (
              <li key={k}>{t(`help.g.${k}`)}</li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

export type LegalKind = 'terms' | 'privacy' | 'disclaimer'

const LEGAL_KEYS: Record<LegalKind, { title: string; body: string }> = {
  terms: { title: 'legal.termsTitle', body: 'legal.terms' },
  privacy: { title: 'legal.privacyTitle', body: 'legal.privacy' },
  disclaimer: { title: 'legal.disclaimerTitle', body: 'legal.disclaimer' },
}

export function LegalPage({ kind }: { kind: LegalKind }) {
  const { t } = useTranslation()
  const keys = LEGAL_KEYS[kind]
  const title = t(keys.title)
  useDocumentTitle(`${title} · ${t('app.shortName')}`)
  // A legal text may be a single string or a list of paragraphs.
  const body = t(keys.body, { returnObjects: true }) as string | string[]
  const paragraphs = Array.isArray(body) ? body : [body]
  return (
    <div className="container-x py-8">
      <div className="card max-w-3xl p-6 md:p-8">
        <h1 className="text-[28px] font-bold text-ink-900">{title}</h1>
        {paragraphs.map((para, i) => (
          <p key={i} className="mt-4 text-[15px] leading-relaxed text-ink-700">
            {para}
          </p>
        ))}
      </div>
    </div>
  )
}
