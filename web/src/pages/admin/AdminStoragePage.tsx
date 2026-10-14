import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Download, HardDrive, Loader2, Play, RefreshCw, ScanSearch, Trash2, X } from 'lucide-react'
import { cn, formatDateTime, formatNumber } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { downloadText, toCsv } from '@/lib/import/spreadsheet'
import { ErrorState } from '@/components/AsyncState'
import { ConfirmDialog, DataManagementGate, Mono, Notice, PageHeader, Pill, formatBytes, useSelection } from '@/components/admin/AdminUi'
import {
  type CleanupRunResult, type StorageObjectInfo, deleteOrphanedObjects, findUnreferencedPaths, listImageStoragePaths, listStorageCleanup, listStorageObjects, publicImageUrl, runStorageCleanup,
} from '@/services/admin_data_service'

/** Orphaned Files — Storage ⇄ database consistency: cleanup queue, orphaned objects, broken references. */
export function AdminStoragePage() {
  const { t } = useTranslation()
  useDocumentTitle(`${t('admin.nav.orphans')} · ${t('app.shortName')}`)
  return (
    <div>
      <PageHeader title={t('admin.nav.orphans')} subtitle={t('admin.data.storage.subtitle')} />
      <DataManagementGate>
        <CleanupQueue />
        <OrphanScan />
      </DataManagementGate>
    </div>
  )
}

