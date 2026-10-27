import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Download, Loader2, RefreshCw, ScanText, Square } from 'lucide-react'
import { DataError, MigrationMissingError, analysisIndexStatusQuery } from '@/services'
import { OCR_DOWNLOAD_MB, OCR_MODEL_VERSION, OcrUnavailableError, defaultConcurrency, getOcrEngineState, ocrSupport, shutdownOcr, subscribeOcrEngine } from '@/lib/imageSearch/ocr'
import { runIndexBatch, type IndexProgress, type IndexRunReport } from '@/lib/imageSearch/indexer'
import { cn, formatDate, formatNumber } from '@/lib/utils'
import { downloadText, toCsv } from '@/lib/import/spreadsheet'

/**
 * Admin — text index of the trademark images (migrations 1200 + 1300).
 *
 * Runs ENTIRELY IN THIS BROWSER: images are downloaded from public Storage,
 * their words recognised with Tesseract.js (Latin + Persian/Pashto) and the
 * result stored through `admin_upsert_image_analysis` with the administrator's
 * own session — the database enforces the admin check. No server, no paid
 * service. Batches are resumable and idempotent; failed images can be retried;
 * symbol-only images are recorded as "skipped" and can be re-analysed later.
 * Nothing here touches trademark or image rows or Storage objects.
 *
 * The same index can be filled offline with tools/image_index (native
 * Tesseract on a PC / Codespace) — both write the same rows.
 */

type RunState =
  | { phase: 'idle' }
  | { phase: 'running'; kind: 'pending' | 'failed' | 'skipped'; progress: IndexProgress }
  | { phase: 'done'; report: IndexRunReport }
  | { phase: 'error'; kind: 'engine' | 'migration' | 'forbidden' | 'unknown'; message: string }

const BATCH_SIZES = [25, 100, 300, 500] as const

