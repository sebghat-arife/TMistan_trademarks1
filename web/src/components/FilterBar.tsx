import { useEffect, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { filterOptionsQuery } from '@/services'
import { countActiveFilters, type SearchState } from '@/lib/searchParams'
import { cn } from '@/lib/utils'

interface Props {
  state: SearchState
  onApply: (patch: Partial<SearchState>) => void
  /** Hide the gazette chip when the page is already pinned to a gazette. */
  hideGazette?: boolean
}

const NICE_CLASSES = Array.from({ length: 45 }, (_, i) => i + 1)

/**
 * Horizontal filter row exactly as in the mock-up:
 *   Filters:  [Class ▾] [Gazette ▾] [Applicant ▾] [Application Type ▾] [Date Range ▾]  Clear All
 * Every chip opens a small popover; changes are written to the URL (server-side search).
 */
export function FilterBar({ state, onApply, hideGazette }: Props) {
  const { t } = useTranslation()
  const { data: options } = useQuery(filterOptionsQuery())
  const active = countActiveFilters(state) - (hideGazette && state.gazette ? 1 : 0)
  const classCounts = new Map(options?.classes.map((c) => [c.class, c.count]) ?? [])

  const clear = () =>
    onApply({ mark: '', applicant: '', serial: '', gazette: hideGazette ? state.gazette : '', classes: [], goods: '', type: '', attorney: '', from: '', to: '', page: 1 })

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="me-1 text-[14px] text-ink-600">{t('search.filtersLabel')}</span>

      {/* Class */}
      <Chip label={t('filters.class')} value={state.classes.length ? state.classes.join(', ') : null} onClear={() => onApply({ classes: [], page: 1 })}>
        <p className="mb-2 text-[12px] text-ink-500">{t('filters.classHint')}</p>
        <div className="grid grid-cols-9 gap-1">
          {NICE_CLASSES.map((c) => {
            const on = state.classes.includes(c)
            const n = classCounts.get(c) ?? 0
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                aria-label={`${t('fields.class')} ${c} (${n})`}
                title={`${t('fields.class')} ${c} · ${n}`}
                onClick={() => onApply({ classes: on ? state.classes.filter((x) => x !== c) : [...state.classes, c], page: 1 })}
                className={cn(
                  'h-7 rounded border text-[12px] font-semibold tabular-nums transition-colors',
                  on ? 'border-brand-600 bg-brand-600 text-white' : n > 0 ? 'border-ink-200 bg-white text-ink-700 hover:border-brand-500' : 'border-ink-100 bg-ink-50 text-ink-300',
                )}
              >
                {c}
              </button>
            )
          })}
        </div>
      </Chip>

      {/* Gazette */}
      {!hideGazette && (
        <Chip label={t('filters.gazette')} value={state.gazette || null} onClear={() => onApply({ gazette: '', page: 1 })}>
          <select className="field" value={state.gazette} onChange={(e) => onApply({ gazette: e.target.value, page: 1 })} aria-label={t('filters.gazette')}>
            <option value="">{t('filters.anyGazette')}</option>
            {options?.gazettes.map((g) => (
              <option key={g.gazette_number} value={g.gazette_number}>
                {g.gazette_number} ({g.count})
              </option>
            ))}
          </select>
        </Chip>
      )}

      {/* Applicant */}
      <TextChip label={t('filters.applicant')} value={state.applicant} onCommit={(v) => onApply({ applicant: v, page: 1 })} />

      {/* Application type */}
      <Chip label={t('filters.applicationType')} value={state.type || null} onClear={() => onApply({ type: '', page: 1 })}>
        <select className="field" value={state.type} onChange={(e) => onApply({ type: e.target.value, page: 1 })} aria-label={t('filters.applicationType')}>
          <option value="">{t('filters.anyType')}</option>
          {options?.application_types.map((a) => (
            <option key={a.value} value={a.value}>
              {a.value} ({a.count})
            </option>
          ))}
        </select>
      </Chip>

      {/* Date range */}
      <DateChip state={state} onApply={onApply} />

      {/* More: mark / serial / attorney / goods / fuzzy */}
      <MoreChip state={state} onApply={onApply} />

      <button type="button" onClick={clear} disabled={active === 0} className="ms-1 text-[14px] text-ink-500 hover:text-ink-900 disabled:opacity-40">
        {t('filters.clear')}
      </button>
    </div>
  )
}

/* ── building blocks ─────────────────────────────────────────────────── */

