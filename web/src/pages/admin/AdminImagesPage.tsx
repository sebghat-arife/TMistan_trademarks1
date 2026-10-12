import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Download, ExternalLink, Loader2, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn, formatDateTime, formatNumber, trademarkPath } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { downloadText, toCsv } from '@/lib/import/spreadsheet'
import type { ImageStatus, ImportJobItemRow } from '@/lib/database.types'
import { ErrorState } from '@/components/AsyncState'
import { TrademarkImage } from '@/components/TrademarkImage'
import { ConfirmDialog, DataManagementGate, Mono, Notice, PageHeader, Pager, Pill, Toolbar, formatBytes, shortId, useSelection } from '@/components/admin/AdminUi'
import { type AdminImageListItem, type ImageListParams, deleteImages, listAdminImages, publicImageUrl } from '@/services/admin_data_service'
import { unwrap } from '@/services/_shared'

const LIMIT = 48

/** Trademark Images (mode "all") and Unmatched Images (mode "unmatched"). */
export function AdminImagesPage({ mode }: { mode: 'all' | 'unmatched' }) {
  const { t } = useTranslation()
  const title = mode === 'unmatched' ? t('admin.nav.unmatched') : t('admin.nav.images')
  useDocumentTitle(`${title} · ${t('app.shortName')}`)
  return (
    <div>
      <PageHeader title={title} subtitle={mode === 'unmatched' ? t('admin.data.images.unmatchedSubtitle') : t('admin.data.images.subtitle')} />
      <DataManagementGate>
        <ImageTable mode={mode} />
        {mode === 'unmatched' && <UnmatchedImportFiles />}
      </DataManagementGate>
    </div>
  )
}