function CleanupQueue() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const qc = useQueryClient()
  const [status, setStatus] = useState<'pending' | 'failed' | 'done' | 'skipped' | 'all'>('pending')
  const q = useQuery({ queryKey: ['admin', 'cleanup', status], queryFn: () => listStorageCleanup(status, 500), staleTime: 10_000 })
  const pendingQ = useQuery({ queryKey: ['admin', 'cleanup', 'pending+failed'], queryFn: async () => [...(await listStorageCleanup('pending', 500)), ...(await listStorageCleanup('failed', 500))], staleTime: 10_000 })
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<CleanupRunResult | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const rows = q.data ?? []
  const runnable = pendingQ.data ?? []
  const run = async () => {
    setRunning(true); setErr(null); setResult(null)
    try {
      const r = await runStorageCleanup(runnable)
      setResult(r)
      void qc.invalidateQueries({ queryKey: ['admin'] })
    } catch (e) {
      setErr(e)
    } finally {
      setRunning(false)
    }
  }
  return (
    <section className="card mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-[16px] font-semibold text-ink-900">{t('admin.data.storage.queueTitle')}</h2>
          <p className="muted mt-0.5">{t('admin.data.storage.queueHint')}</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="field h-9 w-36" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="pending">{t('admin.data.cleanupStatus.pending')}</option>
            <option value="failed">{t('admin.data.cleanupStatus.failed')}</option>
            <option value="done">{t('admin.data.cleanupStatus.done')}</option>
            <option value="skipped">{t('admin.data.cleanupStatus.skipped')}</option>
            <option value="all">{t('admin.data.filters.allStatuses')}</option>
          </select>
          <button type="button" className="btn-ghost h-9 px-2" onClick={() => { void q.refetch(); void pendingQ.refetch() }} aria-label={t('admin.import.refresh')}><RefreshCw className={cn('h-4 w-4', q.isFetching && 'animate-spin')} /></button>
          <button type="button" className="btn-primary h-9 px-3 text-[12px]" disabled={running || runnable.length === 0} onClick={() => void run()}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} {t('admin.data.storage.runCleanup', { count: runnable.length })}
          </button>
        </div>
      </div>
      {err != null && <ErrorState className="mx-5 mb-3" error={err} />}
      {result && (
        <Notice tone={result.failed ? 'warn' : 'ok'} className="mx-5 mb-3" title={t('admin.data.storage.cleanupResult', { done: result.done, failed: result.failed, skipped: result.skipped })}>
          {result.skipped > 0 && <p className="text-[12px]">{t('admin.data.storage.cleanupSkippedHint')}</p>}
          {result.errors.slice(0, 5).map((e) => <p key={e.path} dir="ltr" className="font-mono text-[12px]">{e.path}: {e.message}</p>)}
        </Notice>
      )}
      {q.isError && <ErrorState className="mx-5 mb-3" error={q.error} />}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="border-y border-ink-200 bg-ink-50 text-[12px] text-ink-600">
            <tr className="[&>th]:px-5 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
              <th>{t('admin.import.storagePath')}</th><th>{t('admin.data.storage.reason')}</th><th>{t('admin.status')}</th><th>{t('admin.data.storage.attempts')}</th><th>{t('admin.data.storage.lastError')}</th><th>{t('admin.data.updated')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-5 py-2"><Mono>{r.path}</Mono></td>
                <td className="px-5 py-2 text-ink-700">{r.reason ?? '—'}</td>
                <td className="px-5 py-2"><Pill tone={r.status === 'done' ? 'ok' : r.status === 'failed' ? 'error' : r.status === 'pending' ? 'info' : 'muted'}>{t(`admin.data.cleanupStatus.${r.status}`)}</Pill></td>
                <td className="px-5 py-2">{formatNumber(r.attempts, lng)}</td>
                <td className={cn('max-w-[280px] truncate px-5 py-2', r.status === 'failed' ? 'text-red-700' : 'text-ink-500')} title={r.last_error ?? ''} dir="ltr">{r.last_error ?? ''}</td>
                <td className="whitespace-nowrap px-5 py-2 text-ink-500">{formatDateTime(r.updated_at, lng)}</td>
              </tr>
            ))}
            {!q.isLoading && rows.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-ink-500">{t('admin.data.storage.queueEmpty')}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

interface ScanResult {
  scannedAt: string
  objects: number
  truncated: boolean
  refsTruncated: boolean
  bytes: number
  orphans: (StorageObjectInfo & { queued: boolean })[]
  missing: { image_id: string; path: string; kind: 'image' | 'thumbnail' }[]
}

function OrphanScan() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const qc = useQueryClient()
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const sel = useSelection<string>()
  const [dialog, setDialog] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialogErr, setDialogErr] = useState<unknown>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const doScan = async () => {
    setErr(null); setScan(null); sel.clear(); setProgress(t('admin.data.storage.listing', { count: 0 }))
    try {
      const listing = await listStorageObjects({ onProgress: (n) => setProgress(t('admin.data.storage.listing', { count: n })) })
      setProgress(t('admin.data.storage.comparing'))
      const paths = listing.objects.map((o) => o.path)
      const unref = await findUnreferencedPaths(paths)
      const unrefMap = new Map(unref.map((u) => [u.path, u.queued]))
      const refs = await listImageStoragePaths()
      const present = new Set(paths)
      const missing = refs.refs.filter((r) => !present.has(r.path))
      setScan({
        scannedAt: new Date().toISOString(),
        objects: listing.objects.length,
        truncated: listing.truncated,
        refsTruncated: refs.truncated,
        bytes: listing.objects.reduce((n, o) => n + (o.size ?? 0), 0),
        orphans: listing.objects.filter((o) => unrefMap.has(o.path)).map((o) => ({ ...o, queued: unrefMap.get(o.path) ?? false })),
        missing: listing.truncated ? [] : missing,
      })
    } catch (e) {
      setErr(e)
    } finally {
      setProgress(null)
    }
  }
  const confirmDelete = async () => {
    if (!dialog) return
    setBusy(true); setDialogErr(null)
    try {
      const r = await deleteOrphanedObjects(dialog)
      setDialog(null); sel.clear()
      setFlash(t('admin.data.storage.orphansDeleted', { deleted: r.deleted.length, skipped: r.skipped.length, failed: r.failed.length }))
      setScan((s) => s ? { ...s, orphans: s.orphans.filter((o) => !r.deleted.includes(o.path)) } : s)
      void qc.invalidateQueries({ queryKey: ['admin'] })
    } catch (e) {
      setDialogErr(e)
    } finally {
      setBusy(false)
    }
  }
  const orphans = scan?.orphans ?? []
  const deletable = orphans.filter((o) => !o.queued)
  return (
    <section className="card mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-[16px] font-semibold text-ink-900">{t('admin.data.storage.scanTitle')}</h2>
          <p className="muted mt-0.5">{t('admin.data.storage.scanHint')}</p>
        </div>
        <button type="button" className="btn-primary h-9 px-3 text-[12px]" disabled={!!progress} onClick={() => void doScan()}>
          {progress ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />} {t('admin.data.storage.scanButton')}
        </button>
      </div>
      {progress && <p className="px-5 pb-3 text-[13px] text-ink-600">{progress}</p>}
      {err != null && <ErrorState className="mx-5 mb-3" error={err} />}
      {flash && <Notice tone="ok" className="mx-5 mb-3 flex items-start justify-between gap-3"><span>{flash}</span><button type="button" onClick={() => setFlash(null)} aria-label={t('common.close')}><X className="h-4 w-4" /></button></Notice>}
      {scan && (
        <div className="space-y-4 px-5 pb-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Card icon={HardDrive} label={t('admin.data.storage.objects')} value={formatNumber(scan.objects, lng)} hint={formatBytes(scan.bytes)} />
            <Card icon={Trash2} label={t('admin.data.storage.orphans')} value={formatNumber(orphans.length, lng)} tone={orphans.length ? 'warn' : undefined} />
            <Card icon={ScanSearch} label={t('admin.data.storage.missing')} value={formatNumber(scan.missing.length, lng)} tone={scan.missing.length ? 'error' : undefined} />
            <Card icon={RefreshCw} label={t('admin.data.storage.scannedAt')} value={formatDateTime(scan.scannedAt, lng)} />
          </div>
          {(scan.truncated || scan.refsTruncated) && <Notice tone="warn">{t('admin.data.storage.truncated')}</Notice>}

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-ink-900">{t('admin.data.storage.orphansTitle', { count: orphans.length })}</h3>
              <div className="flex items-center gap-2">
                <button type="button" className="btn-secondary h-8 px-3 text-[12px]" disabled={orphans.length === 0} onClick={() => downloadText('orphaned-files.csv', toCsv(['path', 'size', 'updated_at', 'queued'], orphans.map((o) => [o.path, o.size, o.updated_at, o.queued ? 'yes' : 'no'])))}><Download className="h-3.5 w-3.5" /> CSV</button>
                <button type="button" className="btn-secondary h-8 border-red-200 px-3 text-[12px] text-red-700 hover:bg-red-50" disabled={sel.size === 0} onClick={() => setDialog([...sel.selected])}><Trash2 className="h-3.5 w-3.5" /> {t('admin.data.storage.deleteSelected', { count: sel.size })}</button>
              </div>
            </div>
            <p className="mb-2 text-[12px] text-ink-500">{t('admin.data.storage.orphansHint')}</p>
            <div className="max-h-80 overflow-auto rounded-md border border-ink-200">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-ink-50 text-ink-600">
                  <tr className="[&>th]:px-3 [&>th]:py-1.5 [&>th]:text-start [&>th]:font-medium">
                    <th className="w-8"><input type="checkbox" checked={deletable.length > 0 && deletable.every((o) => sel.has(o.path))} onChange={(e) => sel.setMany(deletable.map((o) => o.path), e.target.checked)} aria-label={t('admin.data.selectAll')} /></th>
                    <th>{t('admin.import.storagePath')}</th><th>{t('admin.data.storage.size')}</th><th>{t('admin.data.updated')}</th><th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {orphans.map((o) => (
                    <tr key={o.path}>
                      <td className="px-3 py-1.5">{!o.queued && <input type="checkbox" checked={sel.has(o.path)} onChange={() => sel.toggle(o.path)} aria-label={o.path} />}</td>
                      <td className="px-3 py-1.5"><a href={publicImageUrl(o.path)} target="_blank" rel="noreferrer" className="link-green"><Mono>{o.path}</Mono></a>{o.queued && <Pill tone="info" className="ms-2">{t('admin.data.storage.queued')}</Pill>}</td>
                      <td className="px-3 py-1.5 text-ink-700">{formatBytes(o.size)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-ink-500">{formatDateTime(o.updated_at, lng)}</td>
                      <td />
                    </tr>
                  ))}
                  {orphans.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-500">{t('admin.data.storage.noOrphans')}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="mb-1 font-semibold text-ink-900">{t('admin.data.storage.missingTitle', { count: scan.missing.length })}</h3>
            <p className="mb-2 text-[12px] text-ink-500">{t('admin.data.storage.missingHint')}</p>
            {scan.missing.length > 0 && (
              <div className="max-h-60 overflow-auto rounded-md border border-ink-200">
                <table className="w-full text-[12px]">
                  <tbody className="divide-y divide-ink-100">
                    {scan.missing.slice(0, 500).map((m) => (
                      <tr key={`${m.image_id}-${m.kind}`}>
                        <td className="px-3 py-1.5"><Mono>{m.path}</Mono></td>
                        <td className="px-3 py-1.5 text-ink-500">{m.kind}</td>
                        <td className="px-3 py-1.5 text-end"><Link to={`/admin/images?q=${encodeURIComponent(m.image_id)}`} className="link-green">{t('admin.data.images.openRow')}</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!dialog}
        title={t('admin.data.storage.deleteTitle', { count: dialog?.length ?? 0 })}
        description={<p>{t('admin.data.storage.deleteText')}</p>}
        items={dialog ?? []}
        itemsLabel={t('admin.import.storagePath')}
        reversibility="irreversible"
        requireToken
        confirmLabel={t('admin.data.actions.deletePermanently')}
        busy={busy}
        error={dialogErr}
        onConfirm={() => void confirmDelete()}
        onClose={() => { if (!busy) { setDialog(null); setDialogErr(null) } }}
      />
    </section>
  )
}

function Card({ icon: Icon, label, value, hint, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; hint?: string; tone?: 'warn' | 'error' }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-ink-200 bg-white px-3 py-2">
      <Icon className={cn('h-5 w-5 text-ink-400', tone === 'warn' && 'text-amber-600', tone === 'error' && 'text-red-600')} />
      <div className="min-w-0">
        <p className="text-[11px] text-ink-500">{label}</p>
        <p className="truncate text-[15px] font-bold text-ink-900">{value}</p>
        {hint && <p className="text-[11px] text-ink-500">{hint}</p>}
      </div>
    </div>
  )
}
