import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, BookOpen, HelpCircle, Search } from 'lucide-react'
import { Seo } from '@/seo/Seo'

/**
 * Unknown URL. Rendered in place (no redirect to the home page) with a
 * robots noindex so search engines record a proper "not found" instead of a
 * soft-404 that returns the landing page.
 */
export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div className="container-x py-16 md:py-24" data-testid="not-found">
      <Seo title={t('seo.notFound.title')} description={t('seo.notFound.description')} robots="noindex,follow" canonical="english" />
      <div className="mx-auto max-w-xl text-center">
        <p className="eyebrow">{t('notFound.eyebrow')}</p>
        <h1 className="mt-3 font-serif text-[34px] font-semibold leading-[1.1] tracking-[-0.015em] text-navy-900 sm:text-[42px]">{t('notFound.title')}</h1>
        <p className="mt-4 text-[16px] leading-relaxed text-ink-700">{t('notFound.text')}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/" className="btn-primary">
            <Search className="h-4 w-4" aria-hidden />
            {t('notFound.search')}
          </Link>
          <Link to="/knowledge-center" className="btn-secondary">
            <BookOpen className="h-4 w-4" aria-hidden />
            {t('notFound.knowledge')}
          </Link>
          <Link to="/help" className="btn-secondary">
            <HelpCircle className="h-4 w-4" aria-hidden />
            {t('notFound.help')}
          </Link>
        </div>
        <Link to="/" className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-medium text-brand-700 hover:underline">
          {t('notFound.home')}
          <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
        </Link>
      </div>
    </div>
  )
}
