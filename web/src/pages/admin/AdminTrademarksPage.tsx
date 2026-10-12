import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Archive, ArchiveRestore, ExternalLink, Loader2, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { cn, formatDate, formatDateTime, formatNumber, trademarkPath } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { ErrorState } from '@/components/AsyncState'
import { TrademarkImage } from '@/components/TrademarkImage'
import {
  ConfirmDialog, DataManagementGate, KeyValue, Mono, Notice, PageHeader, Pager, Pill, Toolbar, formatBytes, shortId, useSelection,
} from '@/components/admin/AdminUi'
import {
  type AdminTrademarkListItem, type TrademarkSearchParams, deleteImages, deleteTrademarks, getAdminTrademark, searchAdminTrademarks, setTrademarksPublished,
} from '@/services/admin_data_service'

const LIMIT = 50

type Dialog =
  | { kind: 'delete'; ids: string[]; serials: string[]; images: number }
  | { kind: 'archive' | 'restore'; ids: string[]; serials: string[] }
  | { kind: 'deleteImage'; id: string; path: string; serial: string }
  | null

/** Trademark Records — search, inspect (admin-only fields included), archive/restore, delete. */
export function AdminTrademarksPage() {
  const { t } = useTranslation()
  useDocumentTitle(`${t('admin.nav.trademarks')} · ${t('app.shortName')}`)
  return (
    <div>
      <PageHeader title={t('admin.nav.trademarks')} subtitle={t('admin.data.trademarks.subtitle')} />
      <DataManagementGate>
        <TrademarkRecords />
      </DataManagementGate>
    </div>
  )
}

