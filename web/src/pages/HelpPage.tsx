import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, BookOpen } from 'lucide-react'
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
        <div className="space-y-4">
          <section id="glossary" className="card h-fit p-5">
            <h2 className="text-[17px] font-semibold text-ink-900">{t('help.glossary')}</h2>
            <ul className="mt-3 space-y-3 text-[14px] leading-relaxed text-ink-700">
              {glossary.map((k) => (
                <li key={k}>{t(`help.g.${k}`)}</li>
              ))}
            </ul>
          </section>
          <section className="rounded-xl border border-brand-100 bg-brand-50/70 p-5" data-testid="help-knowledge">
            <div className="flex gap-3">
              <span className="icon-circle h-10 w-10 bg-white"><BookOpen className="h-5 w-5" aria-hidden /></span>
              <div>
                <h2 className="text-[16px] font-semibold text-ink-900">{t('help.knowledge.title')}</h2>
                <p className="mt-1 text-[13.5px] leading-relaxed text-ink-700">{t('help.knowledge.text')}</p>
                <Link to="/knowledge-center" className="btn btn-secondary mt-3 h-9 text-[13px]">
                  {t('help.knowledge.button')}
                  <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
