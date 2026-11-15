import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, BookOpen, Search } from 'lucide-react'
import { ClosingBanner, SectionHeading, SectionLabel } from '@/components/editorial'
import { GUIDES } from '@/content/guides'
import { GuideCard } from '@/components/GuideCard'
import { PageSeo } from '@/seo/PageSeo'

/** /guides — hub of the educational landing pages (fully translated page; guide bodies are English). */
export function GuidesPage() {
  const { t } = useTranslation()
  return (
    <div data-testid="guides-page">
      <PageSeo seoKey="guides" path="/guides" type="CollectionPage" />
      <div className="split-hero">
        <div className="container-x relative py-12 md:py-16">
          <div className="max-w-3xl">
            <SectionLabel>{t('guides.label')}</SectionLabel>
            <h1 className="mt-3 font-serif text-[34px] font-semibold leading-[1.1] tracking-[-0.015em] text-navy-900 md:text-[44px]">{t('guides.title')}</h1>
            <p className="mt-5 text-[16px] leading-relaxed text-ink-700">{t('guides.intro')}</p>
          </div>
        </div>
      </div>

      <div className="container-x py-12 md:py-14">
        <SectionHeading label={t('guides.all.label')} title={t('guides.all.title')} text={t('guides.all.text')} id="all-guides" />
        <ul className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {GUIDES.map((g) => <li key={g.slug}><GuideCard guide={g} /></li>)}
        </ul>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <ClosingBanner
            label={t('guides.knowledge.label')}
            title={t('guides.knowledge.title')}
            text={t('guides.knowledge.text')}
            Icon={BookOpen}
            action={<Link to="/knowledge-center" className="btn btn-primary">{t('guides.knowledge.button')}<ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden /></Link>}
          />
          <ClosingBanner
            label={t('guides.search.label')}
            title={t('guides.search.title')}
            text={t('guides.search.text')}
            Icon={Search}
            action={<Link to="/" className="btn btn-secondary">{t('guides.search.button')}<ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden /></Link>}
          />
        </div>
      </div>
    </div>
  )
}

