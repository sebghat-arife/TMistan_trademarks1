import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, ShieldAlert, X } from 'lucide-react'
import { cn, formatNumber } from '@/lib/utils'
import { DELETE_TOKEN, dataManagementReady } from '@/services/admin_data_service'
import { ErrorState } from '@/components/AsyncState'

/* ---------------------------------------------------------------------------
 * Shared building blocks of the Admin Data Management Center.
 * ------------------------------------------------------------------------- */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[24px] font-bold text-ink-900">{title}</h1>
        {subtitle && <p className="muted mt-1 max-w-3xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Gate: renders children only when migration 0600 is applied and the user is an administrator. */
export function DataManagementGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const ready = useQuery({ queryKey: ['admin', 'data_ready'], queryFn: dataManagementReady, staleTime: 60_000, retry: false })
  if (ready.isLoading) return <div className="muted mt-6 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}</div>
  if (ready.isError) return <ErrorState className="mt-6" error={ready.error} onRetry={() => void ready.refetch()} />
  if (ready.data && !ready.data.ready) {
    return (
      <div className="card mt-6 border-amber-200 bg-amber-50 p-5">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div className="text-[14px] text-amber-900">
            <p className="font-semibold">{ready.data.reason === 'schema_missing' ? t('admin.data.notApplied.title') : t('admin.data.notReady')}</p>
            <p className="mt-1">{ready.data.message}</p>
            {ready.data.reason === 'schema_missing' && <p className="mt-2 text-[13px]">{t('admin.data.notApplied.hint')}</p>}
          </div>
        </div>
      </div>
    )
  }
  return <>{children}</>
}

export function Pager({ total, offset, limit, onChange, className }: { total: number; offset: number; limit: number; onChange: (offset: number) => void; className?: string }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  if (total <= 0) return null
  const from = offset + 1
  const to = Math.min(total, offset + limit)
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-600', className)}>
      <span>{t('admin.data.pager', { from: formatNumber(from, lng), to: formatNumber(to, lng), total: formatNumber(total, lng) })}</span>
      <div className="flex items-center gap-1">
        <button type="button" className="btn-secondary h-8 px-2" disabled={offset <= 0} onClick={() => onChange(Math.max(0, offset - limit))} aria-label={t('common.previous')}>
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
        </button>
        <button type="button" className="btn-secondary h-8 px-2" disabled={to >= total} onClick={() => onChange(offset + limit)} aria-label={t('common.next')}>
          <ChevronRight className="h-4 w-4 rtl:rotate-180" />
        </button>
      </div>
    </div>
  )
}

export function Pill({ tone, children, className }: { tone: 'ok' | 'warn' | 'error' | 'info' | 'muted'; children: ReactNode; className?: string }) {
  const map = {
    ok: 'bg-brand-50 text-brand-700',
    warn: 'bg-amber-50 text-amber-800',
    error: 'bg-red-50 text-red-700',
    info: 'bg-blue-50 text-blue-700',
    muted: 'bg-ink-100 text-ink-600',
  }
  return <span className={cn('inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold', map[tone], className)}>{children}</span>
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span dir="ltr" className={cn('font-mono text-[12px]', className)}>{children}</span>
}

export function Notice({ tone, title, children, className }: { tone: 'info' | 'warn' | 'error' | 'ok'; title?: string; children?: ReactNode; className?: string }) {
  const map = {
    info: 'border-blue-200 bg-blue-50 text-blue-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-900',
    ok: 'border-brand-200 bg-brand-50 text-brand-800',
  }
  return (
    <div className={cn('rounded-md border px-3 py-2 text-[13px]', map[tone], className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && 'mt-0.5')}>{children}</div>}
    </div>
  )
}

