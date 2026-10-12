import { useTranslation } from 'react-i18next'
import { ImageIcon, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SearchMode = 'text' | 'image'

/**
 * Segmented control for the two search modes. Rendered as a tab list; the
 * active tab is filled green so the current mode is obvious at a glance.
 */
export function SearchModeSwitch({ mode, onChange, className }: { mode: SearchMode; onChange: (m: SearchMode) => void; className?: string }) {
  const { t } = useTranslation()
  const items: { id: SearchMode; label: string; icon: React.ComponentType<{ className?: string }>; testId: string }[] = [
    { id: 'text', label: t('search.image.modeText'), icon: SlidersHorizontal, testId: 'mode-text' },
    { id: 'image', label: t('search.image.modeImage'), icon: ImageIcon, testId: 'mode-image' },
  ]
  return (
    <div className={cn('seg', className)} role="tablist" aria-label={t('search.image.modeLabel')}>
      {items.map(({ id, label, icon: Icon, testId }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={mode === id}
          aria-controls={`search-panel-${id}`}
          id={`search-tab-${id}`}
          onClick={() => onChange(id)}
          className="seg-item flex-1 sm:flex-none"
          data-testid={testId}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0">{label}</span>
        </button>
      ))}
    </div>
  )
}
