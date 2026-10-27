import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Download, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { VisionError, getAnalysisIndexStatus, runAnalysisIndexBatch, visionConfigured, visionHealthQuery, type AnalysisRunReport } from '@/services'
import { VISION_API_URL } from '@/lib/site'
import { cn, formatDate, formatNumber } from '@/lib/utils'
import { downloadText, toCsv } from '@/lib/import/spreadsheet'

/**
 * Admin — Intelligent image index (migration 1200 + services/vision).
 *
 * The vision service does the work server-side: it lists un-analysed images
 * through `admin_image_analysis_pending`, downloads each from public Storage,
 * runs OCR + the CLIP embedding and stores the result with
 * `admin_upsert_image_analysis` — all with the administrator's own Supabase
 * token, so the database still enforces the admin check. Batches are
 * resumable and idempotent; failed images can be retried; nothing here
 * touches trademark or image rows.
 */

type RunState =
  | { phase: 'idle' }
  | { phase: 'running'; limit: number; retry: boolean }
  | { phase: 'done'; report: AnalysisRunReport }
  | { phase: 'error'; code: VisionError['code'] | 'unknown'; message: string }

const BATCH_SIZES = [25, 100, 300] as const

export function AnalysisIndexPanel() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const qc = useQueryClient()
  const [run, setRun] = useState<RunState>({ phase: 'idle' })
  const [batch, setBatch] = useState<number>(100)

  const health = useQuery({ ...visionHealthQuery(), enabled: visionConfigured, retry: false })
  const status = useQuery({
    queryKey: ['admin', 'image_analysis', VISION_API_URL],
    queryFn: getAnalysisIndexStatus,
    enabled: visionConfigured && health.isSuccess,
    staleTime: 20_000,
    retry: false,
  })

  const start = async (retry: boolean) => {
    setRun({ phase: 'running', limit: batch, retry })
    try {
      const report = await runAnalysisIndexBatch(batch, retry)
      setRun({ phase: 'done', report })
    } catch (e) {
      setRun({ phase: 'error', code: e instanceof VisionError ? e.code : 'unknown', message: e instanceof Error ? e.message : String(e) })
    } finally {
      void status.refetch()
      void qc.invalidateQueries({ queryKey: ['image-search'] })
    }
  }

  const downloadFailures = () => {
    const rows = (status.data?.failures ?? []).map((f) => [f.serial_number ?? '', f.storage_path, f.error ?? '', String(f.attempts), f.at])
    downloadText(`tmistan-image-analysis-failures-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(['serial_number', 'storage_path', 'error', 'attempts', 'at'], rows))
  }

  const s = status.data
  const busy = run.phase === 'running'
  const statusErr = status.error instanceof VisionError ? status.error : null

  return (
    <section className="card p-5 md:p-6" aria-labelledby="analysis-index-title" data-testid="analysis-index-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="analysis-index-title" className="flex items-center gap-2 text-[18px] font-semibold text-ink-900">
            <Sparkles className="h-5 w-5 text-brand-600" aria-hidden /> {t('admin.analysis.title')}
          </h2>
          <p className="muted mt-1 max-w-2xl">{t('admin.analysis.subtitle')}</p>
        </div>
        <button type="button" onClick={() => { void health.refetch(); void status.refetch() }} disabled={status.isFetching || !visionConfigured} className="btn-secondary h-9 px-3 text-[13px]">
          <RefreshCw className={cn('h-4 w-4', status.isFetching && 'animate-spin')} aria-hidden /> {t('admin.index.refresh')}
        </button>
      </div>

      {!visionConfigured ? (
        <Notice tone="warn" title={t('admin.analysis.notConfiguredTitle')} text={t('admin.analysis.notConfiguredText')} />
      ) : health.isPending ? (
        <p className="mt-4 flex items-center gap-2 text-[14px] text-ink-700"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('admin.analysis.checkingService')}</p>
      ) : health.isError || !health.data?.ok ? (
        <Notice tone="error" title={t('admin.analysis.unreachableTitle')} text={t('admin.analysis.unreachableText', { url: VISION_API_URL })} detail={health.error instanceof Error ? health.error.message : undefined} />
      ) : statusErr?.code === 'migration_missing' ? (
        <Notice tone="warn" title={t('admin.analysis.migrationMissingTitle')} text={t('admin.analysis.migrationMissingText')} />
      ) : statusErr?.code === 'unauthorized' || statusErr?.code === 'forbidden' ? (
        <Notice tone="warn" title={t('admin.analysis.forbiddenTitle')} text={t('admin.analysis.forbiddenText')} />
      ) : status.isError ? (
        <Notice tone="error" title={t('admin.analysis.statusFailed')} detail={status.error instanceof Error ? status.error.message : String(status.error)} />
      ) : (
        <>
          <p className="muted mt-3" dir="ltr">
            {t('admin.analysis.service', { ocr: health.data.ocr.engine, languages: health.data.ocr.languages.join(', '), model: health.data.embedding.model })}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label={t('admin.index.matchedImages')} value={s ? formatNumber(s.matched_images, lng) : '…'} />
            <Stat label={t('admin.analysis.indexed')} value={s ? formatNumber(s.indexed, lng) : '…'} tone={s && s.pending === 0 && s.indexed > 0 ? 'ok' : 'muted'} />
            <Stat label={t('admin.analysis.withText')} value={s ? formatNumber(s.with_text, lng) : '…'} />
            <Stat label={t('admin.analysis.pending')} value={s ? formatNumber(s.pending, lng) : '…'} tone={s && s.pending > 0 ? 'warn' : 'muted'} />
            <Stat label={t('admin.analysis.failed')} value={s ? formatNumber(s.failed, lng) : '…'} tone={s && s.failed > 0 ? 'warn' : 'muted'} />
          </dl>
          <p className="muted mt-2">
            {s?.last_indexed_at ? t('admin.analysis.lastIndexed', { date: formatDate(s.last_indexed_at, lng), model: s.model_version }) : t('admin.analysis.neverIndexed')}
            {s && s.other_versions > 0 && <> · {t('admin.analysis.otherVersions', { count: s.other_versions })}</>}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[13px] text-ink-700">
              {t('admin.analysis.batchSize')}
              <select value={batch} onChange={(e) => setBatch(Number(e.target.value))} disabled={busy} className="sfield-control h-9 w-24 text-[13px]" dir="ltr">
                {BATCH_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => void start(false)} disabled={busy || !s || s.pending === 0} className="btn-primary h-10 px-5 text-[14px] disabled:cursor-not-allowed disabled:opacity-50" data-testid="analysis-run">
              {busy && run.phase === 'running' && !run.retry ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
              {s && s.pending > 0 ? t('admin.analysis.run', { count: Math.min(batch, s.pending) }) : t('admin.index.upToDate')}
            </button>
            <button type="button" onClick={() => void start(true)} disabled={busy || !s || s.failed === 0} className="btn-secondary h-10 px-4 text-[14px] disabled:cursor-not-allowed disabled:opacity-50" data-testid="analysis-retry">
              {busy && run.phase === 'running' && run.retry ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
              {t('admin.analysis.retryFailed', { count: s?.failed ?? 0 })}
            </button>
          </div>
          <p className="muted mt-2">{t('admin.analysis.hint')}</p>

          {run.phase === 'running' && (
            <p className="mt-3 flex items-center gap-2 text-[14px] text-ink-700" role="status">
              <Loader2 className="h-4 w-4 animate-spin text-brand-600" aria-hidden /> {t('admin.analysis.running', { count: run.limit })}
            </p>
          )}
          {run.phase === 'error' && (
            <Notice
              tone="error"
              title={run.code === 'busy' ? t('admin.analysis.busy') : run.code === 'migration_missing' ? t('admin.analysis.migrationMissingTitle') : t('admin.analysis.runFailed')}
              detail={run.message}
            />
          )}
          {run.phase === 'done' && (
            <div className={cn('mt-3 rounded-lg border p-4 text-[14px]', run.report.failed > 0 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-brand-200 bg-brand-50 text-brand-800')} role="status" data-testid="analysis-report">
              <p className="flex items-center gap-2 font-medium">
                {run.report.failed > 0 ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
                {t('admin.analysis.doneText', {
                  indexed: formatNumber(run.report.indexed, lng),
                  text: formatNumber(run.report.ocr_with_text, lng),
                  failed: formatNumber(run.report.failed, lng),
                  attempted: formatNumber(run.report.attempted, lng),
                  seconds: formatNumber(Math.round(run.report.duration_ms / 1000), lng),
                })}
              </p>
              {run.report.failures.length > 0 && (
                <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-[13px]">
                  {run.report.failures.slice(0, 20).map((f) => (
                    <li key={f.image_id} dir="ltr"><span className="font-mono">{f.image_id.slice(0, 8)}</span> — {f.reason}</li>
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
