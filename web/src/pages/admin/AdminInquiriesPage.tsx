import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Loader2, Lock, Mail, RefreshCw, Search } from 'lucide-react'
import { cn, formatDateTime, formatNumber } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { ErrorState } from '@/components/AsyncState'
import { Mono, Notice, PageHeader, Pager, Pill, StickyDetailCell, Toolbar, shortId, useScrollerWidth } from '@/components/admin/AdminUi'
import {
  CONTACT_STATUSES,
  ContactError,
  INQUIRY_TYPES,
  contactCountsQuery,
  listContactRequests,
  updateContactRequest,
  type ContactRequestRow,
  type ContactStatus,
} from '@/services/contact_service'

const LIMIT = 50
const STATUS_TONE: Record<ContactStatus, 'info' | 'warn' | 'ok' | 'muted'> = { new: 'info', in_progress: 'warn', closed: 'ok', spam: 'muted' }

/** /admin/inquiries — private inbox for messages sent through the public Contact & Feedback page. */
export function AdminInquiriesPage() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  useDocumentTitle(`${t('admin.nav.inquiries')} · ${t('app.shortName')}`)
  const [sp, setSp] = useSearchParams()
  const [draft, setDraft] = useState(sp.get('q') ?? '')
  const params = useMemo(
    () => ({ status: sp.get('status'), type: sp.get('type'), query: sp.get('q'), limit: LIMIT, offset: Number(sp.get('offset') ?? 0) || 0 }),
    [sp],
  )
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp)
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    if (!('offset' in patch)) next.delete('offset')
    setSp(next, { replace: true })
  }

  const counts = useQuery({ ...contactCountsQuery(), retry: false })
  const schemaMissing = counts.isError && (counts.error as ContactError).code === 'schema_missing'
  const list = useQuery({
    queryKey: ['admin', 'contact', 'list', params],
    queryFn: () => listContactRequests(params),
    enabled: counts.isSuccess,
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  })
  const rows = list.data?.items ?? []
  const [open, setOpen] = useState<string | null>(null)
  const scrollerRef = useScrollerWidth()

  const onSearch = (ev: FormEvent) => {
    ev.preventDefault()
    update({ q: draft.trim() || null })
  }

  return (
    <div>
      <PageHeader title={t('admin.nav.inquiries')} subtitle={t('admin.inquiries.subtitle')} />

      {counts.isLoading && (
        <div className="muted mt-6 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
        </div>
      )}
      {schemaMissing && (
        <Notice tone="warn" title={t('admin.inquiries.notApplied.title')} className="mt-6">
          {t('admin.inquiries.notApplied.hint')}
        </Notice>
      )}
      {counts.isError && !schemaMissing && <ErrorState className="mt-6" error={counts.error} onRetry={() => void counts.refetch()} />}

      {counts.isSuccess && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {(['total', 'new', 'in_progress', 'closed', 'spam', 'last_24h'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={cn(
                  'card p-3 text-start transition-colors hover:border-brand-200',
                  k !== 'total' && k !== 'last_24h' && params.status === k && 'border-brand-600 ring-1 ring-brand-600',
                )}
                onClick={() => (k === 'total' ? update({ status: null }) : k === 'last_24h' ? undefined : update({ status: k }))}
                disabled={k === 'last_24h'}
              >
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{t(`admin.inquiries.counts.${k}`)}</p>
                <p className="mt-1 text-[22px] font-semibold text-ink-900">{formatNumber(counts.data[k], lng)}</p>
              </button>
            ))}
          </div>

          <Notice tone="info" className="mt-4 inline-flex items-center gap-2">
            <Lock className="h-3.5 w-3.5" /> {t('admin.inquiries.privacy')}
          </Notice>

          <section className="card mt-3 overflow-hidden">
            <Toolbar className="px-4 py-3">
              <select className="field h-9 w-44" value={params.status ?? ''} onChange={(e) => update({ status: e.target.value || null })} aria-label={t('admin.inquiries.columns.status')}>
                <option value="">{t('admin.inquiries.filters.allStatuses')}</option>
                {CONTACT_STATUSES.map((s) => (
                  <option key={s} value={s}>{t(`admin.inquiries.status.${s}`)}</option>
                ))}
              </select>
              <select className="field h-9 w-56" value={params.type ?? ''} onChange={(e) => update({ type: e.target.value || null })} aria-label={t('admin.inquiries.columns.type')}>
                <option value="">{t('admin.inquiries.filters.allTypes')}</option>
                {INQUIRY_TYPES.map((k) => (
                  <option key={k} value={k}>{t(`contact.categories.${k}.title`)}</option>
                ))}
              </select>
              <form onSubmit={onSearch} className="flex min-w-[240px] flex-1 items-center gap-2" role="search">
                <input className="field h-9 flex-1" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('admin.inquiries.filters.search')} aria-label={t('admin.inquiries.filters.search')} />
                <button type="submit" className="btn-secondary h-9 px-3" aria-label={t('nav.search')}>
                  <Search className="h-4 w-4" />
                </button>
              </form>
              <button type="button" className="btn-ghost h-9 px-2" onClick={() => void Promise.all([list.refetch(), counts.refetch()])} aria-label={t('admin.import.refresh')}>
                <RefreshCw className={cn('h-4 w-4', list.isFetching && 'animate-spin')} />
              </button>
            </Toolbar>
            {list.isError && <ErrorState className="m-4" error={list.error} />}
            <div ref={scrollerRef} className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-y border-ink-200 bg-ink-50 text-[12px] text-ink-600">
                  <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
                    <th>{t('admin.inquiries.columns.received')}</th>
                    <th>{t('admin.inquiries.columns.type')}</th>
                    <th>{t('admin.inquiries.columns.from')}</th>
                    <th>{t('admin.inquiries.columns.subject')}</th>
                    <th>{t('admin.inquiries.columns.status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {rows.map((r) => (
                    <InquiryRow key={r.id} row={r} lng={lng} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
                  ))}
                  {!list.isLoading && rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-ink-500">{t('admin.inquiries.empty')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pager className="border-t border-ink-200 px-4 py-2" total={list.data?.total ?? 0} offset={params.offset} limit={LIMIT} onChange={(o) => update({ offset: o ? String(o) : null })} />
          </section>
        </>
      )}
    </div>
  )
}

