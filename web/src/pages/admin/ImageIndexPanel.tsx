import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Download, Loader2, RefreshCw, ScanSearch, X } from 'lucide-react'
import { DataError, getImageIndexStatus, indexStoredImages, listImagesNeedingIndex, type IndexRunReport } from '@/services'
import { DESCRIPTOR_VERSION } from '@/lib/imageSearch/descriptor'
import { cn, formatDate, formatNumber } from '@/lib/utils'
import { downloadText, toCsv } from '@/lib/import/spreadsheet'

/**
 * Admin — Visual search index.
 *
 * Shows how many matched trademark images have a descriptor for the current
 * algorithm version and lets the administrator (re)build the index from the
 * browser: each image is downloaded from public Storage, described locally
 * and the vectors are stored through `admin_upsert_image_features`.
 * Failures are listed and downloadable as CSV. Nothing here touches
 * `trademarks` or `trademark_images` rows.
 */

type RunState =
  | { phase: 'idle' }
  | { phase: 'listing' }
  | { phase: 'running'; done: number; total: number }
  | { phase: 'done'; report: IndexRunReport }
  | { phase: 'error'; message: string }

export function ImageIndexPanel() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const qc = useQueryClient()
  const [run, setRun] = useState<RunState>({ phase: 'idle' })
  const abortRef = useRef<AbortController | null>(null)

  const status = useQuery({ queryKey: ['admin', 'image_index', DESCRIPTOR_VERSION], queryFn: getImageIndexStatus, staleTime: 30_000, retry: false })
  const notInstalled = status.error instanceof DataError && status.error.code === 'schema_missing'

  const build = async () => {
    const ctl = new AbortController()
    abortRef.current = ctl
    setRun({ phase: 'listing' })
    try {
      // page through everything that still needs a descriptor (stale versions included)
      const todo: { id: string; storage_bucket: string; storage_path: string }[] = []
      for (let offset = 0; ; offset += 500) {
        const page = await listImagesNeedingIndex(500, offset)
        todo.push(...page)
        if (page.length < 500) break
        if (ctl.signal.aborted) break
      }
      if (todo.length === 0) {
        setRun({ phase: 'done', report: { attempted: 0, indexed: 0, failed: 0, failures: [] } })
        return
      }
      setRun({ phase: 'running', done: 0, total: todo.length })
      const report = await indexStoredImages(todo, (done, total) => setRun({ phase: 'running', done, total }), ctl.signal)
      setRun({ phase: 'done', report })
    } catch (e) {
      setRun({ phase: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      abortRef.current = null
      void status.refetch()
      void qc.invalidateQueries({ queryKey: ['image-search'] })
    }
  }

  const downloadFailures = (report: IndexRunReport) => {
    const rows = report.failures.map((f) => [f.storage_path, f.reason])
    downloadText(`tmistan-image-index-failures-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(['storage_path', 'reason'], rows))
  }

  const s = status.data
  const busy = run.phase === 'listing' || run.phase === 'running'

  return (
    <section className="card p-5 md:p-6" aria-labelledby="image-index-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="image-index-title" className="flex items-center gap-2 text-[18px] font-semibold text-ink-900">
            <ScanSearch className="h-5 w-5 text-brand-600" aria-hidden /> {t('admin.index.title')}
          </h2>
          <p className="muted mt-1 max-w-2xl">{t('admin.index.subtitle', { version: DESCRIPTOR_VERSION })}</p>
        </div>
        <button type="button" onClick={() => void status.refetch()} disabled={status.isFetching} className="btn-secondary h-9 px-3 text-[13px]">
          <RefreshCw className={cn('h-4 w-4', status.isFetching && 'animate-spin')} aria-hidden /> {t('admin.index.refresh')}
        </button>
      </div>

      {notInstalled ? (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-[14px] text-amber-900" role="status">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">{t('admin.index.notInstalledTitle')}</p>
            <p className="mt-0.5">{t('admin.index.notInstalledText')}</p>
          </div>
        </div>
      ) : status.isError ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-[14px] text-red-800" role="alert">
          {status.error instanceof Error ? status.error.message : String(status.error)}
        </div>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t('admin.index.matchedImages')} value={s ? formatNumber(s.matched_images, lng) : '…'} />
            <Stat label={t('admin.index.indexed')} value={s ? formatNumber(s.indexed, lng) : '…'} tone={s && s.indexed === s.matched_images && s.matched_images > 0 ? 'ok' : 'muted'} />
            <Stat label={t('admin.index.missing')} value={s ? formatNumber(s.missing, lng) : '…'} tone={s && s.missing > 0 ? 'warn' : 'muted'} />
            <Stat label={t('admin.index.stale')} value={s ? formatNumber(s.stale, lng) : '…'} tone={s && s.stale > 0 ? 'warn' : 'muted'} />
          </dl>
          <p className="muted mt-2">
            {s?.last_computed_at ? t('admin.index.lastComputed', { date: formatDate(s.last_computed_at, lng) }) : t('admin.index.neverComputed')}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void build()} disabled={busy || !s || s.missing === 0} className="btn-primary h-10 px-5 text-[14px] disabled:cursor-not-allowed disabled:opacity-50" data-testid="build-index">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ScanSearch className="h-4 w-4" aria-hidden />}
              {s && s.missing > 0 ? t('admin.index.build', { count: s.missing }) : t('admin.index.upToDate')}
            </button>
            {run.phase === 'running' && (
              <button type="button" onClick={() => abortRef.current?.abort()} className="btn-secondary h-10 px-4 text-[14px]"><X className="h-4 w-4" aria-hidden /> {t('admin.index.cancel')}</button>
            )}
            <span className="muted">{t('admin.index.hint')}</span>
          </div>

          {run.phase === 'listing' && <p className="mt-3 text-[14px] text-ink-700">{t('admin.index.listing')}</p>}
          {run.phase === 'running' && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-[13px] text-ink-700">
                <span>{t('admin.index.progress', { done: formatNumber(run.done, lng), total: formatNumber(run.total, lng) })}</span>
                <span dir="ltr">{Math.round((run.done / Math.max(1, run.total)) * 100)}%</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-100"><div className="h-full bg-brand-600 transition-[width]" style={{ width: `${(run.done / Math.max(1, run.total)) * 100}%` }} /></div>
            </div>
          )}
          {run.phase === 'error' && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-[14px] text-red-800" role="alert">{run.message}</div>
          )}
          {run.phase === 'done' && (
            <div className={cn('mt-3 rounded-lg border p-4 text-[14px]', run.report.failed > 0 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-brand-200 bg-brand-50 text-brand-800')} role="status">
              <p className="flex items-center gap-2 font-medium">
                {run.report.failed > 0 ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
                {t('admin.index.doneText', { indexed: formatNumber(run.report.indexed, lng), failed: formatNumber(run.report.failed, lng), attempted: formatNumber(run.report.attempted, lng) })}
              </p>
              {run.report.failures.length > 0 && (
                <>
                  <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-[13px]">
                    {run.report.failures.slice(0, 20).map((f) => (
                      <li key={f.key} dir="ltr"><span className="font-medium">{f.storage_path}</span> — {f.reason}</li>
                    ))}
                    {run.report.failures.length > 20 && <li>…</li>}
                  </ul>
                  <button type="button" onClick={() => downloadFailures(run.report)} className="btn-secondary mt-3 h-8 px-3 text-[13px]"><Download className="h-3.5 w-3.5" aria-hidden /> {t('admin.index.downloadFailures')}</button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function Stat({ label, value, tone = 'muted' }: { label: string; value: string; tone?: 'ok' | 'warn' | 'muted' }) {
  return (
    <div className={cn('rounded-lg border p-3', tone === 'ok' ? 'border-brand-200 bg-brand-50' : tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-ink-200 bg-ink-50/50')}>
      <dt className="text-[12px] text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-[20px] font-semibold tabular-nums text-ink-900" dir="ltr">{value}</dd>
    </div>
  )
}