function TrademarkRecords() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const qc = useQueryClient()
  const [sp, setSp] = useSearchParams()
  const [form, setForm] = useState({ query: sp.get('q') ?? '', gazette: sp.get('gazette') ?? '' })
  const params: TrademarkSearchParams = useMemo(() => ({
    query: sp.get('q') ?? '',
    gazette: sp.get('gazette') ?? '',
    status: (sp.get('status') as TrademarkSearchParams['status']) ?? 'all',
    images: (sp.get('images') as TrademarkSearchParams['images']) ?? 'all',
    sort: (sp.get('sort') as TrademarkSearchParams['sort']) ?? 'updated',
    jobId: sp.get('job'),
    limit: LIMIT,
    offset: Number(sp.get('offset') ?? 0) || 0,
  }), [sp])
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp)
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    if (!('offset' in patch)) next.delete('offset')
    setSp(next, { replace: true })
  }
  const list = useQuery({ queryKey: ['admin', 'trademarks', params], queryFn: () => searchAdminTrademarks(params), placeholderData: (prev) => prev, staleTime: 15_000 })
  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const sel = useSelection<string>()
  const [openId, setOpenId] = useState<string | null>(sp.get('id'))
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<unknown>(null)
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => { sel.clear() }, [params]) // eslint-disable-line react-hooks/exhaustive-deps

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin'] })
    void qc.invalidateQueries({ queryKey: ['trademarks'] })
    void qc.invalidateQueries({ queryKey: ['stats'] })
  }
  const selectedItems = items.filter((i) => sel.has(i.id))

  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setDialogError(null)
    try {
      const msg = await fn()
      setDialog(null); sel.clear(); setFlash(msg); invalidate()
    } catch (e) {
      setDialogError(e)
    } finally {
      setBusy(false)
    }
  }
  const onConfirm = (token: string | null) => {
    if (!dialog) return
    if (dialog.kind === 'delete') {
      void run(async () => {
        const r = await deleteTrademarks(dialog.ids, token ?? '')
        if (openId && dialog.ids.includes(openId)) setOpenId(null)
        return t('admin.data.trademarks.deleted', { count: r.deleted, images: r.images_deleted, queued: r.storage_queued })
      })
    } else if (dialog.kind === 'archive' || dialog.kind === 'restore') {
      void run(async () => {
        const r = await setTrademarksPublished(dialog.ids, dialog.kind === 'restore')
        return t(dialog.kind === 'archive' ? 'admin.data.trademarks.archived' : 'admin.data.trademarks.restored', { count: r.affected })
      })
    } else if (dialog.kind === 'deleteImage') {
      void run(async () => {
        const r = await deleteImages([dialog.id], token ?? '')
        return t('admin.data.images.deleted', { count: r.deleted, queued: r.storage_queued })
      })
    }
  }

  return (
    <div className="mt-5">
      <form
        className="card p-4"
        onSubmit={(e) => { e.preventDefault(); update({ q: form.query.trim() || null, gazette: form.gazette.trim() || null }) }}
      >
        <Toolbar>
          <label className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input value={form.query} onChange={(e) => setForm({ ...form, query: e.target.value })} className="field ps-9" placeholder={t('admin.data.trademarks.searchPlaceholder')} />
          </label>
          <input value={form.gazette} onChange={(e) => setForm({ ...form, gazette: e.target.value })} className="field w-36" placeholder={t('fields.gazetteNumber')} dir="ltr" />
          <select className="field w-40" value={params.status} onChange={(e) => update({ status: e.target.value === 'all' ? null : e.target.value })}>
            <option value="all">{t('admin.data.filters.allStatuses')}</option>
            <option value="published">{t('admin.data.status.published')}</option>
            <option value="archived">{t('admin.data.status.archived')}</option>
          </select>
          <select className="field w-40" value={params.images} onChange={(e) => update({ images: e.target.value === 'all' ? null : e.target.value })}>
            <option value="all">{t('admin.data.filters.anyImages')}</option>
            <option value="with">{t('admin.data.filters.withImages')}</option>
            <option value="without">{t('admin.data.filters.withoutImages')}</option>
          </select>
          <select className="field w-40" value={params.sort} onChange={(e) => update({ sort: e.target.value === 'updated' ? null : e.target.value })}>
            <option value="updated">{t('admin.data.sort.updated')}</option>
            <option value="created">{t('admin.data.sort.created')}</option>
            <option value="serial">{t('admin.data.sort.serial')}</option>
            <option value="mark">{t('admin.data.sort.mark')}</option>
          </select>
          <button type="submit" className="btn-primary">{t('nav.search')}</button>
          <button type="button" className="btn-ghost h-10 px-3" onClick={() => void list.refetch()} aria-label={t('admin.import.refresh')}><RefreshCw className={cn('h-4 w-4', list.isFetching && 'animate-spin')} /></button>
        </Toolbar>
        {params.jobId && (
          <p className="mt-2 text-[13px] text-ink-600">
            {t('admin.data.trademarks.filteredByJob')} <Mono>{shortId(params.jobId)}</Mono>
            <button type="button" className="link-green ms-2" onClick={() => update({ job: null })}>{t('admin.data.clearFilter')}</button>
          </p>
        )}
      </form>

      {flash && <Notice tone="ok" className="mt-3 flex items-start justify-between gap-3"><span>{flash}</span><button type="button" onClick={() => setFlash(null)} aria-label={t('common.close')}><X className="h-4 w-4" /></button></Notice>}

      {sel.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-[13px]">
          <span className="font-semibold text-brand-800">{t('admin.data.selected', { count: sel.size })}</span>
          <button type="button" className="btn-secondary h-8 px-3 text-[12px]" onClick={() => setDialog({ kind: 'archive', ids: selectedItems.map((i) => i.id), serials: selectedItems.map((i) => i.serial_number) })}><Archive className="h-3.5 w-3.5" /> {t('admin.data.actions.archive')}</button>
          <button type="button" className="btn-secondary h-8 px-3 text-[12px]" onClick={() => setDialog({ kind: 'restore', ids: selectedItems.map((i) => i.id), serials: selectedItems.map((i) => i.serial_number) })}><ArchiveRestore className="h-3.5 w-3.5" /> {t('admin.data.actions.restore')}</button>
          <button type="button" className="btn-secondary h-8 border-red-200 px-3 text-[12px] text-red-700 hover:bg-red-50" onClick={() => setDialog({ kind: 'delete', ids: selectedItems.map((i) => i.id), serials: selectedItems.map((i) => i.serial_number), images: selectedItems.reduce((n, i) => n + i.image_count, 0) })}><Trash2 className="h-3.5 w-3.5" /> {t('admin.data.actions.deletePermanently')}</button>
          <button type="button" className="btn-ghost h-8 px-2 text-[12px]" onClick={sel.clear}>{t('admin.data.clearSelection')}</button>
        </div>
      )}

      <div className={cn('mt-3 grid gap-4', openId && 'xl:grid-cols-[minmax(0,1fr)_420px]')}>
        <section className="card overflow-hidden">
          {list.isError && <ErrorState className="m-4" error={list.error} onRetry={() => void list.refetch()} />}
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-ink-200 bg-ink-50 text-[12px] text-ink-600">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
                  <th className="w-8"><input type="checkbox" aria-label={t('admin.data.selectAll')} checked={items.length > 0 && items.every((i) => sel.has(i.id))} onChange={(e) => sel.setMany(items.map((i) => i.id), e.target.checked)} /></th>
                  <th>{t('fields.serial')}</th>
                  <th>{t('fields.markName')}</th>
                  <th>{t('fields.applicant')}</th>
                  <th>{t('fields.gazetteNumber')}</th>
                  <th>{t('fields.class')}</th>
                  <th>{t('fields.applicationType')}</th>
                  <th className="text-center">{t('admin.images')}</th>
                  <th>{t('admin.status')}</th>
                  <th>{t('admin.data.updated')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {items.map((r) => (
                  <tr key={r.id} className={cn('cursor-pointer hover:bg-ink-50', openId === r.id && 'bg-brand-50/60')} onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={r.serial_number} checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} /></td>
                    <td className="px-3 py-2"><Mono className="font-semibold text-ink-900">{r.serial_number}</Mono></td>
                    <td className="max-w-[220px] truncate px-3 py-2 font-medium text-ink-900">{r.mark_name ?? t('common.notAvailable')}</td>
                    <td className="max-w-[200px] truncate px-3 py-2 text-ink-700">{r.applicant_name ?? t('common.notAvailable')}</td>
                    <td className="px-3 py-2"><Mono>{r.official_gazette_number}</Mono></td>
                    <td className="px-3 py-2 text-ink-700">{r.trademark_class ?? '—'}</td>
                    <td className="px-3 py-2 text-ink-700">{r.application_type ?? '—'}</td>
                    <td className="px-3 py-2 text-center">{r.image_count > 0 ? formatNumber(r.image_count, lng) : <span className="text-ink-400">0</span>}</td>
                    <td className="px-3 py-2">{r.is_published ? <Pill tone="ok">{t('admin.data.status.published')}</Pill> : <Pill tone="warn">{t('admin.data.status.archived')}</Pill>}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-500">{formatDateTime(r.updated_at, lng)}</td>
                  </tr>
                ))}
                {!list.isLoading && items.length === 0 && <tr><td colSpan={10} className="px-4 py-10 text-center text-ink-500">{t('admin.data.noResults')}</td></tr>}
                {list.isLoading && <tr><td colSpan={10} className="px-4 py-10 text-center text-ink-500"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
              </tbody>
            </table>
          </div>
          <Pager className="border-t border-ink-200 px-4 py-2" total={total} offset={params.offset ?? 0} limit={LIMIT} onChange={(o) => update({ offset: o ? String(o) : null })} />
        </section>

        {openId && (
          <TrademarkDetailPanel
            id={openId}
            onClose={() => setOpenId(null)}
            onArchive={(row) => setDialog({ kind: row.is_published ? 'archive' : 'restore', ids: [row.id], serials: [row.serial_number] })}
            onDelete={(row, images) => setDialog({ kind: 'delete', ids: [row.id], serials: [row.serial_number], images })}
            onDeleteImage={(img) => setDialog({ kind: 'deleteImage', id: img.id, path: img.storage_path, serial: img.serial })}
          />
        )}
      </div>

      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        title={t('admin.data.trademarks.deleteTitle', { count: dialog?.kind === 'delete' ? dialog.ids.length : 0 })}
        description={<p>{t('admin.data.trademarks.deleteText', { count: dialog?.kind === 'delete' ? dialog.ids.length : 0 })}</p>}
        items={dialog?.kind === 'delete' ? dialog.serials : []}
        itemsLabel={t('admin.data.audit.serials')}
        dependents={dialog?.kind === 'delete' ? t('admin.data.trademarks.deleteDependents', { images: dialog.images }) : undefined}
        reversibility="irreversible"
        requireToken
        confirmLabel={t('admin.data.actions.deletePermanently')}
        busy={busy}
        error={dialogError}
        onConfirm={onConfirm}
        onClose={() => { if (!busy) { setDialog(null); setDialogError(null) } }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'archive' || dialog?.kind === 'restore'}
        title={dialog?.kind === 'restore' ? t('admin.data.trademarks.restoreTitle', { count: dialog.ids.length }) : t('admin.data.trademarks.archiveTitle', { count: dialog?.kind === 'archive' ? dialog.ids.length : 0 })}
        description={<p>{dialog?.kind === 'restore' ? t('admin.data.trademarks.restoreText') : t('admin.data.trademarks.archiveText')}</p>}
        items={dialog && dialog.kind !== 'delete' && dialog.kind !== 'deleteImage' ? dialog.serials : []}
        itemsLabel={t('admin.data.audit.serials')}
        reversibility="reversible"
        confirmLabel={dialog?.kind === 'restore' ? t('admin.data.actions.restore') : t('admin.data.actions.archive')}
        tone="primary"
        busy={busy}
        error={dialogError}
        onConfirm={onConfirm}
        onClose={() => { if (!busy) { setDialog(null); setDialogError(null) } }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'deleteImage'}
        title={t('admin.data.images.deleteTitle', { count: 1 })}
        description={<p>{t('admin.data.images.deleteText', { count: 1 })}</p>}
        items={dialog?.kind === 'deleteImage' ? [`${dialog.serial} — ${dialog.path}`] : []}
        itemsLabel={t('admin.import.storagePath')}
        dependents={t('admin.data.images.deleteDependents')}
        reversibility="irreversible"
        requireToken
        confirmLabel={t('admin.data.actions.deletePermanently')}
        busy={busy}
        error={dialogError}
        onConfirm={onConfirm}
        onClose={() => { if (!busy) { setDialog(null); setDialogError(null) } }}
      />
    </div>
  )
}