function InquiryRow({ row, lng, open, onToggle }: { row: ContactRequestRow; lng: string | undefined; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  return (
    <>
      <tr className={cn('cursor-pointer hover:bg-ink-50', open && 'bg-ink-50')} onClick={onToggle}>
        <td className="whitespace-nowrap px-4 py-2 text-ink-700">{formatDateTime(row.created_at, lng)}</td>
        <td className="px-4 py-2 text-ink-700">{t(`contact.categories.${row.inquiry_type}.title`, { defaultValue: row.inquiry_type })}</td>
        <td className="px-4 py-2">
          <p className="font-medium text-ink-900">{row.full_name}</p>
          <p className="text-[12px] text-ink-500" dir="ltr">{row.email}</p>
        </td>
        <td className="max-w-[360px] px-4 py-2 text-ink-800">
          <p className="truncate">{row.subject}</p>
          <p className="truncate text-[12px] text-ink-500">{row.message}</p>
        </td>
        <td className="px-4 py-2">
          <Pill tone={STATUS_TONE[row.status] ?? 'muted'}>{t(`admin.inquiries.status.${row.status}`, { defaultValue: row.status })}</Pill>
        </td>
      </tr>
      {open && (
        <tr>
          <StickyDetailCell colSpan={5} className="bg-ink-50/70 text-[13px]">
            <InquiryDetail row={row} lng={lng} />
          </StickyDetailCell>
        </tr>
      )}
    </>
  )
}

function InquiryDetail({ row, lng }: { row: ContactRequestRow; lng: string | undefined }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [status, setStatus] = useState<ContactStatus>(row.status)
  const [note, setNote] = useState(row.admin_note ?? '')
  const save = useMutation({
    mutationFn: () => updateContactRequest(row.id, status, note.trim() || null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'contact'] })
    },
  })
  const details = Object.entries(row.details ?? {}).filter(([, v]) => typeof v === 'string' && v.trim())
  const label = (k: string, v: string) => {
    if (k === 'research_type') return t(`contact.form.research.researchTypes.${v}`, { defaultValue: v })
    if (k === 'response_format') return t(`contact.form.research.formats.${v}`, { defaultValue: v })
    if (k === 'issue_category') return t(`contact.form.correction.issues.${v}`, { defaultValue: t(`contact.form.support.issues.${v}`, { defaultValue: v }) })
    return v
  }
  const subject = `Re: ${row.subject} [TMistan ${shortId(row.id)}]`
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <p className="mb-1 font-semibold text-ink-800">{t('admin.inquiries.detail.message')}</p>
        <div className="whitespace-pre-wrap rounded border border-ink-200 bg-white p-3 leading-relaxed text-ink-800 bidi-auto">{row.message}</div>
        {details.length > 0 && (
          <>
            <p className="mb-1 mt-4 font-semibold text-ink-800">{t('admin.inquiries.detail.details')}</p>
            <dl className="grid gap-x-6 gap-y-1.5 rounded border border-ink-200 bg-white p-3 sm:grid-cols-2">
              {details.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[11px] uppercase tracking-wide text-ink-500">{k.replace(/_/g, ' ')}</dt>
                  <dd className="break-words text-ink-800 bidi-auto">{label(k, v as string)}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
        <dl className="mt-4 grid gap-x-6 gap-y-1.5 text-[12px] text-ink-600 sm:grid-cols-2">
          {row.organization && <Item k={t('admin.inquiries.detail.organization')} v={row.organization} />}
          {row.locale && <Item k={t('admin.inquiries.detail.locale')} v={row.locale} />}
          {row.page_url && <Item k={t('admin.inquiries.detail.page')} v={<span className="break-all" dir="ltr">{row.page_url}</span>} />}
          <Item k="ID" v={<Mono>{row.id}</Mono>} />
          {row.handled_at && <Item k={t('admin.inquiries.detail.handled')} v={formatDateTime(row.handled_at, lng)} />}
        </dl>
      </div>
      <div className="min-w-0 rounded border border-ink-200 bg-white p-4">
        <a href={`mailto:${encodeURIComponent(row.email)}?subject=${encodeURIComponent(subject)}`} className="btn-outline-green inline-flex h-9 items-center gap-2 px-3 text-[13px]">
          <Mail className="h-4 w-4" /> {t('admin.inquiries.detail.reply')}
        </a>
        <label className="mt-4 block text-[12px] font-medium text-ink-700" htmlFor={`status-${row.id}`}>{t('admin.inquiries.detail.setStatus')}</label>
        <select id={`status-${row.id}`} className="field mt-1 h-9" value={status} onChange={(e) => setStatus(e.target.value as ContactStatus)}>
          {CONTACT_STATUSES.map((s) => (
            <option key={s} value={s}>{t(`admin.inquiries.status.${s}`)}</option>
          ))}
        </select>
        <label className="mt-3 block text-[12px] font-medium text-ink-700" htmlFor={`note-${row.id}`}>{t('admin.inquiries.detail.note')}</label>
        <textarea id={`note-${row.id}`} className="field mt-1 min-h-[96px]" value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} placeholder={t('admin.inquiries.detail.notePlaceholder')} />
        <div className="mt-3 flex items-center gap-3">
          <button type="button" className="btn-primary h-9 px-4 text-[13px]" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {t('admin.inquiries.detail.save')}
          </button>
          {save.isSuccess && <span className="text-[12px] text-brand-700">{t('admin.inquiries.detail.saved')}</span>}
          {save.isError && <span className="text-[12px] text-red-700">{(save.error as Error).message}</span>}
        </div>
      </div>
    </div>
  )
}

function Item({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-ink-500">{k}</dt>
      <dd className="break-words text-ink-800">{v}</dd>
    </div>
  )
}