function ImageTable({ mode }: { mode: 'all' | 'unmatched' }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const qc = useQueryClient()
  const [sp, setSp] = useSearchParams()
  const [query, setQuery] = useState(sp.get('q') ?? '')
  const params: ImageListParams = useMemo(() => ({
    query: sp.get('q') ?? '',
    status: (sp.get('status') as ImageListParams['status']) ?? 'all',
    linked: mode === 'unmatched' ? 'unlinked' : ((sp.get('linked') as ImageListParams['linked']) ?? 'all'),
    jobId: sp.get('job'),
    limit: LIMIT,
    offset: Number(sp.get('offset') ?? 0) || 0,
  }), [sp, mode])
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp)
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    if (!('offset' in patch)) next.delete('offset')
    setSp(next, { replace: true })
  }
  const list = useQuery({ queryKey: ['admin', 'images', params], queryFn: () => listAdminImages(params), placeholderData: (prev) => prev, staleTime: 15_000 })
  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const sel = useSelection<string>()
  const [dialog, setDialog] = useState<AdminImageListItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [preview, setPreview] = useState<AdminImageListItem | null>(null)
  useEffect(() => { sel.clear() }, [params]) // eslint-disable-line react-hooks/exhaustive-deps

  const confirmDelete = async (token: string | null) => {
    if (!dialog) return
    setBusy(true); setErr(null)
    try {
      const r = await deleteImages(dialog.map((i) => i.id), token ?? '')
      setDialog(null); sel.clear()
      setFlash(t('admin.data.images.deleted', { count: r.deleted, queued: r.storage_queued }))
      void qc.invalidateQueries({ queryKey: ['admin'] })
      void qc.invalidateQueries({ queryKey: ['trademarks'] })
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }
  const statuses: ImageStatus[] = ['matched', 'unmatched', 'ambiguous', 'needs_review']
  const selected = items.filter((i) => sel.has(i.id))

  return (
    <div className="mt-5">
      <form className="card p-4" onSubmit={(e) => { e.preventDefault(); update({ q: query.trim() || null }) }}>
        <Toolbar>
          <label className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} className="field ps-9" placeholder={t('admin.data.images.searchPlaceholder')} />
          </label>
          <select className="field w-44" value={params.status} onChange={(e) => update({ status: e.target.value === 'all' ? null : e.target.value })}>
            <option value="all">{t('admin.data.filters.allStatuses')}</option>
            {statuses.map((s) => <option key={s} value={s}>{t(`admin.data.imageStatus.${s}`)}</option>)}
          </select>
          {mode === 'all' && (
            <select className="field w-44" value={params.linked} onChange={(e) => update({ linked: e.target.value === 'all' ? null : e.target.value })}>
              <option value="all">{t('admin.data.filters.anyLink')}</option>
              <option value="linked">{t('admin.data.filters.linked')}</option>
              <option value="unlinked">{t('admin.data.filters.unlinked')}</option>
            </select>
          )}
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

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-600">
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={items.length > 0 && items.every((i) => sel.has(i.id))} onChange={(e) => sel.setMany(items.map((i) => i.id), e.target.checked)} /> {t('admin.data.selectAll')} ({formatNumber(total, lng)})</label>
        {sel.size > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5">
            <span className="font-semibold text-brand-800">{t('admin.data.selected', { count: sel.size })}</span>
            <button type="button" className="btn-secondary h-8 border-red-200 px-3 text-[12px] text-red-700 hover:bg-red-50" onClick={() => setDialog(selected)}><Trash2 className="h-3.5 w-3.5" /> {t('admin.data.actions.deletePermanently')}</button>
            <button type="button" className="btn-ghost h-8 px-2 text-[12px]" onClick={sel.clear}>{t('admin.data.clearSelection')}</button>
          </div>
        )}
      </div>

      {list.isError && <ErrorState className="mt-3" error={list.error} onRetry={() => void list.refetch()} />}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        {items.map((img) => (
          <div key={img.id} className={cn('card overflow-hidden', sel.has(img.id) && 'ring-2 ring-brand-500')}>
            <button type="button" className="block w-full" onClick={() => setPreview(img)} aria-label={img.storage_path}>
              <TrademarkImage bucket={img.storage_bucket} path={img.storage_path} thumbnailPath={img.thumbnail_path} alt={img.storage_path} className="aspect-square w-full" />
            </button>
            <div className="space-y-1 p-2 text-[12px]">
              <div className="flex items-center justify-between gap-2">
                <label className="inline-flex min-w-0 items-center gap-1.5">
                  <input type="checkbox" checked={sel.has(img.id)} onChange={() => sel.toggle(img.id)} aria-label={img.storage_path} />
                  <Mono className="truncate font-semibold text-ink-900">{img.tm_serial ?? img.serial_number ?? '—'}</Mono>
                </label>
                <Pill tone={img.status === 'matched' ? 'ok' : img.status === 'ambiguous' ? 'warn' : 'error'}>{t(`admin.data.imageStatus.${img.status}`)}</Pill>
              </div>
              <p className="truncate text-ink-700" title={img.tm_mark_name ?? ''}>{img.tm_mark_name ?? (img.trademark_id ? '' : t('admin.data.images.noTrademark'))}</p>
              <Mono className="block truncate text-ink-500" >{img.storage_path}</Mono>
              <p className="text-ink-500">{formatBytes(img.byte_size)}{img.width && img.height ? ` · ${img.width}×${img.height}` : ''} · {img.image_type}</p>
            </div>
          </div>
        ))}
      </div>
      {!list.isLoading && items.length === 0 && <p className="card mt-3 px-4 py-10 text-center text-[13px] text-ink-500">{t('admin.data.noResults')}</p>}
      {list.isLoading && <p className="mt-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-ink-400" /></p>}
      <Pager className="mt-3" total={total} offset={params.offset ?? 0} limit={LIMIT} onChange={(o) => update({ offset: o ? String(o) : null })} />

      {preview && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-900/60 p-4" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setPreview(null) }}>
          <div role="dialog" aria-modal="true" className="card flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-ink-200 px-4 py-3">
              <Mono className="truncate text-[13px] font-semibold text-ink-900">{preview.storage_path}</Mono>
              <button type="button" className="btn-ghost h-8 w-8 p-0" onClick={() => setPreview(null)} aria-label={t('common.close')}><X className="h-4 w-4" /></button>
            </div>
            <div className="checker flex min-h-[240px] flex-1 items-center justify-center overflow-auto p-4">
              <img src={publicImageUrl(preview.storage_path)} alt={preview.storage_path} className="max-h-[60vh] max-w-full object-contain" />
            </div>
            <div className="grid gap-x-6 gap-y-1 border-t border-ink-200 px-4 py-3 text-[12px] text-ink-700 sm:grid-cols-2">
              <span>{t('fields.serial')}: <Mono>{preview.tm_serial ?? preview.serial_number ?? '—'}</Mono></span>
              <span>{t('admin.status')}: {t(`admin.data.imageStatus.${preview.status}`)} · {preview.match_method ?? '—'}</span>
              <span>{t('fields.markName')}: {preview.tm_mark_name ?? '—'}</span>
              <span>{t('admin.import.file')}: <Mono>{preview.original_filename ?? '—'}</Mono></span>
              <span>{t('admin.data.created')}: {formatDateTime(preview.created_at, lng)}</span>
              <span>{t('admin.data.provenance.createdBy')}: <Mono>{shortId(preview.created_by_job_id)}</Mono></span>
              <span>{t('admin.data.images.hash')}: <Mono>{preview.content_hash ? preview.content_hash.slice(0, 16) : '—'}</Mono></span>
              <span>{t('admin.data.images.indexed')}: {preview.has_features ? t('admin.data.yes') : t('admin.data.no')}</span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-200 bg-ink-50 px-4 py-3">
              {preview.tm_serial && <Link to={trademarkPath(preview.tm_serial, preview.gazette_number)} target="_blank" className="btn-secondary h-9 px-3 text-[12px]">{t('admin.data.trademarks.openPublic')} <ExternalLink className="h-3.5 w-3.5" /></Link>}
              {preview.trademark_id && <Link to={`/admin/trademarks?id=${preview.trademark_id}&q=${encodeURIComponent(preview.tm_serial ?? '')}`} className="btn-secondary h-9 px-3 text-[12px]">{t('admin.data.images.openRecord')}</Link>}
              <button type="button" className="btn-secondary h-9 border-red-200 px-3 text-[12px] text-red-700 hover:bg-red-50" onClick={() => { setDialog([preview]); setPreview(null) }}><Trash2 className="h-3.5 w-3.5" /> {t('admin.data.actions.deletePermanently')}</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!dialog}
        title={t('admin.data.images.deleteTitle', { count: dialog?.length ?? 0 })}
        description={<p>{t('admin.data.images.deleteText', { count: dialog?.length ?? 0 })}</p>}
        items={(dialog ?? []).map((i) => `${i.tm_serial ?? i.serial_number ?? '?'} — ${i.storage_path}`)}
        itemsLabel={t('admin.import.storagePath')}
        dependents={t('admin.data.images.deleteDependents')}
        reversibility="irreversible"
        requireToken
        confirmLabel={t('admin.data.actions.deletePermanently')}
        busy={busy}
        error={err}
        onConfirm={(token) => void confirmDelete(token)}
        onClose={() => { if (!busy) { setDialog(null); setErr(null) } }}
      />
    </div>
  )
}