function TrademarkDetailPanel({ id, onClose, onArchive, onDelete, onDeleteImage }: {
  id: string
  onClose: () => void
  onArchive: (row: AdminTrademarkListItem | { id: string; serial_number: string; is_published: boolean }) => void
  onDelete: (row: { id: string; serial_number: string }, images: number) => void
  onDeleteImage: (img: { id: string; storage_path: string; serial: string }) => void
}) {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const q = useQuery({ queryKey: ['admin', 'trademark', id], queryFn: () => getAdminTrademark(id), staleTime: 10_000 })
  const d = q.data
  const na = t('common.notAvailable')
  const v = (x: string | number | null | undefined) => (x === null || x === undefined || x === '' ? na : String(x))
  return (
    <aside className="card h-fit overflow-hidden xl:sticky xl:top-20">
      <div className="flex items-center justify-between border-b border-ink-200 px-4 py-3">
        <h2 className="text-[15px] font-semibold text-ink-900">{t('admin.data.trademarks.detail')}</h2>
        <button type="button" className="btn-ghost h-8 w-8 p-0" onClick={onClose} aria-label={t('common.close')}><X className="h-4 w-4" /></button>
      </div>
      {q.isLoading && <div className="p-4 text-ink-500"><Loader2 className="h-5 w-5 animate-spin" /></div>}
      {q.isError && <ErrorState className="m-4" error={q.error} onRetry={() => void q.refetch()} />}
      {q.isSuccess && !d && <p className="p-4 text-[13px] text-ink-500">{t('admin.data.trademarks.gone')}</p>}
      {d && (
        <div className="max-h-[calc(100vh-10rem)] space-y-4 overflow-y-auto p-4 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <Mono className="text-[14px] font-bold text-ink-900">{d.trademark.serial_number}</Mono>
            {d.trademark.is_published ? <Pill tone="ok">{t('admin.data.status.published')}</Pill> : <Pill tone="warn">{t('admin.data.status.archived')}</Pill>}
            <Pill tone="muted">{d.trademark.review_status}</Pill>
            <Link to={trademarkPath(d.trademark.serial_number, d.trademark.official_gazette_number)} target="_blank" className="link-green ms-auto inline-flex items-center gap-1">{t('admin.data.trademarks.openPublic')} <ExternalLink className="h-3 w-3" /></Link>
          </div>
          <p className="text-[16px] font-semibold text-ink-900">{d.trademark.mark_name ?? na}</p>

          <KeyValue items={[
            [t('fields.recordNumber'), v(d.trademark.record_number)],
            [t('fields.gazetteNumber'), <Mono key="g">{d.trademark.official_gazette_number}</Mono>],
            [t('fields.applicant'), v(d.trademark.applicant_name)],
            [t('fields.address'), v(d.trademark.applicant_address)],
            [t('fields.class'), v(d.trademark.trademark_class)],
            [t('fields.goods'), <span key="goods" className="line-clamp-4">{v(d.trademark.goods_and_services)}</span>],
            [t('fields.applicationType'), v(d.trademark.application_type)],
            [t('fields.publicationDate'), formatDate(d.trademark.publication_date, lng)],
            [t('fields.objectionDeadline'), formatDate(d.trademark.objection_deadline, lng)],
            [t('fields.registrationNumber'), v(d.trademark.registration_number)],
            [t('fields.applicationNumber'), v(d.trademark.application_number)],
            [t('fields.markPrint'), v(d.trademark.mark_print)],
            [t('fields.newOwner'), v(d.trademark.new_owner)],
            [t('fields.oldOwner'), v(d.trademark.old_owner)],
            [t('fields.newAddress'), v(d.trademark.new_address)],
            [t('fields.oldAddress'), v(d.trademark.old_address)],
            [t('fields.page'), v(d.trademark.source_page)],
          ]} />

          <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3">
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-amber-800">{t('admin.data.trademarks.internal')}</p>
            <KeyValue items={[
              [t('admin.import.columns.attorney_or_representative'), v(d.trademark.attorney_or_representative)],
              [t('admin.import.columns.review_note'), v(d.trademark.review_note)],
              [t('admin.data.trademarks.reviewComment'), v(d.trademark.review_comment)],
              [t('admin.data.trademarks.sourceFile'), d.trademark.source_file ? <Mono key="sf">{d.trademark.source_file}{d.trademark.source_sheet ? ` / ${d.trademark.source_sheet}` : ''}{d.trademark.source_row ? ` / ${t('admin.import.columns.source_row')} ${d.trademark.source_row}` : ''}</Mono> : na],
              [t('admin.data.provenance.createdBy'), d.created_job ? <JobRef key="cj" job={d.created_job} lng={lng} /> : d.trademark.created_by_job_id ? <Mono key="cj2">{shortId(d.trademark.created_by_job_id)} ({t('admin.data.provenance.jobDeleted')})</Mono> : t('admin.data.provenance.unknown')],
              [t('admin.data.provenance.lastImport'), d.last_job ? <JobRef key="lj" job={d.last_job} lng={lng} /> : d.trademark.import_job_id ? <Mono key="lj2">{shortId(d.trademark.import_job_id)}</Mono> : '—'],
              [t('admin.data.created'), formatDateTime(d.trademark.created_at, lng)],
              [t('admin.data.updated'), formatDateTime(d.trademark.updated_at, lng)],
              ['ID', <Mono key="id">{d.trademark.id}</Mono>],
            ]} />
          </div>

          <div>
            <p className="mb-2 font-semibold text-ink-900">{t('admin.data.trademarks.linkedImages', { count: d.images.length })}</p>
            {d.images.length === 0 && <p className="text-ink-500">{t('admin.data.trademarks.noImages')}</p>}
            <ul className="space-y-2">
              {d.images.map((img) => (
                <li key={img.id} className="flex items-center gap-3 rounded-md border border-ink-200 p-2">
                  <TrademarkImage bucket={img.storage_bucket} path={img.storage_path} thumbnailPath={img.thumbnail_path} alt={img.storage_path} className="h-14 w-14 shrink-0 rounded" plain />
                  <div className="min-w-0 flex-1">
                    <Mono className="block truncate text-ink-900">{img.storage_path}</Mono>
                    <p className="text-[12px] text-ink-500">{img.image_type} · {img.status} · {formatBytes(img.byte_size)}{img.width && img.height ? ` · ${img.width}×${img.height}` : ''}</p>
                  </div>
                  <button type="button" className="btn-ghost h-8 w-8 p-0 text-red-600" title={t('admin.data.actions.deleteImage')} aria-label={t('admin.data.actions.deleteImage')} onClick={() => onDeleteImage({ id: img.id, storage_path: img.storage_path, serial: d.trademark.serial_number })}><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
            {d.feature_count > 0 && <p className="mt-1 text-[12px] text-ink-500">{t('admin.data.trademarks.features', { count: d.feature_count })}</p>}
          </div>

          <div>
            <p className="mb-2 font-semibold text-ink-900">{t('admin.data.trademarks.history')}</p>
            {d.audit.length === 0 && d.admin_actions.length === 0 && <p className="text-ink-500">{t('admin.data.trademarks.noHistory')}</p>}
            <ul className="space-y-1 text-[12px]">
              {d.admin_actions.map((a) => (
                <li key={`a${a.id}`} className="flex gap-2"><span className="whitespace-nowrap text-ink-500">{formatDateTime(a.created_at, lng)}</span><span className="font-semibold text-ink-800">{a.action}</span><span className="text-ink-500">{a.actor_email ?? shortId(a.actor_id)}</span></li>
              ))}
              {d.audit.map((a) => (
                <li key={`l${a.id}`} className="flex gap-2"><span className="whitespace-nowrap text-ink-500">{formatDateTime(a.created_at, lng)}</span><span className="text-ink-800">{a.action}</span><span className="truncate text-ink-500" dir="ltr">{Array.isArray(a.changed_fields) ? a.changed_fields.join(', ') : ''}</span></li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-ink-200 pt-3">
            <button type="button" className="btn-secondary h-9 px-3 text-[12px]" onClick={() => onArchive({ id: d.trademark.id, serial_number: d.trademark.serial_number, is_published: d.trademark.is_published })}>
              {d.trademark.is_published ? <><Archive className="h-3.5 w-3.5" /> {t('admin.data.actions.archive')}</> : <><ArchiveRestore className="h-3.5 w-3.5" /> {t('admin.data.actions.restore')}</>}
            </button>
            <button type="button" className="btn-secondary h-9 border-red-200 px-3 text-[12px] text-red-700 hover:bg-red-50" onClick={() => onDelete({ id: d.trademark.id, serial_number: d.trademark.serial_number }, d.images.length)}><Trash2 className="h-3.5 w-3.5" /> {t('admin.data.actions.deletePermanently')}</button>
          </div>
        </div>
      )}
    </aside>
  )
}

function JobRef({ job, lng }: { job: { id: string; filename: string | null; created_at: string; job_type: string }; lng: string | undefined }) {
  return (
    <Link to={`/admin/history?job=${job.id}`} className="link-green">
      {job.filename ?? job.job_type} · {formatDateTime(job.created_at, lng)}
    </Link>
  )
}
