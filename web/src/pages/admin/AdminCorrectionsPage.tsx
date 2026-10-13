import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ExternalLink, FileText, Loader2, Lock, Mail, RefreshCw, Search, Trash2 } from 'lucide-react'
import { cn, formatDateTime, formatNumber, trademarkPath } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { ErrorState } from '@/components/AsyncState'
import { Mono, Notice, PageHeader, Pager, Pill, StickyDetailCell, Toolbar, shortId, useScrollerWidth } from '@/components/admin/AdminUi'
import {
  CORRECTION_STATUSES,
  CORRECTION_TYPES,
  CorrectionError,
  correctionCountsQuery,
  correctionDetailQuery,
  deleteEvidence,
  evidenceSignedUrl,
  listCorrectionRequests,
  updateCorrectionRequest,
  type CorrectionRequestRow,
  type CorrectionStatus,
} from '@/services/correction_service'

const LIMIT = 50
const STATUS_TONE: Record<CorrectionStatus, 'info' | 'warn' | 'ok' | 'muted'> = { received: 'info', under_review: 'warn', more_info_needed: 'warn', resolved: 'ok', closed_no_change: 'muted' }

/** /admin/corrections — private queue for Data Correction & Verification Requests (migration 0900). */
export function AdminCorrectionsPage() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  useDocumentTitle(`${t('admin.nav.corrections')} · ${t('app.shortName')}`)
  const [sp, setSp] = useSearchParams()
  const [draft, setDraft] = useState(sp.get('q') ?? '')
  const params = useMemo(
    () => ({ status: sp.get('status'), type: sp.get('type'), query: sp.get('q'), limit: LIMIT, offset: Number(sp.get('offset') ?? 0) || 0 }),
    [sp],
  )
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp)
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    if (!('offset' in patch) && !('id' in patch)) next.delete('offset')
    setSp(next, { replace: true })
  }

  const counts = useQuery({ ...correctionCountsQuery(), retry: false })
  const schemaMissing = counts.isError && (counts.error as CorrectionError).code === 'schema_missing'
  const list = useQuery({
    queryKey: ['admin', 'corrections', 'list', params],
    queryFn: () => listCorrectionRequests(params),
    enabled: counts.isSuccess,
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  })
  const rows = list.data?.items ?? []
  const [open, setOpen] = useState<string | null>(sp.get('id'))
  const scrollerRef = useScrollerWidth()

  const onSearch = (ev: FormEvent) => {
    ev.preventDefault()
    update({ q: draft.trim() || null })
  }

  return (
    <div>
      <PageHeader title={t('admin.nav.corrections')} subtitle={t('admin.corrections.subtitle')} />

      {counts.isLoading && (
        <div className="muted mt-6 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
        </div>
      )}
      {schemaMissing && (
        <Notice tone="warn" title={t('admin.corrections.notApplied.title')} className="mt-6">
          {t('admin.corrections.notApplied.hint')}
        </Notice>
      )}
      {counts.isError && !schemaMissing && <ErrorState className="mt-6" error={counts.error} onRetry={() => void counts.refetch()} />}

      {counts.isSuccess && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
            {(['total', 'received', 'under_review', 'more_info_needed', 'resolved', 'closed_no_change', 'last_24h'] as const).map((k) => (
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
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{t(`admin.corrections.counts.${k}`)}</p>
                <p className="mt-1 text-[22px] font-semibold text-ink-900">{formatNumber(counts.data[k], lng)}</p>
              </button>
            ))}
          </div>

          <Notice tone="info" className="mt-4 inline-flex items-center gap-2">
            <Lock className="h-3.5 w-3.5" /> {t('admin.corrections.privacy')}
          </Notice>

          <section className="card mt-3 overflow-hidden">
            <Toolbar className="px-4 py-3">
              <select className="field h-9 w-48" value={params.status ?? ''} onChange={(e) => update({ status: e.target.value || null })} aria-label={t('admin.corrections.columns.status')}>
                <option value="">{t('admin.corrections.filters.allStatuses')}</option>
                {CORRECTION_STATUSES.map((s) => (
                  <option key={s} value={s}>{t(`admin.corrections.status.${s}`)}</option>
                ))}
              </select>
              <select className="field h-9 w-52" value={params.type ?? ''} onChange={(e) => update({ type: e.target.value || null })} aria-label={t('admin.corrections.columns.type')}>
                <option value="">{t('admin.corrections.filters.allTypes')}</option>
                {CORRECTION_TYPES.map((k) => (
                  <option key={k} value={k}>{t(`corrections.types.items.${k}.title`)}</option>
                ))}
              </select>
              <form onSubmit={onSearch} className="flex min-w-[240px] flex-1 items-center gap-2" role="search">
                <input className="field h-9 flex-1" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('admin.corrections.filters.search')} aria-label={t('admin.corrections.filters.search')} />
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
                    <th>{t('admin.corrections.columns.received')}</th>
                    <th>{t('admin.corrections.columns.reference')}</th>
                    <th>{t('admin.corrections.columns.type')}</th>
                    <th>{t('admin.corrections.columns.from')}</th>
                    <th>{t('admin.corrections.columns.record')}</th>
                    <th>{t('admin.corrections.columns.status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {rows.map((r) => (
                    <RequestRow
                      key={r.id}
                      row={r}
                      lng={lng}
                      open={open === r.id}
                      onToggle={() => {
                        const next = open === r.id ? null : r.id
                        setOpen(next)
                        update({ id: next }) // keeps the open request across a refresh
                      }}
                    />
                  ))}
                  {!list.isLoading && rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-ink-500">{t('admin.corrections.empty')}</td>
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

function RequestRow({ row, lng, open, onToggle }: { row: CorrectionRequestRow; lng: string | undefined; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  return (
    <>
      <tr className={cn('cursor-pointer hover:bg-ink-50', open && 'bg-ink-50')} onClick={onToggle} data-testid={`correction-row-${row.reference}`}>
        <td className="whitespace-nowrap px-4 py-2 text-ink-700">{formatDateTime(row.created_at, lng)}</td>
        <td className="px-4 py-2"><Mono>{row.reference}</Mono></td>
        <td className="px-4 py-2 text-ink-700">{t(`corrections.types.items.${row.request_type}.title`, { defaultValue: row.request_type })}</td>
        <td className="px-4 py-2">
          <p className="font-medium text-ink-900">{row.full_name}</p>
          <p className="text-[12px] text-ink-500" dir="ltr">{row.email}</p>
        </td>
        <td className="max-w-[260px] px-4 py-2 text-ink-800">
          <p className="truncate" dir="ltr">{row.trademark_serial ?? row.related_record ?? '—'}</p>
          <p className="truncate text-[12px] text-ink-500">{row.description}</p>
        </td>
        <td className="px-4 py-2">
          <Pill tone={STATUS_TONE[row.status] ?? 'muted'}>{t(`admin.corrections.status.${row.status}`, { defaultValue: row.status })}</Pill>
        </td>
      </tr>
      {open && (
        <tr>
          <StickyDetailCell colSpan={6} className="bg-ink-50/70 text-[13px]">
            <RequestDetail id={row.id} lng={lng} />
          </StickyDetailCell>
        </tr>
      )}
    </>
  )
}

function RequestDetail({ id, lng }: { id: string; lng: string | undefined }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const detail = useQuery(correctionDetailQuery(id))
  const row = detail.data
  const [status, setStatus] = useState<CorrectionStatus | null>(null)
  const [internal, setInternal] = useState<string | null>(null)
  const [publicNote, setPublicNote] = useState<string | null>(null)
  const [serial, setSerial] = useState('')
  const save = useMutation({
    mutationFn: () =>
      updateCorrectionRequest({
        id,
        status: status ?? row!.status,
        internalNote: internal, // null = unchanged
        publicNote,
        trademarkSerial: serial || null,
      }),
    onSuccess: () => {
      setSerial('')
      void qc.invalidateQueries({ queryKey: ['admin', 'corrections'] })
    },
  })
  const openFile = useMutation({ mutationFn: (name: string) => evidenceSignedUrl(name), onSuccess: (url) => window.open(url, '_blank', 'noopener') })
  const removeFile = useMutation({
    mutationFn: (name: string) => deleteEvidence(name),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'corrections', 'detail', id] }),
  })

  if (detail.isLoading) return <div className="muted flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}</div>
  if (detail.isError || !row) return <ErrorState error={detail.error ?? new Error('Not found')} onRetry={() => void detail.refetch()} />

  const currentStatus = status ?? row.status
  const subject = `Re: TMistan data correction ${row.reference}`
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]" data-testid="correction-detail">
      <div className="min-w-0">
        <p className="mb-1 font-semibold text-ink-800">{t('admin.corrections.detail.description')}</p>
        <div className="whitespace-pre-wrap rounded border border-ink-200 bg-white p-3 leading-relaxed text-ink-800 bidi-auto">{row.description}</div>

        <dl className="mt-4 grid gap-x-6 gap-y-2 rounded border border-ink-200 bg-white p-3 sm:grid-cols-2">
          <Item k={t('admin.corrections.detail.record')} v={row.related_record ? <span dir="ltr">{row.related_record}</span> : '—'} />
          <Item
            k={t('admin.corrections.detail.linked')}
            v={
              row.trademark_serial ? (
                <span className="flex flex-wrap items-center gap-2">
                  <Mono>{row.trademark_serial}</Mono>
                  {row.trademark_name && <span className="bidi-auto text-ink-700">{row.trademark_name}</span>}
                  <Link to={trademarkPath(row.trademark_serial)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                    {t('admin.corrections.detail.openRecord')} <ExternalLink className="h-3 w-3" />
                  </Link>
                  <Link to={`/admin/trademarks?q=${encodeURIComponent(row.trademark_serial)}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                    {t('admin.corrections.detail.manageRecord')}
                  </Link>
                </span>
              ) : (
                <span className="text-ink-500">{t('admin.corrections.detail.notLinked')}</span>
              )
            }
          />
          {row.locale && <Item k={t('admin.corrections.detail.locale')} v={row.locale} />}
          {row.page_url && <Item k={t('admin.corrections.detail.page')} v={<span className="break-all" dir="ltr">{row.page_url}</span>} />}
          <Item k="ID" v={<Mono>{row.id}</Mono>} />
          {row.handled_at && <Item k={t('admin.corrections.detail.handled')} v={formatDateTime(row.handled_at, lng)} />}
        </dl>

        <p className="mb-1 mt-4 font-semibold text-ink-800">{t('admin.corrections.detail.files')}</p>
        {row.files.length === 0 ? (
          <p className="text-ink-500">{t('admin.corrections.detail.noFiles')}</p>
        ) : (
          <ul className="divide-y divide-ink-100 rounded border border-ink-200 bg-white">
            {row.files.map((f) => (
              <li key={f.name} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <FileText className="h-4 w-4 shrink-0 text-ink-400" />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]" dir="ltr">{f.name.split('/').pop()}</span>
                <span className="text-[12px] text-ink-500">{f.mimetype ?? ''}{f.size ? ` · ${(f.size / 1024).toFixed(0)} KB` : ''}</span>
                <button type="button" className="btn-outline-green h-8 px-2.5 text-[12px]" onClick={() => openFile.mutate(f.name)} disabled={openFile.isPending}>
                  <ExternalLink className="h-3.5 w-3.5" /> {t('admin.corrections.detail.open')}
                </button>
                <button
                  type="button"
                  className="btn-ghost h-8 px-2 text-[12px] text-red-700"
                  onClick={() => window.confirm(t('admin.corrections.detail.deleteConfirm')) && removeFile.mutate(f.name)}
                  disabled={removeFile.isPending}
                  aria-label={`${t('admin.corrections.detail.delete')} ${f.name.split('/').pop()}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {(openFile.isError || removeFile.isError) && <p className="mt-2 text-[12px] text-red-700">{((openFile.error ?? removeFile.error) as Error).message}</p>}

        <p className="mb-1 mt-4 font-semibold text-ink-800">{t('admin.corrections.detail.history')}</p>
        <ol className="space-y-1 rounded border border-ink-200 bg-white p-3 text-[12.5px]">
          {row.events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="whitespace-nowrap text-ink-500">{formatDateTime(e.created_at, lng)}</span>
              <span>
                {e.from_status ? `${t(`admin.corrections.status.${e.from_status}`)} → ` : ''}
                <strong>{t(`admin.corrections.status.${e.to_status}`, { defaultValue: e.to_status })}</strong>
              </span>
              <span className="text-ink-500">{e.actor_id ? shortId(e.actor_id) : t('admin.corrections.detail.system')}</span>
              {e.note && <span className="basis-full text-ink-700 bidi-auto">“{e.note}”</span>}
            </li>
          ))}
        </ol>
      </div>

      <div className="min-w-0 rounded border border-ink-200 bg-white p-4">
        <a href={`mailto:${row.email.replace(/[?&#%]/g, encodeURIComponent)}?subject=${encodeURIComponent(subject)}`} className="btn-outline-green inline-flex h-9 items-center gap-2 px-3 text-[13px]">
          <Mail className="h-4 w-4" /> {t('admin.corrections.detail.reply')}
        </a>

        <label className="mt-4 block text-[12px] font-medium text-ink-700" htmlFor={`status-${id}`}>{t('admin.corrections.detail.setStatus')}</label>
        <select id={`status-${id}`} className="field mt-1 h-9" value={currentStatus} onChange={(e) => setStatus(e.target.value as CorrectionStatus)}>
          {CORRECTION_STATUSES.map((s) => (
            <option key={s} value={s} disabled={s === 'received' && row.status !== 'received'}>{t(`admin.corrections.status.${s}`)}</option>
          ))}
        </select>
        {row.status !== 'received' && <p className="mt-1 text-[11.5px] text-ink-500">{t('admin.corrections.detail.noBack')}</p>}

        <label className="mt-3 block text-[12px] font-medium text-ink-700" htmlFor={`link-${id}`}>{t('admin.corrections.detail.link')}</label>
        <input id={`link-${id}`} className="field mt-1 h-9 font-mono" dir="ltr" value={serial} onChange={(e) => setSerial(e.target.value)} placeholder={row.trademark_serial ?? t('admin.corrections.detail.linkPlaceholder')} />
        <p className="mt-1 text-[11.5px] text-ink-500">{t('admin.corrections.detail.linkHint')}</p>

        <label className="mt-3 block text-[12px] font-medium text-ink-700" htmlFor={`public-${id}`}>{t('admin.corrections.detail.publicNote')}</label>
        <textarea id={`public-${id}`} className="field mt-1 min-h-[80px]" value={publicNote ?? row.public_note ?? ''} onChange={(e) => setPublicNote(e.target.value)} maxLength={2000} placeholder={t('admin.corrections.detail.publicPlaceholder')} />

        <label className="mt-3 block text-[12px] font-medium text-ink-700" htmlFor={`note-${id}`}>{t('admin.corrections.detail.internalNote')}</label>
        <textarea id={`note-${id}`} className="field mt-1 min-h-[96px]" value={internal ?? row.internal_note ?? ''} onChange={(e) => setInternal(e.target.value)} maxLength={4000} placeholder={t('admin.corrections.detail.internalPlaceholder')} />

        <div className="mt-3 flex items-center gap-3">
          <button type="button" className="btn-primary h-9 px-4 text-[13px]" disabled={save.isPending} onClick={() => save.mutate()} data-testid="correction-save">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {t('admin.corrections.detail.save')}
          </button>
          {save.isSuccess && <span className="text-[12px] text-brand-700">{t('admin.corrections.detail.saved')}</span>}
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
