import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Ban, Download, FileSpreadsheet, Image as ImageIcon, Loader2, RefreshCw, Trash2, X } from 'lucide-react'
import { cn, formatDateTime, formatNumber } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { downloadText, toCsv } from '@/lib/import/spreadsheet'
import { ErrorState } from '@/components/AsyncState'
import { StatusPill } from './ImportCenterPage'
import { ConfirmDialog, DataManagementGate, KeyValue, Mono, Notice, PageHeader, Pager, Pill, StickyDetailCell, Toolbar, shortId, useScrollerWidth } from '@/components/admin/AdminUi'
import {
  type AdminImportJob, type BatchDeletePreview, cancelImportJob, cleanupAfterAction, deleteImportJob, deleteImportJobRecords, getImportJobDetail, listAdminImportJobs, listImportJobRecords,
  previewDeleteImportJobRecords, purgeImportJobs, storageRemovalNote,
} from '@/services/admin_data_service'

const LIMIT = 30

type Dialog =
  | { kind: 'cancel'; job: AdminImportJob }
  | { kind: 'deleteJob'; job: AdminImportJob }
  | { kind: 'deleteRecords'; job: AdminImportJob; preview: BatchDeletePreview | null; includeModified: boolean }
  | { kind: 'purge'; days: number; preview: { jobs: number; items?: number } | null }
  | null

export function AdminImportHistoryPage() {
  const { t } = useTranslation()
  useDocumentTitle(`${t('admin.nav.history')} · ${t('app.shortName')}`)
  return (
    <div>
      <PageHeader title={t('admin.nav.history')} subtitle={t('admin.data.history.subtitle')} />
      <DataManagementGate>
        <History />
      </DataManagementGate>
    </div>
  )
}

