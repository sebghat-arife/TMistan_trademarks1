import { useId, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { useTranslation } from 'react-i18next'
import { BookOpen, CalendarDays, ChevronDown, FileCheck2, FileText, Hash, LayoutGrid, Package, RotateCcw, ShieldCheck, Type, User } from 'lucide-react'
import type { FilterOptions } from '@/lib/database.types'
import type { SearchState } from '@/lib/searchParams'
import { cn } from '@/lib/utils'

export type AdvancedDraft = Pick<SearchState, 'mark' | 'serial' | 'applicant' | 'applicationNumber' | 'registrationNumber' | 'gazette' | 'classes' | 'goods' | 'type' | 'from' | 'to' | 'fuzzy'>

interface Props {
  id: string
  draft: AdvancedDraft
  onChange: (patch: Partial<AdvancedDraft>) => void
  onClear: () => void
  /** undefined = not probed yet; false = database update 0700 missing (fields shown disabled). */
  numbersSupported?: boolean
  options?: FilterOptions
  className?: string
}

const ALL_CLASSES = Array.from({ length: 45 }, (_, i) => i + 1)

/**
 * Advanced search grid (inside the search form; the main Search button submits
 * everything). Only fields the database can actually filter on are offered.
 */
export function AdvancedSearchPanel({ id, draft, onChange, onClear, numbersSupported, options, className }: Props) {
  const { t } = useTranslation()
  const uid = useId()
  const f = (k: string) => `${uid}-${k}`
  const numbersOff = numbersSupported === false
  const hasAny =
    draft.classes.length > 0 ||
    (['mark', 'serial', 'applicant', 'applicationNumber', 'registrationNumber', 'gazette', 'goods', 'type', 'from', 'to'] as const).some((k) => draft[k].trim() !== '')

  return (
    <div id={id} className={cn('border-t border-ink-200 pt-4', className)} data-testid="advanced-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-ink-900">{t('search.advanced.title')}</h2>
        <button type="button" onClick={onClear} disabled={!hasAny} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-600 hover:text-brand-700 disabled:opacity-40">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          {t('search.advanced.clear')}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field id={f('mark')} icon={Type} label={t('search.advanced.fields.mark')}>
          <input id={f('mark')} className="sfield-control" value={draft.mark} onChange={(e) => onChange({ mark: e.target.value })} placeholder={t('search.advanced.placeholders.mark')} autoComplete="off" />
        </Field>

        <Field id={f('serial')} icon={Hash} label={t('search.advanced.fields.serial')}>
          <input id={f('serial')} className="sfield-control tabular-nums" value={draft.serial} onChange={(e) => onChange({ serial: e.target.value })} placeholder={t('search.advanced.placeholders.serial')} dir="ltr" autoComplete="off" inputMode="text" />
        </Field>

        <Field id={f('applicant')} icon={User} label={t('search.advanced.fields.applicant')}>
          <input id={f('applicant')} className="sfield-control" value={draft.applicant} onChange={(e) => onChange({ applicant: e.target.value })} placeholder={t('search.advanced.placeholders.applicant')} autoComplete="off" />
        </Field>

        <Field id={f('appno')} icon={FileText} label={t('search.advanced.fields.applicationNumber')}>
          <input
            id={f('appno')}
            className="sfield-control tabular-nums"
            value={draft.applicationNumber}
            onChange={(e) => onChange({ applicationNumber: e.target.value })}
            placeholder={numbersOff ? t('search.advanced.placeholders.unavailable') : t('search.advanced.placeholders.applicationNumber')}
            disabled={numbersOff}
            aria-describedby={numbersOff ? f('numbers-note') : undefined}
            dir="ltr"
            autoComplete="off"
          />
        </Field>

        <Field id={f('regno')} icon={ShieldCheck} label={t('search.advanced.fields.registrationNumber')}>
          <input
            id={f('regno')}
            className="sfield-control tabular-nums"
            value={draft.registrationNumber}
            onChange={(e) => onChange({ registrationNumber: e.target.value })}
            placeholder={numbersOff ? t('search.advanced.placeholders.unavailable') : t('search.advanced.placeholders.registrationNumber')}
            disabled={numbersOff}
            aria-describedby={numbersOff ? f('numbers-note') : undefined}
            dir="ltr"
            autoComplete="off"
          />
        </Field>

        <Field id={f('classes')} icon={LayoutGrid} label={t('search.advanced.fields.classes')}>
          <ClassPicker id={f('classes')} value={draft.classes} counts={options?.classes} onChange={(classes) => onChange({ classes })} />
        </Field>

        <Field id={f('gazette')} icon={BookOpen} label={t('search.advanced.fields.gazette')}>
          {options?.gazettes?.length ? (
            <SelectWrap>
              <select id={f('gazette')} className="sfield-control" value={draft.gazette} onChange={(e) => onChange({ gazette: e.target.value })} dir="ltr">
                <option value="">{t('search.advanced.placeholders.anyGazette')}</option>
                {!options.gazettes.some((g) => g.gazette_number === draft.gazette) && draft.gazette && <option value={draft.gazette}>{draft.gazette}</option>}
                {options.gazettes.map((g) => (
                  <option key={g.gazette_number} value={g.gazette_number}>
                    {g.gazette_number} ({g.count})
                  </option>
                ))}
              </select>
            </SelectWrap>
          ) : (
            <input id={f('gazette')} className="sfield-control tabular-nums" value={draft.gazette} onChange={(e) => onChange({ gazette: e.target.value })} placeholder={t('search.advanced.placeholders.gazette')} dir="ltr" autoComplete="off" />
          )}
        </Field>

        <Field id={f('from')} icon={CalendarDays} label={t('search.advanced.fields.date')} className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-2" dir="ltr">
            <input id={f('from')} type="date" className="sfield-control px-2 text-[13px]" value={draft.from} max={draft.to || undefined} onChange={(e) => onChange({ from: e.target.value })} aria-label={`${t('search.advanced.fields.date')} — ${t('search.advanced.placeholders.from')}`} />
            <input type="date" className="sfield-control px-2 text-[13px]" value={draft.to} min={draft.from || undefined} onChange={(e) => onChange({ to: e.target.value })} aria-label={`${t('search.advanced.fields.date')} — ${t('search.advanced.placeholders.to')}`} />
          </div>
        </Field>

        <Field id={f('type')} icon={FileCheck2} label={t('search.advanced.fields.type')}>
          <SelectWrap>
            <select id={f('type')} className="sfield-control" value={draft.type} onChange={(e) => onChange({ type: e.target.value })}>
              <option value="">{t('search.advanced.placeholders.anyType')}</option>
              {draft.type && !options?.application_types?.some((a) => a.value === draft.type) && <option value={draft.type}>{draft.type}</option>}
              {options?.application_types?.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.value} ({a.count})
                </option>
              ))}
            </select>
          </SelectWrap>
        </Field>

        <Field id={f('goods')} icon={Package} label={t('search.advanced.fields.goods')} className="sm:col-span-2">
          <input id={f('goods')} className="sfield-control" value={draft.goods} onChange={(e) => onChange({ goods: e.target.value })} placeholder={t('search.advanced.placeholders.goods')} autoComplete="off" />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-[13px] text-ink-700" title={t('search.fuzzyHint')}>
          <input type="checkbox" checked={draft.fuzzy} onChange={(e) => onChange({ fuzzy: e.target.checked })} className="h-4 w-4 rounded accent-brand-600" />
          {t('search.fuzzy')}
          <span className="hidden text-ink-500 sm:inline">— {t('search.fuzzyHint')}</span>
        </label>
        {numbersOff && (
          <p id={f('numbers-note')} className="text-[12px] text-ink-500" data-testid="numbers-unavailable">
            {t('search.advanced.numbersUnavailable')}
          </p>
        )}
      </div>
    </div>
  )
}

