import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Check, ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Compact, secondary guidance panel shown next to the image-search card. */
export function SearchTips({ className }: { className?: string }) {
  const { t } = useTranslation()
  const items = ['resolution', 'crop', 'formats', 'background'] as const
  return (
    <aside className={cn('card border-ink-200/80 bg-white/85 p-5 backdrop-blur-sm', className)} aria-labelledby="search-tips-title">
      <div className="flex items-center gap-3">
        <span className="icon-circle h-9 w-9"><ImageIcon className="h-4 w-4" aria-hidden /></span>
        <h2 id="search-tips-title" className="text-[15px] font-semibold text-ink-900">{t('search.image.tips.title')}</h2>
      </div>
      <ul className="mt-4 space-y-3">
        {items.map((k) => (
          <li key={k} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-ink-700">
            <Check className="mt-[3px] h-4 w-4 shrink-0 text-brand-600" strokeWidth={2.5} aria-hidden />
            <span>{t(`search.image.tips.${k}`)}</span>
          </li>
        ))}
      </ul>
      <Link to="/help" className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-700 hover:underline">
        {t('search.image.tips.more')} <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
      </Link>
    </aside>
  )
}
