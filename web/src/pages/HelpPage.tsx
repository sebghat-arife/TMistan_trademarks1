import { useTranslation } from 'react-i18next'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export function HelpPage() {
  const { t } = useTranslation()
  useDocumentTitle(`${t('help.title')} · ${t('app.shortName')}`)
  const qa = [1, 2, 3, 4] as const
  const glossary = ['class', 'gazette', 'objection', 'applicant', 'attorney'] as const

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
        <section id="glossary" className="card p-5">
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

export function LegalPage({ kind }: { kind: 'terms' | 'privacy' }) {
  const { t } = useTranslation()
  const title = t(kind === 'terms' ? 'legal.termsTitle' : 'legal.privacyTitle')
  useDocumentTitle(`${title} · ${t('app.shortName')}`)
  return (
    <div className="container-x py-8">
      <div className="card max-w-3xl p-6 md:p-8">
        <h1 className="text-[28px] font-bold text-ink-900">{title}</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-700">{t(kind === 'terms' ? 'legal.terms' : 'legal.privacy')}</p>
      </div>
    </div>
  )
}
