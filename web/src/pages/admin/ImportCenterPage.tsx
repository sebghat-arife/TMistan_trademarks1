import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileWarning, Image as ImageIcon, Loader2, RefreshCw, RotateCcw, Upload, X, XCircle } from 'lucide-react'
import { cn, formatDate, formatNumber } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import type { ImportJobRow } from '@/lib/database.types'
import { ErrorState } from '@/components/AsyncState'
import {
  type ColumnMapping,
  type ImportRow,
  type ParsedSheet,
  type TrademarkColumn,
  type ValidationResult,
  downloadText,
  isSpreadsheetFile,
  mapColumns,
  parseSpreadsheet,
  toCsv,
  validateRows,
  TRADEMARK_COLUMNS,
} from '@/lib/import/spreadsheet'
import { type ImageCandidate, type IntakeResult, intakeImages, isImageFile, isZipFile } from '@/lib/import/images'
import {
  type ImageImportProgress,
  type ImageUploadPlanItem,
  type RowImportProgress,
  type SerialResolution,
  addImportItems,
  createImportJob,
  finishImportJob,
  importCenterReady,
  importImages,
  importJobsQuery,
  importTrademarkRows,
  listImportJobItems,
  listTrademarksWithoutImages,
  planFor,
  resolveSerials,
} from '@/services'

/* ============================================================================
 * Admin → Import Center
 *
 *   1. TRADEMARK DATA   xlsx / xls / csv  → parse → map columns → validate →
 *                       import in batches (idempotent on serial_number)
 *   2. TRADEMARK IMAGES jpg / png / webp / zip → serial from file name →
 *                       resolve against the database → upload to Storage →
 *                       trademark_images rows → report
 * ========================================================================== */