/** Files that image imports could not match — recorded as import_job_items (the files were never uploaded). */
function UnmatchedImportFiles() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const q = useQuery({
    queryKey: ['admin', 'unmatched_items'],
    queryFn: async () => unwrap(
      await supabase
        .from('import_job_items')
        .select('id, job_id, item_ref, status, message, payload, created_at, import_jobs(filename, created_at)')
        .in('status', ['unmatched', 'ambiguous'])
        .order('id', { ascending: false })
        .limit(500),
    ) as unknown as (ImportJobItemRow & { import_jobs: { filename: string | null; created_at: string } | null })[],
    staleTime: 30_000,
  })
  const rows = q.data ?? []
  return (
    <section className="card mt-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
        <div>
          <h2 className="text-[16px] font-semibold text-ink-900">{t('admin.data.images.unmatchedFilesTitle')}</h2>
          <p className="muted mt-0.5">{t('admin.data.images.unmatchedFilesHint')}</p>
        </div>
        <button
          type="button"
          className="btn-secondary h-9 px-3 text-[12px]"
          disabled={rows.length === 0}
          onClick={() => downloadText('unmatched-images.csv', toCsv(['file', 'status', 'reason', 'import', 'date'], rows.map((r) => [r.item_ref, r.status, r.message, r.import_jobs?.filename ?? r.job_id, r.created_at])))}
        >
          <Download className="h-3.5 w-3.5" /> {t('admin.import.downloadUnmatched')}
        </button>
      </div>
      {q.isError && <ErrorState className="m-4" error={q.error} />}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="border-y border-ink-200 bg-ink-50 text-[12px] text-ink-600">
            <tr className="[&>th]:px-5 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
              <th>{t('admin.import.file')}</th>
              <th>{t('admin.status')}</th>
              <th>{t('admin.import.message')}</th>
              <th>{t('admin.data.history.import')}</th>
              <th>{t('admin.date')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-5 py-2"><Mono>{r.item_ref}</Mono></td>
                <td className="px-5 py-2"><Pill tone={r.status === 'ambiguous' ? 'warn' : 'error'}>{t(`admin.data.imageStatus.${r.status}`)}</Pill></td>
                <td className="max-w-[360px] truncate px-5 py-2 text-ink-700" title={r.message ?? ''}>{r.message ?? '—'}</td>
                <td className="px-5 py-2"><Link to={`/admin/history?job=${r.job_id}`} className="link-green">{r.import_jobs?.filename ?? shortId(r.job_id)}</Link></td>
                <td className="whitespace-nowrap px-5 py-2 text-ink-500">{formatDateTime(r.created_at, lng)}</td>
              </tr>
            ))}
            {!q.isLoading && rows.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-ink-500">{t('admin.data.images.noUnmatchedFiles')}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