function History() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const qc = useQueryClient()
  const [sp, setSp] = useSearchParams()
  const params = useMemo(() => ({
    type: (sp.get('type') as 'all' | 'excel' | 'images') ?? 'all',
    status: sp.get('status') ?? 'all',
    limit: LIMIT,
    offset: Number(sp.get('offset') ?? 0) || 0,
  }), [sp])
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp)
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    if (!('offset' in patch)) next.delete('offset')
    setSp(next, { replace: true })
  }
  const list = useQuery({ queryKey: ['admin', 'history', params], queryFn: () => listAdminImportJobs(params), placeholderData: (prev) => prev, staleTime: 10_000, refetchInterval: 15_000 })
  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const openId = sp.get('job')
  const [dialog, setDialog] = useState<Dialog>(null)
  // The job table is wider than most viewports; the expanded detail row sticks to the
  // visible area instead of scrolling away with the columns.
  const scrollerRef = useScrollerWidth()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [purgeDays, setPurgeDays] = useState(90)

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin'] })
    void qc.invalidateQueries({ queryKey: ['trademarks'] })
    void qc.invalidateQueries({ queryKey: ['stats'] })
  }
  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setErr(null)
    try {
      const msg = await fn()
      setDialog(null); setFlash(msg); invalidate()
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }
  const openDeleteRecords = async (job: AdminImportJob, includeModified = false) => {
    setDialog({ kind: 'deleteRecords', job, preview: null, includeModified })
    try {
      const preview = await previewDeleteImportJobRecords(job.id, includeModified)
      setDialog((d) => (d?.kind === 'deleteRecords' && d.job.id === job.id ? { ...d, preview, includeModified } : d))
    } catch (e) {
      setErr(e)
    }
  }
  const openPurge = async () => {
    setDialog({ kind: 'purge', days: purgeDays, preview: null })
    try {
      const preview = await purgeImportJobs(purgeDays, null)
      setDialog((d) => (d?.kind === 'purge' ? { ...d, preview: { jobs: preview.jobs, items: preview.items } } : d))
    } catch (e) {
      setErr(e)
    }
  }
  const onConfirm = (token: string | null) => {
    if (!dialog) return
    if (dialog.kind === 'cancel') void run(async () => { await cancelImportJob(dialog.job.id); return t('admin.data.history.cancelled') })
    if (dialog.kind === 'deleteJob') void run(async () => { const r = await deleteImportJob(dialog.job.id, token ?? ''); return t('admin.data.history.jobDeleted', { items: r.items_deleted }) })
    if (dialog.kind === 'deleteRecords') void run(async () => {
      const r = await deleteImportJobRecords(dialog.job.id, token ?? '', dialog.includeModified)
      const cleaned = await cleanupAfterAction(r.action_id)
      return t('admin.data.history.recordsDeleted', { trademarks: r.trademarks, images: r.images, queued: r.storage_queued, skipped: r.modified_skipped }) + storageRemovalNote(t, r.storage_queued, cleaned)
    })
    if (dialog.kind === 'purge') void run(async () => { const r = await purgeImportJobs(dialog.days, token ?? ''); return t('admin.data.history.purged', { count: r.jobs }) })
  }

  return (
    <div className="mt-5">
      <div className="card p-4">
        <Toolbar>
          <select className="field w-44" value={params.type} onChange={(e) => update({ type: e.target.value === 'all' ? null : e.target.value })}>
            <option value="all">{t('admin.data.filters.allTypes')}</option>
            <option value="excel">{t('admin.import.typeData')}</option>
            <option value="images">{t('admin.import.typeImages')}</option>
          </select>
          <select className="field w-52" value={params.status} onChange={(e) => update({ status: e.target.value === 'all' ? null : e.target.value })}>
            <option value="all">{t('admin.data.filters.allStatuses')}</option>
            <option value="running">{t('admin.data.history.running')}</option>
            <option value="completed">{t('admin.import.status.completed')}</option>
            <option value="completed_with_warnings">{t('admin.import.status.completed_with_warnings')}</option>
            <option value="failed">{t('admin.import.status.failed')}</option>
          </select>
          <button type="button" className="btn-ghost h-10 px-3" onClick={() => void list.refetch()} aria-label={t('admin.import.refresh')}><RefreshCw className={cn('h-4 w-4', list.isFetching && 'animate-spin')} /></button>
          <div className="ms-auto flex items-center gap-2 text-[13px] text-ink-600">
            <span>{t('admin.data.history.retention')}</span>
            <input type="number" min={7} max={3650} value={purgeDays} onChange={(e) => setPurgeDays(Math.max(7, Number(e.target.value) || 7))} className="field h-9 w-20" dir="ltr" />
            <span>{t('admin.data.history.days')}</span>
            <button type="button" className="btn-secondary h-9 px-3 text-[12px]" onClick={() => void openPurge()}>{t('admin.data.history.purgeButton')}</button>
          </div>
        </Toolbar>
      </div>

      {flash && <Notice tone="ok" className="mt-3 flex items-start justify-between gap-3"><span>{flash}</span><button type="button" onClick={() => setFlash(null)} aria-label={t('common.close')}><X className="h-4 w-4" /></button></Notice>}

      <section className="card mt-3 overflow-hidden">
        {list.isError && <ErrorState className="m-4" error={list.error} onRetry={() => void list.refetch()} />}
        <div ref={scrollerRef} className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-ink-200 bg-ink-50 text-[12px] text-ink-600">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
                <th>{t('admin.date')}</th>
                <th>{t('admin.import.type')}</th>
                <th>{t('admin.fileName')}</th>
                <th>{t('admin.status')}</th>
                <th className="text-end">{t('admin.total')}</th>
                <th className="text-end">{t('admin.inserted')}</th>
                <th className="text-end">{t('admin.updated')}</th>
                <th className="text-end">{t('admin.import.unchanged')}</th>
                <th className="text-end">{t('admin.import.failed')}</th>
                <th className="text-end" title={t('admin.data.history.createdHint')}>{t('admin.data.history.createdNow')}</th>
                <th>{t('admin.data.history.jobId')}</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {items.map((j) => {
                const running = j.status === 'queued' || j.status === 'processing'
                const open = openId === j.id
                return (
                  <JobRows key={j.id} job={j} open={open} lng={lng} running={running}
                    onToggle={() => update({ job: open ? null : j.id })}
                    onCancel={() => setDialog({ kind: 'cancel', job: j })}
                    onDeleteRecords={() => void openDeleteRecords(j)}
                    onDeleteJob={() => setDialog({ kind: 'deleteJob', job: j })}
                  />
                )
              })}
              {!list.isLoading && items.length === 0 && <tr><td colSpan={12} className="px-4 py-10 text-center text-ink-500">{t('admin.noImports')}</td></tr>}
              {list.isLoading && <tr><td colSpan={12} className="px-4 py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-ink-400" /></td></tr>}
            </tbody>
          </table>
        </div>
        <Pager className="border-t border-ink-200 px-4 py-2" total={total} offset={params.offset} limit={LIMIT} onChange={(o) => update({ offset: o ? String(o) : null })} />
      </section>

      <Notice tone="info" className="mt-4">
        <ul className="list-disc space-y-0.5 ps-5">
          <li>{t('admin.data.history.note1')}</li>
          <li>{t('admin.data.history.note2')}</li>
          <li>{t('admin.data.history.note3')}</li>
        </ul>
      </Notice>

      <ConfirmDialog
        open={dialog?.kind === 'cancel'}
        title={t('admin.data.history.cancelTitle')}
        description={<p>{t('admin.data.history.cancelText')}</p>}
        items={dialog?.kind === 'cancel' ? [`${dialog.job.filename ?? dialog.job.job_type} (${shortId(dialog.job.id)})`] : []}
        reversibility="irreversible"
        confirmLabel={t('admin.data.history.cancelButton')}
        busy={busy} error={err} onConfirm={onConfirm}
        onClose={() => { if (!busy) { setDialog(null); setErr(null) } }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'deleteJob'}
        title={t('admin.data.history.deleteJobTitle')}
        description={<p>{t('admin.data.history.deleteJobText')}</p>}
        items={dialog?.kind === 'deleteJob' ? [`${dialog.job.filename ?? dialog.job.job_type} (${shortId(dialog.job.id)})`] : []}
        dependents={dialog?.kind === 'deleteJob' ? t('admin.data.history.deleteJobDependents', { created: dialog.job.created_trademarks + dialog.job.created_images, items: dialog.job.failed_items }) : undefined}
        reversibility="irreversible"
        requireToken
        confirmLabel={t('admin.data.history.deleteJobButton')}
        busy={busy} error={err} onConfirm={onConfirm}
        onClose={() => { if (!busy) { setDialog(null); setErr(null) } }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'deleteRecords'}
        title={t('admin.data.history.deleteRecordsTitle')}
        description={dialog?.kind === 'deleteRecords' ? (
          <div className="space-y-2">
            <p>{t('admin.data.history.deleteRecordsText', { file: dialog.job.filename ?? shortId(dialog.job.id) })}</p>
            {!dialog.preview && !err && <p className="flex items-center gap-2 text-ink-500"><Loader2 className="h-4 w-4 animate-spin" /> {t('admin.data.history.previewLoading')}</p>}
            {dialog.preview && (
              <>
                {!dialog.preview.has_provenance && <Notice tone="warn">{t('admin.data.history.noProvenance')}</Notice>}
                <KeyValue items={[
                  [t('admin.data.history.previewTrademarks'), formatNumber(dialog.preview.trademarks, lng)],
                  [t('admin.data.history.previewImages'), formatNumber(dialog.preview.images, lng)],
                  [t('admin.data.history.previewStorage'), formatNumber(dialog.preview.storage_objects, lng)],
                  [t('admin.data.history.previewModified'), formatNumber(dialog.preview.trademarks_modified_later, lng)],
                  [t('admin.data.history.previewUpdatedOnly'), formatNumber(dialog.preview.updated_only, lng)],
                ]} />
                {dialog.preview.trademarks_modified_later > 0 && (
                  <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
                    <input type="checkbox" className="mt-0.5" checked={dialog.includeModified} onChange={(e) => void openDeleteRecords(dialog.job, e.target.checked)} />
                    <span>{t('admin.data.history.includeModified', { count: dialog.preview.trademarks_modified_later })}</span>
                  </label>
                )}
              </>
            )}
          </div>
        ) : null}
        items={dialog?.kind === 'deleteRecords' && dialog.preview ? dialog.preview.serials : []}
        itemsLabel={t('admin.data.audit.serials')}
        reversibility="irreversible"
        requireToken
        confirmLabel={t('admin.data.history.deleteRecordsButton')}
        busy={busy || (dialog?.kind === 'deleteRecords' && !dialog.preview)} error={err} onConfirm={onConfirm}
        onClose={() => { if (!busy) { setDialog(null); setErr(null) } }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'purge'}
        title={t('admin.data.history.purgeTitle', { days: dialog?.kind === 'purge' ? dialog.days : purgeDays })}
        description={dialog?.kind === 'purge' ? (
          <div className="space-y-2">
            <p>{t('admin.data.history.purgeText')}</p>
            {dialog.preview ? <p className="font-semibold">{t('admin.data.history.purgePreview', { jobs: dialog.preview.jobs, items: dialog.preview.items ?? 0 })}</p> : !err && <p className="flex items-center gap-2 text-ink-500"><Loader2 className="h-4 w-4 animate-spin" /> {t('admin.data.history.previewLoading')}</p>}
          </div>
        ) : null}
        reversibility="irreversible"
        requireToken
        confirmLabel={t('admin.data.history.purgeButton')}
        busy={busy || (dialog?.kind === 'purge' && !dialog.preview)} error={err} onConfirm={onConfirm}
        onClose={() => { if (!busy) { setDialog(null); setErr(null) } }}
      />
    </div>
  )
}