export function AnalysisIndexPanel() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const qc = useQueryClient()
  const [run, setRun] = useState<RunState>({ phase: 'idle' })
  const [batch, setBatch] = useState<number>(100)
  const abortRef = useRef<AbortController | null>(null)
  const engine = useSyncExternalStore(subscribeOcrEngine, getOcrEngineState, getOcrEngineState)
  const support = ocrSupport()

  const status = useQuery(analysisIndexStatusQuery())

  // Free the OCR workers when the administrator leaves the page.
  useEffect(() => () => { abortRef.current?.abort(); void shutdownOcr() }, [])

  const start = async (kind: 'pending' | 'failed' | 'skipped') => {
    const ctl = new AbortController()
    abortRef.current = ctl
    setRun({ phase: 'running', kind, progress: { total: 0, done: 0, indexed: 0, skipped: 0, failed: 0, current: null, elapsedMs: 0 } })
    try {
      const report = await runIndexBatch({
        limit: batch,
        retryFailed: kind === 'failed',
        includeSkipped: kind === 'skipped',
        concurrency: defaultConcurrency(),
        budgetMs: 20_000,
        signal: ctl.signal,
        onProgress: (progress) => setRun({ phase: 'running', kind, progress }),
      })
      setRun({ phase: 'done', report })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const kindOf =
        e instanceof OcrUnavailableError ? 'engine'
        : e instanceof MigrationMissingError ? 'migration'
        : e instanceof DataError && (e.code === '42501' || /Administrator role required/i.test(e.message)) ? 'forbidden'
        : 'unknown'
      setRun({ phase: 'error', kind: kindOf, message })
    } finally {
      abortRef.current = null
      void status.refetch()
      void qc.invalidateQueries({ queryKey: ['image-search'] })
    }
  }
  const stop = () => abortRef.current?.abort()

  const downloadFailures = () => {
    const rows = (status.data?.failures ?? []).map((f) => [f.serial_number ?? '', f.storage_path, f.error ?? '', String(f.attempts), f.at])
    downloadText(`tmistan-image-text-failures-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(['serial_number', 'storage_path', 'error', 'attempts', 'at'], rows))
  }

  const s = status.data
  const busy = run.phase === 'running'
  const err = status.error instanceof DataError ? status.error : null
  const forbidden = !!err && (err.code === '42501' || /Administrator role required/i.test(err.message))
  const migrationMissing = err instanceof MigrationMissingError || err?.code === 'schema_missing' || (!!s && !s.supportsSkipped)
  const analysed = s ? s.indexed + s.skipped : 0
  const pct = s && s.matched_images > 0 ? Math.round((analysed / s.matched_images) * 100) : 0

  return (
    <section className="card p-5 md:p-6" aria-labelledby="analysis-index-title" data-testid="analysis-index-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="analysis-index-title" className="flex items-center gap-2 text-[18px] font-semibold text-ink-900">
            <ScanText className="h-5 w-5 text-brand-600" aria-hidden /> {t('admin.analysis.title')}
          </h2>
          <p className="muted mt-1 max-w-2xl">{t('admin.analysis.subtitle')}</p>
        </div>
        <button type="button" onClick={() => void status.refetch()} disabled={status.isFetching} className="btn-secondary h-9 px-3 text-[13px]">
          <RefreshCw className={cn('h-4 w-4', status.isFetching && 'animate-spin')} aria-hidden /> {t('admin.index.refresh')}
        </button>
      </div>

      {status.isPending ? (
        <p className="mt-4 flex items-center gap-2 text-[14px] text-ink-700"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('admin.analysis.loadingStatus')}</p>
      ) : forbidden ? (
        <Notice tone="warn" title={t('admin.analysis.forbiddenTitle')} text={t('admin.analysis.forbiddenText')} />
      ) : migrationMissing ? (
        <Notice tone="warn" title={t('admin.analysis.migrationMissingTitle')} text={t('admin.analysis.migrationMissingText')} detail={err?.message} />
      ) : status.isError ? (
        <Notice tone="error" title={t('admin.analysis.statusFailed')} detail={status.error instanceof Error ? status.error.message : String(status.error)} />
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label={t('admin.index.matchedImages')} value={s ? formatNumber(s.matched_images, lng) : '…'} />
            <Stat label={t('admin.analysis.indexed')} value={s ? formatNumber(s.with_text, lng) : '…'} tone={s && s.pending === 0 && s.with_text > 0 ? 'ok' : 'muted'} />
            <Stat label={t('admin.analysis.skipped')} value={s ? formatNumber(s.skipped, lng) : '…'} />
            <Stat label={t('admin.analysis.pending')} value={s ? formatNumber(s.pending, lng) : '…'} tone={s && s.pending > 0 ? 'warn' : 'muted'} />
            <Stat label={t('admin.analysis.failed')} value={s ? formatNumber(s.failed, lng) : '…'} tone={s && s.failed > 0 ? 'warn' : 'muted'} />
          </dl>
          {s && s.matched_images > 0 && (
            <div className="mt-3" data-testid="analysis-coverage">
              <div className="flex items-center justify-between text-[12px] text-ink-600">
                <span>{t('admin.analysis.coverage', { analysed: formatNumber(analysed, lng), total: formatNumber(s.matched_images, lng), percent: formatNumber(pct, lng) })}</span>
                <span dir="ltr">{OCR_MODEL_VERSION}</span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
          <p className="muted mt-2">
            {s?.last_indexed_at ? t('admin.analysis.lastIndexed', { date: formatDate(s.last_indexed_at, lng) }) : t('admin.analysis.neverIndexed')}
            {s && s.other_versions > 0 && <> · {t('admin.analysis.otherVersions', { count: s.other_versions })}</>}
          </p>

          {support === 'unsupported' ? (
            <Notice tone="warn" title={t('admin.analysis.unsupportedTitle')} text={t('admin.analysis.unsupportedText')} />
          ) : (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-[13px] text-ink-700">
                  {t('admin.analysis.batchSize')}
                  <select value={batch} onChange={(e) => setBatch(Number(e.target.value))} disabled={busy} className="sfield-control h-9 w-24 text-[13px]" dir="ltr">
                    {BATCH_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <button type="button" onClick={() => void start('pending')} disabled={busy || !s || s.pending === 0} className="btn-primary h-10 px-5 text-[14px] disabled:cursor-not-allowed disabled:opacity-50" data-testid="analysis-run">
                  {busy && run.kind === 'pending' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ScanText className="h-4 w-4" aria-hidden />}
                  {s && s.pending > 0 ? t('admin.analysis.run', { count: Math.min(batch, s.pending) }) : t('admin.index.upToDate')}
                </button>
                <button type="button" onClick={() => void start('failed')} disabled={busy || !s || s.failed === 0} className="btn-secondary h-10 px-4 text-[14px] disabled:cursor-not-allowed disabled:opacity-50" data-testid="analysis-retry">
                  {busy && run.kind === 'failed' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
                  {t('admin.analysis.retryFailed', { count: s?.failed ?? 0 })}
                </button>
                <button type="button" onClick={() => void start('skipped')} disabled={busy || !s || s.skipped === 0} className="btn-secondary h-10 px-4 text-[14px] disabled:cursor-not-allowed disabled:opacity-50" data-testid="analysis-rerun-skipped">
                  {busy && run.kind === 'skipped' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
                  {t('admin.analysis.rerunSkipped', { count: s?.skipped ?? 0 })}
                </button>
                {busy && (
                  <button type="button" onClick={stop} className="btn-secondary h-10 px-4 text-[14px]" data-testid="analysis-stop">
                    <Square className="h-4 w-4" aria-hidden /> {t('admin.analysis.stop')}
                  </button>
                )}
              </div>
              <p className="muted mt-2">{t('admin.analysis.hint', { mb: OCR_DOWNLOAD_MB })}</p>
              <p className="muted mt-1">{t('admin.analysis.offlineHint')}</p>
            </>
          )}

          {run.phase === 'running' && (
            <div className="mt-3 rounded-lg border border-ink-200 bg-white p-4 text-[14px] text-ink-700" role="status" aria-live="polite" data-testid="analysis-progress">
              <p className="flex items-center gap-2 font-medium">
                <Loader2 className="h-4 w-4 animate-spin text-brand-600" aria-hidden />
                {engine.status === 'loading'
                  ? t('admin.analysis.engineLoading', { mb: OCR_DOWNLOAD_MB, percent: formatNumber(Math.round(engine.progress * 100), lng) })
                  : run.progress.total === 0
                    ? t('admin.analysis.listing')
                    : t('admin.analysis.progress', { done: formatNumber(run.progress.done, lng), total: formatNumber(run.progress.total, lng) })}
              </p>
              {run.progress.total > 0 && (
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-100" aria-hidden>
                  <div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${Math.round((run.progress.done / run.progress.total) * 100)}%` }} />
                </div>
              )}
              <p className="mt-2 text-[13px] text-ink-600">
                {t('admin.analysis.progressDetail', {
                  indexed: formatNumber(run.progress.indexed, lng),
                  skipped: formatNumber(run.progress.skipped, lng),
                  failed: formatNumber(run.progress.failed, lng),
                  seconds: formatNumber(Math.round(run.progress.elapsedMs / 1000), lng),
                })}
                {run.progress.current && <> · <span dir="ltr">{run.progress.current}</span></>}
                {run.progress.done > 2 && run.progress.total > run.progress.done && (
                  <> · {t('admin.analysis.eta', { minutes: formatNumber(Math.max(1, Math.round(((run.progress.elapsedMs / run.progress.done) * (run.progress.total - run.progress.done)) / 60_000)), lng) })}</>
                )}
              </p>
              <p className="mt-2 text-[13px] text-amber-900">{t('admin.analysis.keepOpen')}</p>
            </div>
          )}
          {run.phase === 'error' && (
            <Notice
              tone="error"
              title={
                run.kind === 'engine' ? t('admin.analysis.engineFailedTitle')
                : run.kind === 'migration' ? t('admin.analysis.migrationMissingTitle')
                : run.kind === 'forbidden' ? t('admin.analysis.forbiddenTitle')
                : t('admin.analysis.runFailed')
              }
              text={run.kind === 'engine' ? t('admin.analysis.engineFailedText') : undefined}
              detail={run.message}
            />
          )}
          {run.phase === 'done' && (
            <div className={cn('mt-3 rounded-lg border p-4 text-[14px]', run.report.failed > 0 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-brand-200 bg-brand-50 text-brand-800')} role="status" data-testid="analysis-report">
              <p className="flex items-center gap-2 font-medium">
                {run.report.failed > 0 ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
                {t(run.report.stopped ? 'admin.analysis.stoppedText' : 'admin.analysis.doneText', {
                  indexed: formatNumber(run.report.indexed, lng),
                  skipped: formatNumber(run.report.skipped, lng),
                  failed: formatNumber(run.report.failed, lng),
                  attempted: formatNumber(run.report.done, lng),
                  seconds: formatNumber(Math.round(run.report.elapsedMs / 1000), lng),
                })}
              </p>
              {run.report.failures.length > 0 && (
                <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-[13px]">
                  {run.report.failures.slice(0, 20).map((f) => (
                    <li key={f.image_id} dir="ltr"><span className="font-medium">{f.serial_number ?? f.image_id.slice(0, 8)}</span> — {f.reason}</li>
                  ))}
                  {run.report.failures.length > 20 && <li>…</li>}
                </ul>
              )}
            </div>
          )}

          {s && s.failures.length > 0 && (
            <details className="mt-4 rounded-lg border border-ink-200 bg-ink-50/40 p-3">
              <summary className="cursor-pointer text-[13px] font-semibold text-ink-800">{t('admin.analysis.failuresTitle', { count: s.failed })}</summary>
              <ul className="mt-2 max-h-56 space-y-1 overflow-auto text-[13px] text-ink-700">
                {s.failures.map((f) => (
                  <li key={f.image_id} dir="ltr">
                    <span className="font-medium">{f.serial_number ?? f.storage_path}</span> — {f.error ?? '—'} <span className="text-ink-500">({t('admin.analysis.attempts', { count: f.attempts })})</span>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={downloadFailures} className="btn-secondary mt-3 h-8 px-3 text-[13px]"><Download className="h-3.5 w-3.5" aria-hidden /> {t('admin.index.downloadFailures')}</button>
            </details>
          )}
        </>
      )}
    </section>
  )
}

function Notice({ tone, title, text, detail }: { tone: 'warn' | 'error'; title: string; text?: string; detail?: string }) {
  return (
    <div className={cn('mt-4 flex items-start gap-3 rounded-lg border p-4 text-[14px]', tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-800')} role={tone === 'error' ? 'alert' : 'status'}>
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {text && <p className="mt-0.5">{text}</p>}
        {detail && <p className="mt-1 break-words text-[12px] opacity-80" dir="ltr">{detail}</p>}
      </div>
    </div>
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
