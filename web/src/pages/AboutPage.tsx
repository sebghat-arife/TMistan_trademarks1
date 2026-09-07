import { useTranslation } from 'react-i18next'
import { CheckCircle2, Image as ImageIcon, Landmark, Search } from 'lucide-react'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { Feature } from './HomePage'

export function AboutPage() {
  const { t } = useTranslation()
  useDocumentTitle(`${t('about.title')} · ${t('app.shortName')}`)

  return (
    <div className="container-x py-8">
      <div className="card relative overflow-hidden p-6 md:p-10">
        <img src="/img/about-lineart.png" alt="" aria-hidden className="pointer-events-none absolute inset-y-0 end-0 hidden h-full w-[52%] object-cover object-left opacity-90 rtl:-scale-x-100 lg:block" />
        <div className="relative max-w-xl">
          <h1 className="text-[34px] font-bold text-ink-900">{t('about.title')}</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-700">{t('about.p1')}</p>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-700">{t('about.p2')}</p>

          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <Feature icon={Landmark} title={t('about.features.official')} sub={t('about.features.officialSub')} />
            <Feature icon={CheckCircle2} title={t('about.features.verified')} sub={t('about.features.verifiedSub')} />
            <Feature icon={ImageIcon} title={t('about.features.images')} sub={t('about.features.imagesSub')} />
            <Feature icon={Search} title={t('about.features.search')} sub={t('about.features.searchSub')} />
          </div>
        </div>
      </div>
    </div>
  )
}