function Chip({ label, value, onClear, children, width = 'w-80' }: { label: string; value: string | null; onClear?: () => void; children: React.ReactNode; width?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className={cn('chip', value && 'border-brand-200 bg-brand-50 text-brand-700')} aria-expanded={open}>
          <span>{label}</span>
          {value && <span className="max-w-[120px] truncate font-semibold">· {value}</span>}
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className={cn('z-50 rounded-lg border border-ink-200 bg-white p-3 shadow-lg outline-none', width)}>
          {children}
          {value && onClear && (
            <button type="button" onClick={() => { onClear(); setOpen(false) }} className="mt-3 text-[12px] text-ink-500 hover:text-ink-900">
              ✕ {label}
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function TextChip({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(value)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setDraft(value)
  }, [value])
  useEffect(() => {
    if (open) setTimeout(() => ref.current?.focus(), 0)
  }, [open])
  const commit = () => { onCommit(draft.trim()); setOpen(false) }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className={cn('chip', value && 'border-brand-200 bg-brand-50 text-brand-700')} aria-expanded={open}>
          <span>{label}</span>
          {value && <span className="max-w-[140px] truncate font-semibold">· {value}</span>}
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-50 w-72 rounded-lg border border-ink-200 bg-white p-3 shadow-lg outline-none">
          <form onSubmit={(e) => { e.preventDefault(); commit() }} className="flex flex-col gap-2">
            <input ref={ref} className="field" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={label} />
            <div className="flex justify-between">
              <button type="button" onClick={() => { setDraft(''); onCommit(''); setOpen(false) }} className="text-[12px] text-ink-500 hover:text-ink-900">✕ {label}</button>
              <button type="submit" className="btn-primary h-8 px-3 text-[13px]">{t('filters.done')}</button>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function DateChip({ state, onApply }: { state: SearchState; onApply: (p: Partial<SearchState>) => void }) {
  const { t } = useTranslation()
  const [from, setFrom] = useState(state.from)
  const [to, setTo] = useState(state.to)
  const [open, setOpen] = useState(false)
  useEffect(() => { setFrom(state.from); setTo(state.to) }, [state.from, state.to])
  const value = state.from || state.to ? `${state.from || '…'} – ${state.to || '…'}` : null
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className={cn('chip', value && 'border-brand-200 bg-brand-50 text-brand-700')} aria-expanded={open}>
          <span>{t('filters.dateRange')}</span>
          {value && <span className="font-semibold tabular-nums" dir="ltr">· {value}</span>}
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-50 w-80 rounded-lg border border-ink-200 bg-white p-3 shadow-lg outline-none">
          <form onSubmit={(e) => { e.preventDefault(); onApply({ from, to, page: 1 }); setOpen(false) }} className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[12px] text-ink-500">{t('filters.from')}<input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" /></label>
              <label className="flex flex-col gap-1 text-[12px] text-ink-500">{t('filters.to')}<input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" /></label>
            </div>
            <div className="flex justify-between">
              <button type="button" onClick={() => { onApply({ from: '', to: '', page: 1 }); setOpen(false) }} className="text-[12px] text-ink-500 hover:text-ink-900">✕ {t('filters.dateRange')}</button>
              <button type="submit" className="btn-primary h-8 px-3 text-[13px]">{t('filters.done')}</button>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function MoreChip({ state, onApply }: { state: SearchState; onApply: (p: Partial<SearchState>) => void }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState({ mark: state.mark, serial: state.serial, attorney: state.attorney, goods: state.goods })
  const [open, setOpen] = useState(false)
  useEffect(() => { setDraft({ mark: state.mark, serial: state.serial, attorney: state.attorney, goods: state.goods }) }, [state.mark, state.serial, state.attorney, state.goods])
  const n = [state.mark, state.serial, state.attorney, state.goods].filter((v) => v.trim()).length
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className={cn('chip', n > 0 && 'border-brand-200 bg-brand-50 text-brand-700')} aria-expanded={open}>
          <span>{t('filters.more')}</span>
          {n > 0 && <span className="font-semibold">· {n}</span>}
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-50 w-80 rounded-lg border border-ink-200 bg-white p-3 shadow-lg outline-none">
          <form onSubmit={(e) => { e.preventDefault(); onApply({ ...draft, page: 1 }); setOpen(false) }} className="flex flex-col gap-2">
            {(['mark', 'serial', 'attorney', 'goods'] as const).map((k) => (
              <label key={k} className="flex flex-col gap-1 text-[12px] text-ink-500">
                {t(`filters.${k}`)}
                <input className={cn('field', k === 'serial' && 'tabular-nums')} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} dir={k === 'serial' ? 'ltr' : undefined} />
              </label>
            ))}
            <label className="mt-1 inline-flex items-center gap-2 text-[13px] text-ink-700" title={t('search.fuzzyHint')}>
              <input type="checkbox" checked={state.fuzzy} onChange={(e) => onApply({ fuzzy: e.target.checked, page: 1 })} className="h-4 w-4 accent-brand-600" />
              {t('search.fuzzy')}
            </label>
            <div className="flex justify-end">
              <button type="submit" className="btn-primary h-8 px-3 text-[13px]">{t('filters.done')}</button>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