function JobRows({ job: j, open, lng, running, onToggle, onCancel, onDeleteRecords, onDeleteJob }: {
  job: AdminImportJob; open: boolean; lng: string | undefined; running: boolean
  onToggle: () => void; onCancel: () => void; onDeleteRecords: () => void; onDeleteJob: () => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <tr className={cn('hover:bg-ink-50', open && 'bg-brand-50/60')}>
        <td className="whitespace-nowrap px-3 py-2 text-ink-700">{formatDateTime(j.created_at, lng)}</td>
        <td className="px-3 py-2 text-ink-700"><span className="inline-flex items-center gap-1.5">{j.job_type === 'excel' ? <FileSpreadsheet className="h-4 w-4 text-brand-600" /> : <ImageIcon className="h-4 w-4 text-blue-600" />}{j.job_type === 'excel' ? t('admin.import.typeData') : t('admin.import.typeImages')}</span></td>
        <td className="max-w-[240px] truncate px-3 py-2 font-medium text-ink-900" title={j.filename ?? ''}><Mono className="text-[13px]">{j.filename ?? '—'}</Mono></td>
        <td className="px-3 py-2"><StatusPill status={j.status} /></td>
        <td className="px-3 py-2 text-end">{formatNumber(j.total_rows, lng)}</td>
        <td className="px-3 py-2 text-end">{formatNumber(j.inserted_rows, lng)}</td>
        <td className="px-3 py-2 text-end">{formatNumber(j.updated_rows, lng)}</td>
        <td className="px-3 py-2 text-end">{formatNumber(j.skipped_rows, lng)}</td>
        <td className={cn('px-3 py-2 text-end', j.failed_rows > 0 && 'font-semibold text-red-700')}>{formatNumber(j.failed_rows, lng)}</td>
        <td className="px-3 py-2 text-end">{formatNumber(j.job_type === 'excel' ? j.created_trademarks : j.created_images, lng)}</td>
        <td className="px-3 py-2"><Mono className="text-ink-500">{shortId(j.id)}</Mono></td>
        <td className="whitespace-nowrap px-3 py-2 text-end"><button type="button" className="link-green" onClick={onToggle}>{open ? t('admin.import.hideReport') : t('admin.data.history.details')}</button></td>
      </tr>
      {open && (
        <tr>
          <StickyDetailCell colSpan={12} className="bg-ink-50/70">
            <JobDetail job={j} lng={lng} running={running} onCancel={onCancel} onDeleteRecords={onDeleteRecords} onDeleteJob={onDeleteJob} />
          </StickyDetailCell>
        </tr>
      )}
    </>
  )
}