/* ── building blocks ─────────────────────────────────────────────────── */

function Field({ id, icon: Icon, label, children, className }: { id: string; icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('sfield', className)}>
      <label htmlFor={id} className="sfield-label">
        <Icon aria-hidden /> {label}
      </label>
      {children}
    </div>
  )
}

function SelectWrap({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative block">
      {children}
      <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" aria-hidden />
    </span>
  )
}

function ClassPicker({ id, value, counts, onChange }: { id: string; value: number[]; counts?: { class: number; count: number }[]; onChange: (v: number[]) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const countOf = new Map(counts?.map((c) => [c.class, c.count]) ?? [])
  const sorted = [...value].sort((a, b) => a - b)
  const label = sorted.length ? t('search.advanced.classesSelected', { count: sorted.length, list: sorted.join(', ') }) : t('search.advanced.placeholders.classes')
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button id={id} type="button" className={cn('sfield-control relative pe-9 text-start', !sorted.length && 'text-ink-400')} aria-haspopup="dialog" aria-expanded={open} data-testid="class-picker">
          <span className="block truncate">{label}</span>
          <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-50 w-[min(92vw,22rem)] rounded-lg border border-ink-200 bg-white p-3 shadow-lg outline-none">
          <p className="mb-2 text-[12px] text-ink-500">{t('search.advanced.classesHint')}</p>
          <div className="grid grid-cols-9 gap-1">
            {ALL_CLASSES.map((c) => {
              const on = value.includes(c)
              const n = countOf.get(c) ?? 0
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${t('fields.class')} ${c} (${n})`}
                  title={`${t('fields.class')} ${c} · ${n}`}
                  onClick={() => onChange(on ? value.filter((x) => x !== c) : [...value, c])}
                  className={cn(
                    'h-7 rounded border text-[12px] font-semibold tabular-nums transition-colors',
                    on ? 'border-brand-600 bg-brand-600 text-white' : n > 0 || !counts ? 'border-ink-200 bg-white text-ink-700 hover:border-brand-500' : 'border-ink-100 bg-ink-50 text-ink-300',
                  )}
                >
                  {c}
                </button>
              )
            })}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <button type="button" onClick={() => onChange([])} disabled={!value.length} className="text-[12px] text-ink-500 hover:text-ink-900 disabled:opacity-40">
              {t('search.advanced.classesClear')}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn-primary h-8 px-3 text-[13px]">
              {t('search.advanced.classesDone')}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