export function KeyValue({ items, className }: { items: [string, ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[13px]', className)}>
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-500">{k}</dt>
          <dd className="min-w-0 break-words text-ink-900">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

/* ------------------------------ ConfirmDialog --------------------------- */

export interface ConfirmDialogProps {
  open: boolean
  title: string
  /** Plain-language description of what happens, including consequences. */
  description: ReactNode
  /** Item identifiers shown to the administrator (serials, filenames, paths). */
  items?: string[]
  itemsLabel?: string
  /** Dependent objects that will also be affected. */
  dependents?: ReactNode
  /** 'reversible' | 'irreversible' — shown as a badge + sentence. */
  reversibility: 'reversible' | 'irreversible'
  /** Require the administrator to type DELETE. */
  requireToken?: boolean
  confirmLabel: string
  busy?: boolean
  error?: unknown
  tone?: 'danger' | 'primary'
  onConfirm: (token: string | null) => void
  onClose: () => void
}

export function ConfirmDialog(p: ConfirmDialogProps) {
  // The body is mounted only while open, so the typed token always starts empty.
  return p.open ? <ConfirmDialogBody {...p} /> : null
}

function ConfirmDialogBody(p: ConfirmDialogProps) {
  const { t } = useTranslation()
  const [token, setToken] = useState('')
  const titleId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const { onClose } = p
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const id = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(id)
    }
  }, [onClose])
  const tokenOk = !p.requireToken || token.trim() === DELETE_TOKEN
  const shown = (p.items ?? []).slice(0, 40)
  const more = (p.items?.length ?? 0) - shown.length
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/50 p-4 sm:items-center" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !p.busy) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="card w-full max-w-lg overflow-hidden shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-ink-200 px-5 py-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className={cn('mt-0.5 h-5 w-5 shrink-0', p.tone === 'primary' ? 'text-brand-600' : 'text-red-600')} />
            <h2 id={titleId} className="text-[16px] font-semibold text-ink-900">{p.title}</h2>
          </div>
          <button type="button" className="btn-ghost h-8 w-8 p-0" onClick={onClose} disabled={p.busy} aria-label={t('common.close')}><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-5 py-4 text-[14px] text-ink-800">
          <div>{p.description}</div>
          {shown.length > 0 && (
            <div>
              {p.itemsLabel && <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-500">{p.itemsLabel}</p>}
              <div className="max-h-40 overflow-y-auto rounded-md border border-ink-200 bg-ink-50 px-3 py-2" dir="ltr">
                <ul className="space-y-0.5 font-mono text-[12px] text-ink-800">
                  {shown.map((s) => <li key={s} className="truncate">{s}</li>)}
                  {more > 0 && <li className="text-ink-500">… +{more}</li>}
                </ul>
              </div>
            </div>
          )}
          {p.dependents && <Notice tone="warn" title={t('admin.data.confirm.dependents')}>{p.dependents}</Notice>}
          <Notice tone={p.reversibility === 'irreversible' ? 'error' : 'info'} title={p.reversibility === 'irreversible' ? t('admin.data.confirm.irreversible') : t('admin.data.confirm.reversible')}>
            {p.reversibility === 'irreversible' ? t('admin.data.confirm.irreversibleHint') : t('admin.data.confirm.reversibleHint')}
          </Notice>
          {p.requireToken && (
            <label className="block text-[13px]">
              <span className="text-ink-700">{t('admin.data.confirm.typeToken', { token: DELETE_TOKEN })}</span>
              <input ref={inputRef} value={token} onChange={(e) => setToken(e.target.value)} className="field mt-1 font-mono" dir="ltr" autoComplete="off" spellCheck={false} placeholder={DELETE_TOKEN} />
            </label>
          )}
          {p.error != null && <ErrorState error={p.error} />}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-ink-200 bg-ink-50 px-5 py-3">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={p.busy}>{t('common.cancel')}</button>
          <button
            type="button"
            className={cn(p.tone === 'primary' ? 'btn-primary' : 'btn-primary border-red-600 bg-red-600 hover:bg-red-700')}
            disabled={!tokenOk || p.busy}
            onClick={() => p.onConfirm(p.requireToken ? token.trim() : null)}
          >
            {p.busy && <Loader2 className="h-4 w-4 animate-spin" />} {p.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Ref for a horizontally scrolling table wrapper. Publishes the wrapper's visible width
 * as the CSS variable `--scroller-w`, so an expanded detail row inside the (wider) table
 * can be rendered `sticky left-0` with `width: var(--scroller-w)` and never scrolls away
 * with the columns — on narrow screens included.
 */
export function useScrollerWidth() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const apply = () => el.style.setProperty('--scroller-w', `${el.clientWidth}px`)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return ref
}

/** Full-width detail row that stays within the visible part of a scrolling table (see useScrollerWidth). */
export function StickyDetailCell({ colSpan, className, children }: { colSpan: number; className?: string; children: ReactNode }) {
  return (
    <td colSpan={colSpan} className={cn('p-0', className)}>
      <div className="sticky left-0 px-4 py-4" style={{ width: 'var(--scroller-w, 100%)' }}>{children}</div>
    </td>
  )
}

/** Checkbox helper for selectable tables. */
export function useSelection<T extends string>() {
  const [selected, setSelected] = useState<Set<T>>(() => new Set())
  const toggle = (id: T) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const setMany = (ids: T[], on: boolean) => setSelected((s) => { const n = new Set(s); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n })
  const clear = () => setSelected(new Set())
  return { selected, toggle, setMany, clear, has: (id: T) => selected.has(id), size: selected.size }
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : '—'
}