function JobDetail({ job: j, lng, running, onCancel, onDeleteRecords, onDeleteJob }: {
  job: AdminImportJob; lng: string | undefined; running: boolean
  onCancel: () => void; onDeleteRecords: () => void; onDeleteJob: () => void
}) {
  const { t } = useTranslation()
  const detail = useQuery({ queryKey: ['admin', 'job_detail', j.id], queryFn: () => getImportJobDetail(j.id), staleTime: 10_000 })
  const [kind, setKind] = useState<'created' | 'updated' | 'images'>(j.job_type === 'images' ? 'images' : 'created')
  const [offset, setOffset] = useState(0)
  const records = useQuery({ queryKey: ['admin', 'job_records', j.id, kind, offset], queryFn: () => listImportJobRecords(j.id, kind, 50, offset), placeholderData: (prev) => prev, staleTime: 10_000 })
  const d = detail.data
  const c = d?.counts
  const rows = records.data?.items ?? []
  return (
    <div className="space-y-4 text-[13px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <KeyValue items={[
          [t('admin.data.history.jobId'), <Mono key="id">{j.id}</Mono>],
          [t('admin.data.history.started'), formatDateTime(j.started_at, lng)],
          [t('admin.data.history.completed'), formatDateTime(j.completed_at, lng)],
          [t('admin.data.history.createdBy'), <Mono key="cb">{j.created_by ?? '—'}</Mono>],
          [t('fields.gazetteNumber'), j.gazette_number ?? '—'],
        ]} />
        <div className="flex flex-wrap gap-2">
          <Link to={j.job_type === 'excel' ? `/admin/trademarks?job=${j.id}` : `/admin/images?job=${j.id}`} className="btn-secondary h-9 px-3 text-[12px]">{t('admin.data.history.viewRecords')}</Link>
          {running && <button type="button" className="btn-secondary h-9 border-amber-300 px-3 text-[12px] text-amber-800 hover:bg-amber-50" onClick={onCancel}><Ban className="h-3.5 w-3.5" /> {t('admin.data.history.cancelButton')}</button>}
          {!running && <button type="button" className="btn-secondary h-9 border-red-200 px-3 text-[12px] text-red-700 hover:bg-red-50" onClick={onDeleteRecords}><Trash2 className="h-3.5 w-3.5" /> {t('admin.data.history.deleteRecordsButton')}</button>}
          {!running && <button type="button" className="btn-secondary h-9 px-3 text-[12px]" onClick={onDeleteJob}><Trash2 className="h-3.5 w-3.5" /> {t('admin.data.history.deleteJobButton')}</button>}
        </div>
      </div>
      {j.error_message && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800" dir="ltr">{j.error_message}</p>}
      {detail.isError && <ErrorState error={detail.error} />}
      {c && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <Count label={t('admin.data.history.createdNow')} value={formatNumber(c.created_trademarks, lng)} hint={t('admin.data.history.createdHint')} />
          <Count label={t('admin.data.history.updatedByBatch')} value={formatNumber(c.updated_trademarks, lng)} />
          <Count label={t('admin.data.history.touched')} value={formatNumber(c.touched_trademarks, lng)} />
          <Count label={t('admin.data.history.createdImages')} value={formatNumber(c.created_images, lng)} />
          <Count label={t('admin.import.failed')} value={formatNumber(c.items_failed, lng)} tone={c.items_failed > 0 ? 'error' : undefined} />
          <Count label={t('admin.import.unmatched')} value={formatNumber(c.items_unmatched, lng)} tone={c.items_unmatched > 0 ? 'warn' : undefined} />
          <Count label={t('admin.data.history.provenance')} value={c.has_row_provenance ? t('admin.data.yes') : t('admin.data.partial')} hint={c.has_row_provenance ? undefined : t('admin.data.history.provenanceHint')} />
        </div>
      )}

      {d && d.problems.length > 0 && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="font-semibold text-ink-800">{t('admin.import.itemReport', { count: d.problems.length })}</span>
            <button type="button" className="btn-secondary h-8 px-3 text-[12px]" onClick={() => downloadText(`import-${j.id.slice(0, 8)}-report.csv`, toCsv(['item', 'status', 'message'], d.problems.map((p) => [p.item_ref, p.status, p.message])))}><Download className="h-3.5 w-3.5" /> {t('admin.import.downloadReport')}</button>
          </div>
          <div className="max-h-56 overflow-auto rounded-md border border-ink-200 bg-white">
            <table className="w-full text-[12px]">
              <tbody className="divide-y divide-ink-100">
                {d.problems.slice(0, 200).map((p) => (
                  <tr key={p.id}><td className="px-3 py-1.5"><Mono>{p.item_ref}</Mono></td><td className="px-3 py-1.5"><Pill tone={p.status === 'failed' ? 'error' : p.status === 'skipped' ? 'muted' : 'warn'}>{p.status}</Pill></td><td className="px-3 py-1.5 text-ink-700">{p.message}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink-800">{t('admin.data.history.recordsOfBatch')}</span>
          <div className="inline-flex overflow-hidden rounded-md border border-ink-200 bg-white text-[12px]">
            {(j.job_type === 'images' ? (['images'] as const) : (['created', 'updated'] as const)).map((k) => (
              <button key={k} type="button" className={cn('px-3 py-1.5', kind === k ? 'bg-brand-600 text-white' : 'text-ink-700 hover:bg-ink-100')} onClick={() => { setKind(k); setOffset(0) }}>{t(`admin.data.history.kind.${k}`)}</button>
            ))}
          </div>
          <span className="text-ink-500">{formatNumber(records.data?.total ?? 0, lng)}</span>
        </div>
        {records.isError && <ErrorState error={records.error} />}
        <div className="max-h-72 overflow-auto rounded-md border border-ink-200 bg-white">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-ink-50 text-ink-600"><tr className="[&>th]:px-3 [&>th]:py-1.5 [&>th]:text-start [&>th]:font-medium"><th>{t('fields.serial')}</th><th>{kind === 'images' ? t('admin.import.storagePath') : t('fields.markName')}</th><th>{t('fields.gazetteNumber')}</th><th>{t('admin.status')}</th><th>{t('admin.data.updated')}</th><th>{t('admin.data.history.modifiedLater')}</th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-1.5"><Mono className="font-semibold">{r.serial_number ?? '—'}</Mono></td>
                  <td className="max-w-[260px] truncate px-3 py-1.5">{kind === 'images' ? <Mono>{r.storage_path}</Mono> : r.mark_name}</td>
                  <td className="px-3 py-1.5"><Mono>{r.official_gazette_number ?? '—'}</Mono></td>
                  <td className="px-3 py-1.5">{kind === 'images' ? <Pill tone={r.image_status === 'matched' ? 'ok' : 'warn'}>{r.image_status}</Pill> : r.is_published ? <Pill tone="ok">{t('admin.data.status.published')}</Pill> : <Pill tone="warn">{t('admin.data.status.archived')}</Pill>}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-ink-500">{formatDateTime(r.updated_at, lng)}</td>
                  <td className="px-3 py-1.5">{r.modified_later ? <Pill tone="warn">{t('admin.data.yes')}{r.modified_by_job ? ` · ${shortId(r.modified_by_job)}` : ''}</Pill> : <span className="text-ink-400">{t('admin.data.no')}</span>}</td>
                </tr>
              ))}
              {!records.isLoading && rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-500">{t('admin.data.history.noRecords')}</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager className="mt-1" total={records.data?.total ?? 0} offset={offset} limit={50} onChange={setOffset} />
      </div>

      {d && d.admin_actions.length > 0 && (
        <div>
          <p className="mb-1 font-semibold text-ink-800">{t('admin.data.history.actionsOnBatch')}</p>
          <ul className="space-y-0.5 text-[12px]">
            {d.admin_actions.map((a) => <li key={a.id} className="flex gap-2"><span className="whitespace-nowrap text-ink-500">{formatDateTime(a.created_at, lng)}</span><span className="font-semibold">{a.action}</span><span className="text-ink-500">{a.actor_email ?? shortId(a.actor_id)}</span><span className="text-ink-500">{formatNumber(a.affected_count, lng)}</span><Pill tone={a.status === 'success' ? 'ok' : a.status === 'partial' ? 'warn' : 'error'}>{a.status}</Pill></li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

function Count({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'error' | 'warn' }) {
  return (
    <div className="rounded-md border border-ink-200 bg-white px-3 py-2" title={hint}>
      <p className="text-[11px] text-ink-500">{label}</p>
      <p className={cn('text-[16px] font-bold text-ink-900', tone === 'error' && 'text-red-700', tone === 'warn' && 'text-amber-700')}>{value}</p>
    </div>
  )
}
