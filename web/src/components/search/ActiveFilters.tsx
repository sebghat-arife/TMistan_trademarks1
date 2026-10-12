import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { CLEARED_FILTERS, type SearchState } from '@/lib/searchParams'
import { cn } from '@/lib/utils'

/**
 * Removable chips for the criteria currently applied (everything except the
 * keyword, sorting and paging). Lets a visitor drop one criterion without
 * re-opening the advanced panel.
 */
export function ActiveFilters({ state, onApply, className }: { state: SearchState; onApply: (patch: Partial<SearchState>) => void; className?: string }) {
  const { t } = useTranslation()
  const chips: { key: string; label: string; value: string; patch: Partial<SearchState> }[] = []
  const text = (key: 'mark' | 'serial' | 'applicant' | 'applicationNumber' | 'registrationNumber' | 'gazette' | 'goods' | 'type', labelKey: string) => {
    if (state[key].trim()) chips.push({ key, label: t(labelKey), value: state[key].trim(), patch: { [key]: '', page: 1 } })
  }
  text('mark', 'search.advanced.fields.mark')
  text('serial', 'search.advanced.fields.serial')
  text('applicant', 'search.advanced.fields.applicant')
  text('applicationNumber', 'search.advanced.fields.applicationNumber')
  text('registrationNumber', 'search.advanced.fields.registrationNumber')
  if (state.classes.length) chips.push({ key: 'classes', label: t('search.advanced.fields.classes'), value: [...state.classes].sort((a, b) => a - b).join(', '), patch: { classes: [], page: 1 } })
  text('gazette', 'search.advanced.fields.gazette')
  if (state.from || state.to) chips.push({ key: 'date', label: t('search.advanced.fields.date'), value: `${state.from || '…'} – ${state.to || '…'}`, patch: { from: '', to: '', page: 1 } })
  text('type', 'search.advanced.fields.type')
  text('goods', 'search.advanced.fields.goods')
  if (chips.length === 0) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} data-testid="active-filters">
      <span className="text-[13px] text-ink-500">{t('search.active.label')}</span>
      {chips.map((c) => (
        <span key={c.key} className="inline-flex h-8 max-w-full items-center gap-1 rounded-md border border-brand-200 bg-brand-50 ps-2.5 pe-1 text-[13px] text-brand-800">
          <span className="truncate">
            <span className="text-brand-700/80">{c.label}:</span> <span className="font-semibold" dir="auto">{c.value}</span>
          </span>
          <button type="button" onClick={() => onApply(c.patch)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-brand-100" aria-label={t('search.active.remove', { name: c.label })}>
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </span>
      ))}
      <button type="button" onClick={() => onApply({ ...CLEARED_FILTERS })} className="text-[13px] font-medium text-ink-600 hover:text-ink-900">
        {t('search.active.clear')}
      </button>
    </div>
  )
}
