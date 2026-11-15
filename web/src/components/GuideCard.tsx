import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { IconBadge } from '@/components/editorial'
import { GUIDE_ICON } from '@/components/guideIcons'
import type { Guide } from '@/content/guides'

export function GuideCard({ guide, compact }: { guide: Guide; compact?: boolean }) {
  const { t } = useTranslation()
  const Icon = GUIDE_ICON[guide.icon]
  return (
    <Link to={`/guides/${guide.slug}`} className="ed-card flex h-full flex-col" data-testid={`guide-card-${guide.slug}`}>
      <IconBadge Icon={Icon} size={compact ? 'sm' : 'md'} />
      <h3 className={compact ? 'mt-3 font-serif text-[15.5px] font-semibold leading-snug text-navy-900' : 'ed-title mt-4'}>{t(`guides.items.${guide.slug}.title`, { defaultValue: guide.title })}</h3>
      {!compact && <p className="mt-2 line-clamp-3 text-[13.5px] leading-relaxed text-ink-600">{t(`guides.items.${guide.slug}.description`, { defaultValue: guide.metaDescription })}</p>}
      <span className="mt-auto inline-flex items-center gap-1.5 pt-4 text-[13px] font-semibold text-brand-700">
        {t('guides.readGuide')}
        <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
      </span>
    </Link>
  )
}