export function ImportCenterPage() {
  const { t } = useTranslation()
  useDocumentTitle(`${t('admin.import.title')} · ${t('app.shortName')}`)
  const ready = useQuery({ queryKey: ['admin', 'import_ready'], queryFn: importCenterReady, staleTime: 60_000, retry: false })
  const blocked = ready.data ? !ready.data.ready : false
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold text-ink-900">{t('admin.import.title')}</h1>
          <p className="muted mt-1 max-w-3xl">{t('admin.import.subtitle')}</p>
        </div>
      </div>
      {blocked && (
        <div className="mt-5">
          <Callout tone="error" icon={XCircle} title={t('admin.import.notReadyTitle')} text={`${ready.data?.reason ?? ''} ${t('admin.import.notReadyHint')}`} />
        </div>
      )}
      <div className={cn('mt-5 grid gap-5 xl:grid-cols-2', blocked && 'pointer-events-none opacity-50')} aria-disabled={blocked}>
        <SpreadsheetImporter />
        <ImageImporter />
      </div>
      <RecentImports />
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Shared dropzone
 * ------------------------------------------------------------------------- */

function DropZone({
  title,
  hint,
  formats,
  icon: Icon,
  accept,
  multiple,
  disabled,
  onFiles,
  buttonLabel,
  className,
}: {
  title: string
  hint: string
  formats: string
  icon: React.ComponentType<{ className?: string }>
  accept: string
  multiple?: boolean
  disabled?: boolean
  onFiles: (files: File[]) => void
  buttonLabel: string
  className?: string
}) {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const handle = (list: FileList | null) => {
    if (!list || disabled) return
    onFiles(Array.from(list))
  }
  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        handle(e.dataTransfer.files)
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
        over ? 'border-brand-500 bg-brand-50' : 'border-ink-300 bg-ink-50/60 hover:border-brand-500 hover:bg-brand-50/50',
        disabled && 'pointer-events-none opacity-60',
        className,
      )}
    >
      <span className="icon-circle h-14 w-14">
        <Icon className="h-6 w-6" />
      </span>
      <p className="mt-4 text-[12px] font-bold uppercase tracking-[0.12em] text-ink-500">{title}</p>
      <p className="mt-1 text-[15px] font-medium text-ink-900">{hint}</p>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          inputRef.current?.click()
        }}
        disabled={disabled}
        className="btn-secondary mt-4 h-9 px-4 text-[13px]"
      >
        <Upload className="h-4 w-4" /> {buttonLabel}
      </button>
      <p className="mt-3 text-[12px] font-medium tracking-wide text-ink-400">{formats}</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          handle(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * 1. Spreadsheet importer
 * ------------------------------------------------------------------------- */

type SheetState =
  | { phase: 'idle' }
  | { phase: 'parsing'; fileName: string }
  | { phase: 'ready'; file: File; sheet: ParsedSheet; mapping: ColumnMapping; unmapped: string[]; validation: ValidationResult }
  | { phase: 'importing'; file: File; sheet: ParsedSheet; validation: ValidationResult; job: ImportJobRow; progress: RowImportProgress }
  | { phase: 'done'; file: File; sheet: ParsedSheet; validation: ValidationResult; job: ImportJobRow; progress: RowImportProgress; skippedInvalid: number }
  | { phase: 'error'; message: string; file?: File }

function SpreadsheetImporter() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const qc = useQueryClient()
  const [state, setState] = useState<SheetState>({ phase: 'idle' })
  const abortRef = useRef<AbortController | null>(null)

  const analyse = useCallback(async (file: File, sheetName?: string, mappingOverride?: ColumnMapping) => {
    if (!isSpreadsheetFile(file.name)) {
      setState({ phase: 'error', message: t('admin.import.unsupportedSpreadsheet', { name: file.name }) })
      return
    }
    setState({ phase: 'parsing', fileName: file.name })
    try {
      const sheet = await parseSpreadsheet(file, sheetName)
      const auto = mapColumns(sheet.headers)
      const mapping = mappingOverride ?? auto.mapping
      const used = new Set(Object.values(mapping).filter(Boolean) as string[])
      const validation = validateRows(sheet, mapping, { sourceFile: file.name })
      setState({ phase: 'ready', file, sheet, mapping, unmapped: sheet.headers.filter((h) => !used.has(h)), validation })
    } catch (e) {
      setState({ phase: 'error', message: (e as Error).message, file })
    }
  }, [t])

  const remap = (col: TrademarkColumn, header: string | null) => {
    if (state.phase !== 'ready') return
    const mapping: ColumnMapping = { ...state.mapping }
    // one header can feed only one column
    for (const c of TRADEMARK_COLUMNS) if (header && mapping[c] === header) mapping[c] = null
    mapping[col] = header
    const used = new Set(Object.values(mapping).filter(Boolean) as string[])
    setState({ ...state, mapping, unmapped: state.sheet.headers.filter((h) => !used.has(h)), validation: validateRows(state.sheet, mapping, { sourceFile: state.file.name }) })
  }

  const start = async () => {
    if (state.phase !== 'ready') return
    const { file, sheet, validation } = state
    if (validation.rows.length === 0) return
    const ctl = new AbortController()
    abortRef.current = ctl
    let job: ImportJobRow
    try {
      job = await createImportJob('excel', file.name, sheet.rawRows.length, {
        sheet: sheet.sheetName,
        columns: sheet.headers.length,
        mapped_columns: validation.mappedColumns,
        invalid_rows: validation.errors,
        warnings: validation.warnings,
      })
    } catch (e) {
      setState({ phase: 'error', message: (e as Error).message, file })
      return
    }
    const initial: RowImportProgress = { processed: 0, total: validation.rows.length, inserted: 0, updated: 0, skipped: 0, failed: 0, failures: [] }
    setState({ phase: 'importing', file, sheet, validation, job, progress: initial })
    try {
      // rows rejected by validation are recorded on the job so the report is complete
      if (validation.issues.length) {
        await addImportItems(
          job.id,
          validation.issues
            .filter((i) => i.level === 'error')
            .map((i) => ({ item_ref: i.serial ?? `${sheet.sheetName}!${i.row}`, status: 'invalid' as const, message: i.message, source_row: i.row })),
        )
      }
      const progress = await importTrademarkRows(job.id, validation.rows, (p) => setState((s) => (s.phase === 'importing' ? { ...s, progress: p } : s)), ctl.signal)
      const failed = progress.failed + validation.errors
      const status = failed > 0 || validation.warnings > 0 ? 'completed_with_warnings' : 'completed'
      const finished = await finishImportJob(job.id, status, { inserted: progress.inserted, updated: progress.updated, unchanged: progress.skipped, failed: progress.failed, invalid_rows: validation.errors }, null, sheet.rawRows.length, validation.errors)
      setState({ phase: 'done', file, sheet, validation, job: finished, progress, skippedInvalid: validation.errors })
    } catch (e) {
      const message = (e as Error).message
      try {
        await finishImportJob(job.id, 'failed', {}, message)
      } catch {
        /* the job row stays "processing"; the error is still shown */
      }
      setState({ phase: 'error', message, file })
    } finally {
      abortRef.current = null
      void qc.invalidateQueries({ queryKey: ['admin'] })
      void qc.invalidateQueries({ queryKey: ['stats'] })
      void qc.invalidateQueries({ queryKey: ['trademarks'] })
      void qc.invalidateQueries({ queryKey: ['gazettes'] })
    }
  }

  const reset = () => {
    abortRef.current?.abort()
    setState({ phase: 'idle' })
  }

  const downloadIssues = () => {
    if (state.phase !== 'ready' && state.phase !== 'done') return
    const rows = state.validation.issues.map((i) => [i.row, i.serial, i.level, i.message] as (string | number | null)[])
    if (state.phase === 'done') for (const f of state.progress.failures) rows.push([f.source_row, f.serial, 'error', f.message])
    downloadText(`${state.file.name.replace(/\.[^.]+$/, '')}-issues.csv`, toCsv(['row', 'serial_number', 'level', 'message'], rows))
  }

  return (
    <section className="card p-5">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="icon-circle h-10 w-10"><FileSpreadsheet className="h-5 w-5" /></span>
          <div>
            <h2 className="text-[16px] font-semibold text-ink-900">{t('admin.import.dataTitle')}</h2>
            <p className="muted">{t('admin.import.dataHint')}</p>
          </div>
        </div>
        {state.phase !== 'idle' && (
          <button type="button" onClick={reset} className="btn-ghost h-9 px-3 text-[13px]" aria-label={t('admin.import.reset')}>
            <X className="h-4 w-4" /> {t('admin.import.reset')}
          </button>
        )}
      </header>

      {state.phase === 'idle' && (
        <DropZone
          className="mt-4"
          title={t('admin.import.dataZoneTitle')}
          hint={t('admin.import.dataZoneHint')}
          formats="XLSX • XLS • CSV"
          icon={FileSpreadsheet}
          accept=".xlsx,.xls,.xlsm,.csv,.tsv,.ods,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          onFiles={(files) => void analyse(files[0])}
          buttonLabel={t('admin.import.chooseFile')}
        />
      )}

      {state.phase === 'parsing' && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-ink-200 bg-ink-50 px-4 py-3 text-[14px] text-ink-700" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('admin.import.parsing', { name: state.fileName })}
        </div>
      )}

      {state.phase === 'error' && (
        <div className="mt-4">
          <ErrorState error={new Error(state.message)} onRetry={state.file ? () => void analyse(state.file as File) : undefined} />
        </div>
      )}

      {(state.phase === 'ready' || state.phase === 'importing' || state.phase === 'done') && (
        <div className="mt-4 space-y-4">
          {/* file summary */}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Summary label={t('admin.import.file')} value={state.file.name} mono />
            <Summary label={t('admin.import.recordsDetected')} value={formatNumber(state.sheet.rawRows.length, lng)} />
            <Summary label={t('admin.import.columnsDetected')} value={formatNumber(state.sheet.headers.length, lng)} />
            <Summary label={t('fields.sheet')} value={state.sheet.sheetName} mono />
          </dl>

          {state.phase === 'ready' && state.sheet.sheetNames.length > 1 && (
            <label className="flex items-center gap-2 text-[13px] text-ink-700">
              {t('admin.import.sheet')}
              <select className="field h-9 w-auto" value={state.sheet.sheetName} onChange={(e) => void analyse(state.file, e.target.value)}>
                {state.sheet.sheetNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          )}

          {/* column mapping */}
          {state.phase === 'ready' && (
            <details className="rounded-lg border border-ink-200" open={state.validation.missingRequired.length > 0}>
              <summary className="cursor-pointer px-4 py-2.5 text-[14px] font-medium text-ink-900">
                {t('admin.import.columnMapping')} <span className="muted">({t('admin.import.mappedCount', { mapped: state.validation.mappedColumns.length, total: state.sheet.headers.length })})</span>
              </summary>
              <div className="grid gap-2 border-t border-ink-200 p-4 sm:grid-cols-2">
                {TRADEMARK_COLUMNS.filter((c) => c !== 'source_row').map((col) => (
                  <label key={col} className="flex items-center justify-between gap-2 text-[13px]">
                    <span className={cn('font-medium', col === 'serial_number' ? 'text-ink-900' : 'text-ink-600')}>
                      {t(`admin.import.columns.${col}`)}{col === 'serial_number' && <span className="text-red-600"> *</span>}
                    </span>
                    <select className="field h-8 max-w-[55%] text-[12px]" value={state.mapping[col] ?? ''} onChange={(e) => remap(col, e.target.value || null)}>
                      <option value="">—</option>
                      {state.sheet.headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {state.unmapped.length > 0 && (
                <p className="border-t border-ink-200 px-4 py-2 text-[12px] text-ink-500">{t('admin.import.ignoredColumns')}: {state.unmapped.join(', ')}</p>
              )}
            </details>
          )}

          {/* validation summary */}
          {state.validation.missingRequired.length > 0 ? (
            <Callout tone="error" icon={XCircle} title={t('admin.import.missingSerialColumn')} text={t('admin.import.missingSerialHint', { headers: state.sheet.headers.slice(0, 12).join(', ') })} />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat tone="ok" label={t('admin.import.validRows')} value={formatNumber(state.validation.rows.length, lng)} />
              <Stat tone={state.validation.errors ? 'error' : 'muted'} label={t('admin.import.invalidRows')} value={formatNumber(state.validation.errors, lng)} />
              <Stat tone={state.validation.duplicateSerials.length ? 'error' : 'muted'} label={t('admin.import.duplicateSerials')} value={formatNumber(state.validation.duplicateSerials.length, lng)} />
              <Stat tone={state.validation.warnings ? 'warn' : 'muted'} label={t('admin.import.warnings')} value={formatNumber(state.validation.warnings, lng)} />
            </div>
          )}

          {state.validation.issues.length > 0 && (
            <IssueTable
              title={t('admin.import.issuesTitle', { count: state.validation.issues.length })}
              rows={state.validation.issues.slice(0, 50).map((i) => [String(i.row), i.serial ?? '—', i.level === 'error' ? t('admin.import.error') : t('admin.import.warning'), i.message])}
              headers={[t('fields.row'), t('fields.serialNumber'), t('admin.import.level'), t('admin.import.message')]}
              more={Math.max(0, state.validation.issues.length - 50)}
              onDownload={downloadIssues}
              downloadLabel={t('admin.import.downloadIssues')}
            />
          )}

          {/* preview */}
          {state.phase === 'ready' && state.validation.rows.length > 0 && (
            <PreviewTable rows={state.validation.rows.slice(0, 8)} columns={state.validation.mappedColumns.filter((c) => c !== 'source_row')} />
          )}

          {/* actions */}
          {state.phase === 'ready' && (
            <div className="flex flex-wrap items-center gap-3 border-t border-ink-200 pt-4">
              <button type="button" onClick={() => void start()} disabled={state.validation.rows.length === 0} className="btn-primary h-10 px-5 text-[14px] disabled:cursor-not-allowed disabled:opacity-50">
                <Upload className="h-4 w-4" /> {t('admin.import.importRows', { count: state.validation.rows.length })}
              </button>
              {state.validation.errors > 0 && <span className="text-[13px] text-amber-800">{t('admin.import.invalidWillBeSkipped', { count: state.validation.errors })}</span>}
              <span className="muted ms-auto">{t('admin.import.idempotentHint')}</span>
            </div>
          )}

          {(state.phase === 'importing' || state.phase === 'done') && (
            <ProgressPanel
              done={state.phase === 'done'}
              processed={state.progress.processed}
              total={state.progress.total}
              cells={[
                [t('admin.import.processed'), formatNumber(state.progress.processed, lng)],
                [t('admin.inserted'), formatNumber(state.progress.inserted, lng)],
                [t('admin.updated'), formatNumber(state.progress.updated, lng)],
                [t('admin.import.unchanged'), formatNumber(state.progress.skipped, lng)],
                [t('admin.import.failed'), formatNumber(state.progress.failed + (state.phase === 'done' ? state.skippedInvalid : 0), lng)],
              ]}
              status={state.job.status}
              onCancel={state.phase === 'importing' ? () => abortRef.current?.abort() : undefined}
            />
          )}

          {state.phase === 'done' && (
            <div className="flex flex-wrap items-center gap-3">
              <Callout
                tone={state.progress.failed + state.skippedInvalid > 0 ? 'warn' : 'ok'}
                icon={state.progress.failed + state.skippedInvalid > 0 ? AlertTriangle : CheckCircle2}
                title={t('admin.import.dataDoneTitle')}
                text={t('admin.import.dataDoneText', { inserted: state.progress.inserted, updated: state.progress.updated, unchanged: state.progress.skipped, failed: state.progress.failed + state.skippedInvalid })}
                className="flex-1"
              />
            </div>
          )}
          {state.phase === 'done' && state.progress.failures.length > 0 && (
            <IssueTable
              title={t('admin.import.dbFailures', { count: state.progress.failures.length })}
              rows={state.progress.failures.slice(0, 50).map((f) => [String(f.source_row ?? '—'), f.serial ?? '—', t('admin.import.error'), f.message])}
              headers={[t('fields.row'), t('fields.serialNumber'), t('admin.import.level'), t('admin.import.message')]}
              more={Math.max(0, state.progress.failures.length - 50)}
              onDownload={downloadIssues}
              downloadLabel={t('admin.import.downloadIssues')}
            />
          )}
          {state.phase === 'done' && (
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={reset} className="btn-secondary h-9 px-4 text-[13px]"><RotateCcw className="h-4 w-4" /> {t('admin.import.importAnother')}</button>
              <Link to="/search" className="btn-ghost h-9 px-4 text-[13px]">{t('admin.import.openSearch')} ↗</Link>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function PreviewTable({ rows, columns }: { rows: ImportRow[]; columns: TrademarkColumn[] }) {
  const { t } = useTranslation()
  return (
    <div className="overflow-hidden rounded-lg border border-ink-200">
      <div className="bg-ink-50 px-4 py-2 text-[13px] font-medium text-ink-700">{t('admin.import.preview', { count: rows.length })}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="border-y border-ink-200 bg-white text-ink-600">
            <tr className="[&>th]:whitespace-nowrap [&>th]:px-3 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
              <th>#</th>
              {columns.map((c) => (
                <th key={c}>{t(`admin.import.columns.${c}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((r) => (
              <tr key={r.source_row} className="[&>td]:max-w-[220px] [&>td]:truncate [&>td]:px-3 [&>td]:py-1.5">
                <td className="text-ink-400">{r.source_row}</td>
                {columns.map((c) => (
                  <td key={c} title={r[c] == null ? undefined : String(r[c])} dir="auto">{r[c] == null ? <span className="text-ink-300">—</span> : String(r[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * 2. Image importer
 * ------------------------------------------------------------------------- */

interface MatchedSet {
  matched: ImageUploadPlanItem[]
  unmatched: ImageCandidate[]
  ambiguous: { candidate: ImageCandidate; resolution: SerialResolution }[]
  /** Second/third file for a trademark that already has a file in this batch. */
  duplicates: { candidate: ImageCandidate; resolution: SerialResolution; keptFile: string }[]
  noSerial: ImageCandidate[]
}

type ImageState =
  | { phase: 'idle' }
  | { phase: 'reading'; done: number; total: number }
  | { phase: 'resolving'; intake: IntakeResult }
  | { phase: 'ready'; intake: IntakeResult; match: MatchedSet }
  | { phase: 'importing'; intake: IntakeResult; match: MatchedSet; job: ImportJobRow; progress: ImageImportProgress }
  | { phase: 'done'; intake: IntakeResult; match: MatchedSet; job: ImportJobRow; progress: ImageImportProgress }
  | { phase: 'error'; message: string }

function ImageImporter() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const qc = useQueryClient()
  const [state, setState] = useState<ImageState>({ phase: 'idle' })
  const [showMissing, setShowMissing] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const intake = useCallback(async (files: File[]) => {
    if (!files.some((f) => isImageFile(f.name) || isZipFile(f.name))) {
      setState({ phase: 'error', message: t('admin.import.unsupportedImages') })
      return
    }
    setState({ phase: 'reading', done: 0, total: files.length })
    try {
      // every dropped file is accounted for — unsupported ones end up in the report as "invalid"
      const result = await intakeImages(files, (done, total) => setState({ phase: 'reading', done, total }))
      setState({ phase: 'resolving', intake: result })
      const withSerial = result.candidates.filter((c) => c.serial)
      const resolved = await resolveSerials(withSerial.map((c) => c.serial as string))
      const match: MatchedSet = { matched: [], unmatched: [], ambiguous: [], duplicates: [], noSerial: result.candidates.filter((c) => !c.serial) }
      // one image per trademark per batch: the first file wins, the others are reported as duplicates
      const taken = new Map<string, string>()
      for (const c of withSerial) {
        const r = resolved.get(c.serial as string)
        if (!r || r.method === 'unmatched') match.unmatched.push(c)
        else if (r.method === 'ambiguous' || !r.trademark_id) match.ambiguous.push({ candidate: c, resolution: r })
        else if (taken.has(r.trademark_id)) match.duplicates.push({ candidate: c, resolution: r, keptFile: taken.get(r.trademark_id) as string })
        else {
          taken.set(r.trademark_id, c.fileName)
          match.matched.push(planFor(c, r))
        }
      }
      setState({ phase: 'ready', intake: result, match })
    } catch (e) {
      setState({ phase: 'error', message: (e as Error).message })
    }
  }, [t])

  const start = async () => {
    if (state.phase !== 'ready') return
    const { intake: res, match } = state
    const ctl = new AbortController()
    abortRef.current = ctl
    const label = res.candidates[0]?.archive ?? (res.candidates.length === 1 ? res.candidates[0].fileName : t('admin.import.imagesBatchName', { count: res.candidates.length }))
    let job: ImportJobRow
    try {
      job = await createImportJob('images', label, res.candidates.length + res.invalid.length, {
        images_processed: res.candidates.length + res.invalid.length,
        invalid_files: res.invalid.length + match.noSerial.length,
        matched: match.matched.length,
        unmatched: match.unmatched.length,
        ambiguous: match.ambiguous.length,
        duplicates: match.duplicates.length,
        identical_content: res.duplicateContent.length,
      })
    } catch (e) {
      setState({ phase: 'error', message: (e as Error).message })
      return
    }
    const initial: ImageImportProgress = { processed: 0, total: match.matched.length, uploaded: 0, linked: 0, unchanged: 0, failed: 0, failures: [] }
    setState({ phase: 'importing', intake: res, match, job, progress: initial })
    try {
      const items = [
        ...match.unmatched.map((c) => ({ item_ref: c.fileName, status: 'unmatched' as const, message: t('admin.import.noTrademarkForSerial', { serial: c.serial }), serial: c.serial, archive: c.archive })),
        ...match.ambiguous.map((a) => ({ item_ref: a.candidate.fileName, status: 'ambiguous' as const, message: `${a.resolution.candidates} trademarks share this serial`, serial: a.candidate.serial })),
        ...match.noSerial.map((c) => ({ item_ref: c.fileName, status: 'invalid' as const, message: 'file name contains no serial number' })),
        ...res.invalid.map((f) => ({ item_ref: f.archive ? `${f.archive}/${f.fileName}` : f.fileName, status: 'invalid' as const, message: f.reason })),
        ...match.duplicates.map((d) => ({ item_ref: d.candidate.fileName, status: 'duplicate' as const, message: `duplicate of ${d.keptFile} (${d.resolution.serial_number})`, serial: d.resolution.serial_number })),
      ]
      if (items.length) await addImportItems(job.id, items)
      const progress = await importImages(job.id, match.matched, (p) => setState((s) => (s.phase === 'importing' ? { ...s, progress: p } : s)), ctl.signal)
      const rejected = match.unmatched.length + match.ambiguous.length + res.invalid.length + match.noSerial.length
      const warn = progress.failed > 0 || rejected > 0
      const finished = await finishImportJob(job.id, warn ? 'completed_with_warnings' : 'completed', { uploaded: progress.uploaded, linked: progress.linked, unchanged: progress.unchanged, failed: progress.failed }, null, null, rejected)
      setState({ phase: 'done', intake: res, match, job: finished, progress })
    } catch (e) {
      const message = (e as Error).message
      try {
        await finishImportJob(job.id, 'failed', {}, message)
      } catch {
        /* keep original error */
      }
      setState({ phase: 'error', message })
    } finally {
      abortRef.current = null
      void qc.invalidateQueries({ queryKey: ['admin'] })
      void qc.invalidateQueries({ queryKey: ['stats'] })
      void qc.invalidateQueries({ queryKey: ['trademarks'] })
    }
  }

  const reset = () => {
    abortRef.current?.abort()
    setState({ phase: 'idle' })
  }

  const downloadUnmatched = () => {
    if (state.phase !== 'ready' && state.phase !== 'importing' && state.phase !== 'done') return
    const rows: (string | null)[][] = [
      ...state.match.unmatched.map((c) => [c.fileName, c.serial, 'unmatched', 'no trademark with this serial number', c.archive]),
      ...state.match.ambiguous.map((a) => [a.candidate.fileName, a.candidate.serial, 'ambiguous', `${a.resolution.candidates} trademarks share this serial`, a.candidate.archive]),
      ...state.match.noSerial.map((c) => [c.fileName, null, 'invalid', 'file name contains no serial number', c.archive]),
      ...state.intake.invalid.map((f) => [f.fileName, null, 'invalid', f.reason, f.archive]),
      ...state.match.duplicates.map((d) => [d.candidate.fileName, d.resolution.serial_number, 'duplicate', `duplicate of ${d.keptFile}`, d.candidate.archive]),
    ]
    if (state.phase === 'done') for (const f of state.progress.failures) rows.push([f.fileName, null, 'failed', f.message, null])
    downloadText('unmatched-images.csv', toCsv(['file', 'serial', 'status', 'reason', 'archive'], rows))
  }

  const match = state.phase === 'ready' || state.phase === 'importing' || state.phase === 'done' ? state.match : null
  const res = state.phase === 'resolving' || state.phase === 'ready' || state.phase === 'importing' || state.phase === 'done' ? state.intake : null
  const problems = match && res ? match.unmatched.length + match.ambiguous.length + match.noSerial.length + res.invalid.length + match.duplicates.length : 0

  return (
    <section className="card p-5">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="icon-circle h-10 w-10"><ImageIcon className="h-5 w-5" /></span>
          <div>
            <h2 className="text-[16px] font-semibold text-ink-900">{t('admin.import.imagesTitle')}</h2>
            <p className="muted">{t('admin.import.imagesHint')}</p>
          </div>
        </div>
        {state.phase !== 'idle' && (
          <button type="button" onClick={reset} className="btn-ghost h-9 px-3 text-[13px]" aria-label={t('admin.import.reset')}>
            <X className="h-4 w-4" /> {t('admin.import.reset')}
          </button>
        )}
      </header>

      {state.phase === 'idle' && (
        <DropZone
          className="mt-4"
          title={t('admin.import.imagesZoneTitle')}
          hint={t('admin.import.imagesZoneHint')}
          formats="JPG • PNG • WEBP • ZIP"
          icon={ImageIcon}
          accept=".jpg,.jpeg,.png,.webp,.gif,.tif,.tiff,.zip,image/*,application/zip,application/x-zip-compressed"
          multiple
          onFiles={(files) => void intake(files)}
          buttonLabel={t('admin.import.chooseFiles')}
        />
      )}

      {state.phase === 'reading' && (
        <div className="mt-4 rounded-lg border border-ink-200 bg-ink-50 px-4 py-3 text-[14px] text-ink-700" role="status">
          <div className="flex items-center gap-3"><Loader2 className="h-4 w-4 animate-spin" /> {t('admin.import.readingImages', { done: state.done, total: state.total })}</div>
          <Bar value={state.total ? state.done / state.total : 0} className="mt-2" />
        </div>
      )}
      {state.phase === 'resolving' && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-ink-200 bg-ink-50 px-4 py-3 text-[14px] text-ink-700" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('admin.import.matchingSerials', { count: state.intake.candidates.length })}
        </div>
      )}
      {state.phase === 'error' && <div className="mt-4"><ErrorState error={new Error(state.message)} /></div>}

      {match && res && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat tone="muted" label={t('admin.import.imagesProcessed')} value={formatNumber(res.candidates.length + res.invalid.length, lng)} />
            <Stat tone="ok" label={t('admin.import.imagesMatched')} value={formatNumber(match.matched.length, lng)} />
            <Stat tone={match.unmatched.length ? 'error' : 'muted'} label={t('admin.import.imagesUnmatched')} value={formatNumber(match.unmatched.length, lng)} />
            <Stat tone={match.ambiguous.length ? 'warn' : 'muted'} label={t('admin.import.imagesAmbiguous')} value={formatNumber(match.ambiguous.length, lng)} />
            <Stat tone={match.duplicates.length ? 'warn' : 'muted'} label={t('admin.import.imagesDuplicate')} value={formatNumber(match.duplicates.length, lng)} hint={res.duplicateContent.length ? t('admin.import.sameBytes', { count: res.duplicateContent.length }) : undefined} />
            <Stat tone={res.invalid.length + match.noSerial.length ? 'error' : 'muted'} label={t('admin.import.imagesInvalid')} value={formatNumber(res.invalid.length + match.noSerial.length, lng)} />
          </div>

          {state.phase === 'ready' && match.matched.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-ink-200">
              <div className="bg-ink-50 px-4 py-2 text-[13px] font-medium text-ink-700">{t('admin.import.matchPreview', { count: Math.min(8, match.matched.length) })}</div>
              <table className="w-full text-[12px]">
                <thead className="border-y border-ink-200 text-ink-600">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
                    <th>{t('admin.import.file')}</th>
                    <th>{t('fields.serialNumber')}</th>
                    <th>{t('fields.markName')}</th>
                    <th>{t('admin.import.method')}</th>
                    <th>{t('admin.import.storagePath')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {match.matched.slice(0, 8).map((m) => (
                    <tr key={m.candidate.key} className="[&>td]:px-3 [&>td]:py-1.5">
                      <td className="flex items-center gap-2" dir="ltr"><Thumb candidate={m.candidate} /> {m.candidate.fileName}</td>
                      <td dir="ltr" className="font-medium text-ink-900">{m.resolution.serial_number}</td>
                      <td dir="auto">{m.resolution.mark_name ?? '—'}</td>
                      <td><span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">{m.resolution.method}</span></td>
                      <td dir="ltr" className="text-ink-500">{m.storagePath}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {problems > 0 && (
            <IssueTable
              title={t('admin.import.imageIssues', { count: problems })}
              headers={[t('admin.import.file'), t('fields.serialNumber'), t('admin.import.level'), t('admin.import.message')]}
              rows={[
                ...match.unmatched.map((c) => [c.fileName, c.serial ?? '—', t('admin.import.unmatched'), t('admin.import.noTrademarkForSerial', { serial: c.serial })]),
                ...match.ambiguous.map((a) => [a.candidate.fileName, a.candidate.serial ?? '—', t('admin.import.ambiguous'), t('admin.import.candidates', { count: a.resolution.candidates })]),
                ...match.noSerial.map((c) => [c.fileName, '—', t('admin.import.invalid'), t('admin.import.noSerialInName')]),
                ...res.invalid.map((f) => [f.archive ? `${f.archive}/${f.fileName}` : f.fileName, '—', t('admin.import.invalid'), f.reason]),
                ...match.duplicates.map((d) => [d.candidate.fileName, d.resolution.serial_number ?? '—', t('admin.import.duplicate'), t('admin.import.duplicateOf', { file: d.keptFile })]),
              ].slice(0, 50)}
              more={Math.max(0, problems - 50)}
              onDownload={downloadUnmatched}
              downloadLabel={t('admin.import.downloadUnmatched')}
            />
          )}

          {state.phase === 'ready' && (
            <div className="flex flex-wrap items-center gap-3 border-t border-ink-200 pt-4">
              <button type="button" onClick={() => void start()} disabled={match.matched.length === 0} className="btn-primary h-10 px-5 text-[14px] disabled:cursor-not-allowed disabled:opacity-50">
                <Upload className="h-4 w-4" /> {t('admin.import.uploadMatched', { count: match.matched.length })}
              </button>
              {match.matched.length === 0 && <span className="text-[13px] text-amber-800">{t('admin.import.nothingToUpload')}</span>}
              <span className="muted ms-auto">{t('admin.import.imageIdempotentHint')}</span>
            </div>
          )}

          {(state.phase === 'importing' || state.phase === 'done') && (
            <ProgressPanel
              done={state.phase === 'done'}
              processed={state.progress.processed}
              total={state.progress.total}
              cells={[
                [t('admin.import.uploaded'), formatNumber(state.progress.uploaded, lng)],
                [t('admin.import.linked'), formatNumber(state.progress.linked, lng)],
                [t('admin.import.unchanged'), formatNumber(state.progress.unchanged, lng)],
                [t('admin.import.failed'), formatNumber(state.progress.failed, lng)],
              ]}
              status={state.job.status}
              onCancel={state.phase === 'importing' ? () => abortRef.current?.abort() : undefined}
            />
          )}

          {state.phase === 'done' && (
            <>
              <Callout
                tone={state.progress.failed > 0 ? 'warn' : 'ok'}
                icon={state.progress.failed > 0 ? AlertTriangle : CheckCircle2}
                title={t('admin.import.imagesDoneTitle')}
                text={t('admin.import.imagesDoneText', { linked: state.progress.linked, unchanged: state.progress.unchanged, unmatched: match.unmatched.length, failed: state.progress.failed })}
              />
              {state.progress.failures.length > 0 && (
                <IssueTable
                  title={t('admin.import.uploadFailures', { count: state.progress.failures.length })}
                  headers={[t('admin.import.file'), t('admin.import.message')]}
                  rows={state.progress.failures.slice(0, 50).map((f) => [f.fileName, f.message])}
                  more={Math.max(0, state.progress.failures.length - 50)}
                  onDownload={downloadUnmatched}
                  downloadLabel={t('admin.import.downloadUnmatched')}
                />
              )}
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={reset} className="btn-secondary h-9 px-4 text-[13px]"><RotateCcw className="h-4 w-4" /> {t('admin.import.importMoreImages')}</button>
                {state.match.matched[0] && (
                  <Link to={`/trademark/${encodeURIComponent(state.match.matched[0].resolution.serial_number ?? '')}`} className="btn-ghost h-9 px-4 text-[13px]">
                    {t('admin.import.openFirstMatched')} ↗
                  </Link>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <div className="mt-5 border-t border-ink-200 pt-4">
        <button type="button" onClick={() => setShowMissing((v) => !v)} className="link-green">
          {showMissing ? t('admin.import.hideMissing') : t('admin.import.showMissing')}
        </button>
        {showMissing && <MissingImagesReport />}
      </div>
    </section>
  )
}

function Thumb({ candidate }: { candidate: ImageCandidate }) {
  const url = useMemo(() => URL.createObjectURL(new Blob([candidate.bytes as BlobPart], { type: candidate.contentType })), [candidate])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return <img src={url} alt="" className="h-7 w-9 rounded border border-ink-200 bg-white object-contain" />
}

function MissingImagesReport() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const q = useQuery({ queryKey: ['admin', 'missing-images'], queryFn: () => listTrademarksWithoutImages(1000, 0), staleTime: 15_000 })
  if (q.isLoading) return <p className="muted mt-3">{t('common.loading')}</p>
  if (q.isError) return <ErrorState className="mt-3" error={q.error} onRetry={() => void q.refetch()} />
  const items = q.data?.items ?? []
  const total = q.data?.total ?? 0
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] text-ink-800">{t('admin.import.missingCount', { count: total })}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => void q.refetch()} className="btn-ghost h-8 px-2 text-[12px]"><RefreshCw className="h-3.5 w-3.5" /> {t('common.retry')}</button>
          <button
            type="button"
            disabled={!items.length}
            onClick={() => downloadText('trademarks-without-images.csv', toCsv(['serial_number', 'gazette', 'mark_name', 'applicant'], items.map((i) => [i.serial_number, i.official_gazette_number, i.mark_name, i.applicant_name])))}
            className="btn-secondary h-8 px-3 text-[12px] disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>
      {items.length > 0 && (
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-ink-200">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-ink-50 text-ink-600">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
                <th>{t('fields.serialNumber')}</th><th>{t('fields.gazette')}</th><th>{t('fields.markName')}</th><th>{t('fields.applicant')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {items.map((i) => (
                <tr key={i.id} className="[&>td]:px-3 [&>td]:py-1.5">
                  <td dir="ltr"><Link to={`/trademark/${encodeURIComponent(i.serial_number)}`} className="font-medium text-brand-600 hover:underline">{i.serial_number}</Link></td>
                  <td dir="ltr">{i.official_gazette_number}</td>
                  <td dir="auto">{i.mark_name ?? '—'}</td>
                  <td dir="auto">{i.applicant_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > items.length && <p className="px-3 py-2 text-[12px] text-ink-500">{t('admin.import.showingFirst', { shown: formatNumber(items.length, lng), total: formatNumber(total, lng) })}</p>}
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Recent imports (history + per-job report)
 * ------------------------------------------------------------------------- */

function RecentImports() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const { data: jobs, isLoading, isError, error, refetch } = useQuery(importJobsQuery(25))
  const [open, setOpen] = useState<string | null>(null)
  return (
    <section className="card mt-5 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <h2 className="text-[16px] font-semibold text-ink-900">{t('admin.recentImports')}</h2>
        <button type="button" onClick={() => void refetch()} className="btn-ghost h-8 px-2 text-[12px]"><RefreshCw className="h-3.5 w-3.5" /> {t('admin.import.refresh')}</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead className="border-y border-ink-200 bg-ink-50 text-[13px] text-ink-600">
            <tr className="[&>th]:px-5 [&>th]:py-2.5 [&>th]:text-start [&>th]:font-medium">
              <th className="w-44">{t('admin.date')}</th>
              <th className="w-28">{t('admin.import.type')}</th>
              <th>{t('admin.fileName')}</th>
              <th className="w-24">{t('admin.import.records')}</th>
              <th className="w-24">{t('admin.import.imagesCol')}</th>
              <th className="w-40">{t('admin.status')}</th>
              <th className="w-28" />
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {(jobs ?? []).map((j) => (
              <JobRow key={j.id} job={j} lng={lng} open={open === j.id} onToggle={() => setOpen(open === j.id ? null : j.id)} />
            ))}
            {isError && <tr><td colSpan={7} className="px-5 py-4"><ErrorState error={error} /></td></tr>}
            {!isLoading && !isError && (jobs ?? []).length === 0 && <tr><td colSpan={7} className="px-5 py-8 text-center text-ink-500">{t('admin.noImports')}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function JobRow({ job: j, lng, open, onToggle }: { job: ImportJobRow; lng: string | undefined; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  const isImages = j.job_type === 'images'
  const counted = j.inserted_rows + j.updated_rows + j.skipped_rows
  return (
    <>
      <tr className="hover:bg-ink-50/60">
        <td className="px-5 py-3 tabular-nums text-ink-600">{formatDate(j.completed_at ?? j.created_at, lng)} <span className="text-ink-400">{timeOf(j.completed_at ?? j.created_at)}</span></td>
        <td className="px-5 py-3"><span className="inline-flex items-center gap-1.5 text-ink-800">{isImages ? <ImageIcon className="h-4 w-4 text-ink-500" /> : <FileSpreadsheet className="h-4 w-4 text-ink-500" />}{isImages ? t('admin.import.typeImages') : t('admin.import.typeData')}</span></td>
        <td className="px-5 py-3 font-medium text-ink-900" dir="ltr">{j.filename ?? '—'}</td>
        <td className="px-5 py-3 tabular-nums">{isImages ? '—' : `${formatNumber(counted, lng)} / ${formatNumber(j.total_rows, lng)}`}</td>
        <td className="px-5 py-3 tabular-nums">{isImages ? `${formatNumber(counted, lng)} / ${formatNumber(j.total_rows, lng)}` : '—'}</td>
        <td className="px-5 py-3"><StatusPill status={j.status} /></td>
        <td className="px-5 py-3 text-end"><button type="button" onClick={onToggle} className="link-green">{open ? t('admin.import.hideReport') : t('admin.import.viewReport')}</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="bg-ink-50/70 px-5 py-4"><JobReport job={j} /></td>
        </tr>
      )}
    </>
  )
}

function JobReport({ job }: { job: ImportJobRow }) {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const q = useQuery({ queryKey: ['admin', 'import_job_items', job.id], queryFn: () => listImportJobItems(job.id), staleTime: 30_000 })
  const summary = (job.summary ?? {}) as Record<string, unknown>
  const items = q.data ?? []
  const counts = items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.status]: (acc[i.status] ?? 0) + 1 }), {})
  return (
    <div className="space-y-3 text-[13px]">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-ink-700">
        <span>{t('admin.total')}: <b>{formatNumber(job.total_rows, lng)}</b></span>
        <span>{t('admin.inserted')}: <b>{formatNumber(job.inserted_rows, lng)}</b></span>
        <span>{t('admin.updated')}: <b>{formatNumber(job.updated_rows, lng)}</b></span>
        <span>{t('admin.import.unchanged')}: <b>{formatNumber(job.skipped_rows, lng)}</b></span>
        <span>{t('admin.import.failed')}: <b>{formatNumber(job.failed_rows, lng)}</b></span>
        {Object.entries(counts).map(([k, v]) => <span key={k}>{k}: <b>{formatNumber(v, lng)}</b></span>)}
        {job.started_at && job.completed_at && <span>{t('admin.import.duration')}: <b>{Math.max(1, Math.round((new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000))}s</b></span>}
      </div>
      {job.error_message && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800" dir="ltr">{job.error_message}</p>}
      {(job.status === 'failed' || job.status === 'completed_with_warnings' || job.status === 'processing') && <p className="text-ink-600">{t('admin.import.retryHint')}</p>}
      {Object.keys(summary).length > 0 && (
        <p className="text-ink-500" dir="ltr">
          {Object.entries(summary).filter(([k]) => k !== 'source').map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length : String(v)}`).join(' · ')}
        </p>
      )}
      {q.isError && <ErrorState error={q.error} />}
      {items.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium text-ink-800">{t('admin.import.itemReport', { count: items.length })}</span>
            <button
              type="button"
              className="btn-secondary h-8 px-3 text-[12px]"
              onClick={() => downloadText(`import-${job.id.slice(0, 8)}-report.csv`, toCsv(['item', 'status', 'message'], items.map((i) => [i.item_ref, i.status, i.message])))}
            >
              <Download className="h-3.5 w-3.5" /> {t('admin.import.downloadReport')}
            </button>
          </div>
          <div className="max-h-56 overflow-auto rounded-lg border border-ink-200 bg-white">
            <table className="w-full text-[12px]">
              <tbody className="divide-y divide-ink-100">
                {items.slice(0, 300).map((i) => (
                  <tr key={i.id} className="[&>td]:px-3 [&>td]:py-1.5">
                    <td dir="ltr" className="font-medium text-ink-900">{i.item_ref}</td>
                    <td><span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', i.status === 'failed' ? 'bg-red-50 text-red-700' : i.status === 'unmatched' || i.status === 'ambiguous' ? 'bg-amber-50 text-amber-800' : 'bg-ink-100 text-ink-600')}>{i.status}</span></td>
                    <td className="text-ink-600" dir="auto">{i.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {!q.isLoading && items.length === 0 && !q.isError && <p className="text-ink-500">{t('admin.import.noItems')}</p>}
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Small presentational helpers
 * ------------------------------------------------------------------------- */

function Summary({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-ink-50/60 px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className={cn('mt-0.5 truncate text-[14px] font-medium text-ink-900', mono && 'font-mono text-[13px]')} title={value} dir="ltr">{value}</dd>
    </div>
  )
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone: 'ok' | 'warn' | 'error' | 'muted'; hint?: string }) {
  const cls = { ok: 'border-brand-200 bg-brand-50 text-brand-800', warn: 'border-amber-200 bg-amber-50 text-amber-900', error: 'border-red-200 bg-red-50 text-red-800', muted: 'border-ink-200 bg-white text-ink-700' }[tone]
  return (
    <div className={cn('rounded-lg border px-3 py-2', cls)} title={hint}>
      <div className="text-[20px] font-bold leading-tight tabular-nums">{value}</div>
      <div className="text-[12px] opacity-80">{label}</div>
    </div>
  )
}

function Callout({ tone, icon: Icon, title, text, className }: { tone: 'ok' | 'warn' | 'error'; icon: React.ComponentType<{ className?: string }>; title: string; text: string; className?: string }) {
  const cls = { ok: 'border-brand-200 bg-brand-50 text-brand-800', warn: 'border-amber-200 bg-amber-50 text-amber-900', error: 'border-red-200 bg-red-50 text-red-800' }[tone]
  return (
    <div className={cn('flex items-start gap-3 rounded-lg border px-4 py-3', cls, className)} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div>
        <p className="text-[14px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[13px] opacity-90">{text}</p>
      </div>
    </div>
  )
}

function Bar({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)))
  return (
    <div className={cn('h-2.5 w-full overflow-hidden rounded-full bg-ink-100', className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
  )
}

function ProgressPanel({ done, processed, total, cells, status, onCancel }: { done: boolean; processed: number; total: number; cells: [string, string][]; status: ImportJobRow['status']; onCancel?: () => void }) {
  const { t } = useTranslation()
  const pct = total ? processed / total : 1
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-4">
      <div className="flex items-center justify-between text-[13px]">
        <span className="flex items-center gap-2 font-medium text-ink-800">
          {done ? <CheckCircle2 className="h-4 w-4 text-brand-600" /> : <Loader2 className="h-4 w-4 animate-spin text-brand-600" />}
          {done ? t('admin.import.finished') : t('admin.import.inProgress')} · {Math.round(pct * 100)}%
        </span>
        <span className="flex items-center gap-3">
          <StatusPill status={status} />
          {onCancel && <button type="button" onClick={onCancel} className="btn-ghost h-7 px-2 text-[12px]"><XCircle className="h-3.5 w-3.5" /> {t('admin.import.cancel')}</button>}
        </span>
      </div>
      <Bar value={pct} className="mt-2" />
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {cells.map(([k, v]) => (
          <div key={k} className="rounded-md bg-ink-50 px-3 py-1.5">
            <dt className="text-[11px] uppercase tracking-wide text-ink-500">{k}</dt>
            <dd className="text-[16px] font-bold tabular-nums text-ink-900">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function IssueTable({ title, headers, rows, more, onDownload, downloadLabel }: { title: string; headers: string[]; rows: string[][]; more: number; onDownload: () => void; downloadLabel: string }) {
  const { t } = useTranslation()
  return (
    <div className="overflow-hidden rounded-lg border border-amber-200">
      <div className="flex items-center justify-between bg-amber-50 px-4 py-2">
        <span className="flex items-center gap-2 text-[13px] font-medium text-amber-900"><FileWarning className="h-4 w-4" /> {title}</span>
        <button type="button" onClick={onDownload} className="btn-secondary h-8 px-3 text-[12px]"><Download className="h-3.5 w-3.5" /> {downloadLabel}</button>
      </div>
      <div className="max-h-56 overflow-auto">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-white text-ink-600">
            <tr className="[&>th]:px-3 [&>th]:py-1.5 [&>th]:text-start [&>th]:font-medium">{headers.map((h) => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-ink-100 bg-white">
            {rows.map((r, i) => (
              <tr key={i} className="[&>td]:px-3 [&>td]:py-1.5">{r.map((c, j) => <td key={j} dir="auto" className={cn(j === 0 && 'font-medium text-ink-900')}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
        {more > 0 && <p className="bg-white px-3 py-2 text-[12px] text-ink-500">{t('admin.import.moreRows', { count: more })}</p>}
      </div>
    </div>
  )
}

export function StatusPill({ status }: { status: ImportJobRow['status'] }) {
  const { t } = useTranslation()
  const map: Record<ImportJobRow['status'], string> = {
    completed: 'bg-brand-50 text-brand-700',
    completed_with_warnings: 'bg-amber-50 text-amber-800',
    failed: 'bg-red-50 text-red-700',
    processing: 'bg-blue-50 text-blue-700',
    queued: 'bg-ink-100 text-ink-600',
  }
  return <span className={cn('inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold', map[status])}>{t(`admin.import.status.${status}`)}</span>
}

function timeOf(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  } catch {
    return ''
  }
}
