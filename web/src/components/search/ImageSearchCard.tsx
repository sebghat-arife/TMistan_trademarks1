import { useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronDown, ImageIcon, ImageOff, ImageUp, Info, Loader2, RefreshCw, ScanText, Search, Sparkles, Trash2, UploadCloud } from 'lucide-react'
import { filterOptionsQuery } from '@/services'
import { MAX_QUERY_IMAGE_BYTES } from '@/lib/imageSearch/descriptor'
import { OCR_DOWNLOAD_MB } from '@/lib/imageSearch/ocr'
import { IMAGE_SEARCH_EXACT_MIN_SIMILARITY, IMAGE_SEARCH_MAX_LIMIT } from '@/services'
import { cn, formatNumber } from '@/lib/utils'
import type { ImageSearchController, ImageSearchOption } from './useImageSearch'

const MAX_MB = Math.round(MAX_QUERY_IMAGE_BYTES / (1024 * 1024))
const ALL_CLASSES = Array.from({ length: 45 }, (_, i) => i + 1)

/**
 * The "Search by Image" card: upload zone / preview on the start side, search
 * options + Search button on the end side.
 */
export function ImageSearchCard({ c, className }: { c: ImageSearchController; className?: string }) {
  const { t, i18n } = useTranslation()
  const uid = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const lng = i18n.resolvedLanguage
  const { status, available, file, previewUrl, source, busy, phase, errorKind, errorDetail, mode, hybridStatus } = c

  const pick = () => inputRef.current?.click()
  const onFiles = (files: FileList | null | undefined) => {
    c.choose(files?.[0])
    if (inputRef.current) inputRef.current.value = ''
  }
  const canSubmit = !!file && available && !busy
  const submitLabel = phase === 'loading-example' ? t('search.image.examples.loading') : phase === 'analysing' ? t('search.image.recognising') : phase === 'searching' ? t('search.image.searching') : t('search.image.submit')

  return (
    <section id="search-panel-image" role="tabpanel" aria-labelledby="search-tab-image" className={cn('card overflow-hidden shadow-[0_18px_50px_-24px_rgba(16,35,58,0.35)]', className)}>
      <div className="grid md:grid-cols-[minmax(0,1.45fr)_minmax(280px,1fr)]">
        {/* ── Upload ─────────────────────────────────────────────────── */}
        <div className="p-5 md:p-6">
          <div className="flex items-start gap-3">
            <span className="icon-circle h-10 w-10"><ImageUp className="h-[18px] w-[18px]" aria-hidden /></span>
            <div className="min-w-0">
              <h2 className="text-[17px] font-semibold text-ink-900">{t('search.image.uploadTitle')}</h2>
              <p className="mt-0.5 text-[13px] leading-relaxed text-ink-600">{t('search.image.uploadLead')}</p>
              <p className="text-[13px] leading-relaxed text-ink-500">{t('search.image.uploadFormats')}</p>
            </div>
          </div>

          <input
            ref={inputRef}
            id={`${uid}-file`}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            className="sr-only"
            onChange={(e) => onFiles(e.target.files)}
            disabled={busy}
            data-testid="image-input"
          />

          {!file ? (
            <label
              htmlFor={`${uid}-file`}
              onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!busy) onFiles(e.dataTransfer.files) }}
              className={cn(
                'mt-5 flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors',
                dragOver ? 'border-brand-500 bg-brand-50' : 'border-ink-300 bg-ink-50/50 hover:border-brand-400 hover:bg-brand-50/40',
                busy && 'pointer-events-none opacity-60',
              )}
              data-testid="image-dropzone"
            >
              <UploadCloud className="h-10 w-10 text-brand-600" strokeWidth={1.5} aria-hidden />
              <span className="mt-3 text-[16px] font-semibold text-ink-900">{t('search.image.dropTitle')}</span>
              <span className="mt-1 text-[13px] text-ink-500">{t('search.image.dropOr')}</span>
              <button type="button" onClick={(e) => { e.preventDefault(); pick() }} className="btn-outline-green mt-3 h-10 px-5 text-[14px]" data-testid="choose-file">
                {t('search.image.chooseFile')}
              </button>
              <span className="mt-4 text-[12px] text-ink-500" dir="ltr">{t('search.image.dropMeta', { mb: MAX_MB })}</span>
            </label>
          ) : (
            <div className="mt-5 rounded-xl border border-ink-200 bg-white p-4" data-testid="image-preview">
              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="checker flex h-44 w-full shrink-0 items-center justify-center overflow-hidden rounded-lg border border-ink-200 p-2 sm:w-56">
                  {previewUrl ? <img src={previewUrl} alt={t('search.image.previewAlt')} className="max-h-full max-w-full object-contain" /> : <ImageIcon className="h-8 w-8 text-ink-300" aria-hidden />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium uppercase tracking-wide text-ink-500">{t('search.image.selected')}</p>
                  <p className="mt-1 truncate text-[15px] font-semibold text-ink-900" dir="ltr" title={file.name}>{file.name}</p>
                  <p className="mt-0.5 text-[13px] text-ink-600" dir="ltr">
                    {formatBytes(file.size, lng)}{file.type ? ` · ${file.type.replace('image/', '').toUpperCase()}` : ''}
                  </p>
                  {source.kind === 'example' && <p className="mt-1 text-[12px] text-ink-500">{t('search.image.exampleFrom', { serial: source.serial })}</p>}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={pick} disabled={busy} className="btn-secondary h-9 px-3 text-[13px]" data-testid="replace-image">
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden /> {t('search.image.replace')}
                    </button>
                    <button type="button" onClick={() => { c.reset(); if (inputRef.current) inputRef.current.value = '' }} disabled={busy} className="btn-secondary h-9 px-3 text-[13px]" data-testid="remove-image">
                      <Trash2 className="h-3.5 w-3.5" aria-hidden /> {t('search.image.remove')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {file && <RecognitionBlock c={c} />}

          <p className="mt-3 text-[12px] leading-relaxed text-ink-500">{t('search.image.privacy')}</p>

          {errorKind && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-800" role="alert" data-testid="image-error">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p>{errorKind === 'example' ? t('search.image.examples.failed') : t(`search.image.errors.${errorKind}`, { mb: MAX_MB })}</p>
                {errorDetail && <p className="mt-0.5 break-words text-[12px] opacity-80" dir="ltr">{errorDetail}</p>}
              </div>
            </div>
          )}
        </div>

        {/* ── Options + submit ───────────────────────────────────────── */}
        <div className="flex flex-col border-t border-ink-200 bg-ink-50/40 p-5 md:border-s md:border-t-0 md:p-6">
          <h3 className="text-[15px] font-semibold text-ink-900">{t('search.image.options.title')}</h3>
          <fieldset className="mt-3 flex flex-col gap-1" disabled={busy}>
            <legend className="sr-only">{t('search.image.options.title')}</legend>
            {(['exact', 'similar', 'advanced'] as const).map((opt) => (
              <OptionRow key={opt} name={`${uid}-opt`} value={opt} current={c.option} onChange={c.setOption} title={t(`search.image.options.${opt}.title`)} text={t(`search.image.options.${opt}.text`)} />
            ))}
          </fieldset>
          {c.option === 'exact' && (
            <p className="mt-1 ps-2.5 text-[12px] text-ink-500">{t('search.image.modeExactNote', { percent: formatNumber(Math.round(IMAGE_SEARCH_EXACT_MIN_SIMILARITY * 100), lng) })}</p>
          )}
          {c.option === 'advanced' && <RefineFields c={c} />}

          <div className="mt-auto pt-5">
            <button type="button" onClick={c.run} disabled={!canSubmit} className="btn-primary h-12 w-full text-[15px]" data-testid="image-search-submit" aria-describedby={`${uid}-hint`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
              {submitLabel}
            </button>
            <p id={`${uid}-hint`} className="mt-2 min-h-[1.25rem] text-center text-[12px] text-ink-500" aria-live="polite">
              {!file && available
                ? t('search.image.needImage')
                : mode === 'intelligent' && hybridStatus.data
                  ? t('search.image.indexedNoteHybrid', {
                      text: formatNumber(hybridStatus.data.images_with_text, lng),
                      images: formatNumber(hybridStatus.data.matched_images ?? hybridStatus.data.indexed_images + hybridStatus.data.images_skipped, lng),
                      trademarks: formatNumber(hybridStatus.data.indexed_trademarks, lng),
                    })
                  : status.data?.available
                    ? t('search.image.indexedNote', { images: formatNumber(status.data.indexed_images, lng), trademarks: formatNumber(status.data.indexed_trademarks, lng) })
                    : ''}
            </p>
          </div>

          <ModeNotice c={c} />

          {status.isSuccess && !available && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900" role="status" data-testid="image-unavailable">
              <ImageOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div>
                <p className="font-medium">{t('search.image.unavailableTitle')}</p>
                <p className="mt-0.5">{t('search.image.unavailableText')}</p>
              </div>
            </div>
          )}
          {status.isError && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-800" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t('search.image.statusFailed')}</p>
                <p className="mt-0.5 break-words text-[12px] opacity-80" dir="ltr">{status.error instanceof Error ? status.error.message : String(status.error)}</p>
              </div>
              <button type="button" onClick={() => void status.refetch()} className="btn-secondary h-8 px-2.5 text-[12px]"><RefreshCw className="h-3.5 w-3.5" /> {t('common.retry')}</button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/** Which engine a search would use right now, and — in basic mode — why. */
function ModeNotice({ c }: { c: ImageSearchController }) {
  const { t } = useTranslation()
  const { mode, basicReason: reason, available, ocr } = c
  if (!available) return null
  if (mode === 'intelligent') {
    return (
      <p className="mt-3 flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50/60 p-3 text-[12px] leading-relaxed text-brand-900" data-testid="image-mode-intelligent">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{t('search.image.mode.intelligent')}</span>
      </p>
    )
  }
  const key =
    reason === 'migration_missing' ? 'migrationMissing'
    : reason === 'index_empty' ? 'indexEmpty'
    : reason === 'ocr_unsupported' ? 'ocrUnsupported'
    : reason === 'save_data' ? 'saveData'
    : 'ocrFailed'
  return (
    <p className="mt-3 flex items-start gap-2 rounded-lg border border-ink-200 bg-white p-3 text-[12px] leading-relaxed text-ink-700" role="status" data-testid="image-mode-basic" data-reason={reason ?? ''}>
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-500" aria-hidden />
      <span>
        <span className="font-semibold">{t('search.image.mode.basicTitle')}</span> {t(`search.image.mode.${key}`, { mb: OCR_DOWNLOAD_MB })}
        {reason === 'save_data' && (
          <>
            {' '}
            <button type="button" onClick={ocr.enable} className="font-semibold text-brand-700 underline underline-offset-2" data-testid="ocr-enable">
              {t('search.image.mode.enableOcr', { mb: OCR_DOWNLOAD_MB })}
            </button>
          </>
        )}
        {reason === 'ocr_failed' && (
          <>
            {' '}
            <button type="button" onClick={ocr.retry} className="font-semibold text-brand-700 underline underline-offset-2" data-testid="ocr-retry">
              {t('common.retry')}
            </button>
            {ocr.engine.status === 'failed' && <span className="mt-0.5 block break-words text-[11px] text-ink-500" dir="ltr">{ocr.engine.message}</span>}
          </>
        )}
      </span>
    </p>
  )
}

/** Recognised wording of the selected image — shown while analysing, then editable before the search. */
function RecognitionBlock({ c }: { c: ImageSearchController }) {
  const { t, i18n } = useTranslation()
  const uid = useId()
  const lng = i18n.resolvedLanguage
  const { phase, recognition, analysisNotice, mode, textSearchAvailable, busy, ocr } = c
  if (phase === 'analysing') {
    const loading = ocr.engine.status === 'loading' ? ocr.engine : null
    return (
      <div className="mt-3 rounded-lg border border-ink-200 bg-white p-3 text-[13px] text-ink-700" role="status" aria-live="polite" data-testid="recognition-loading">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-brand-600" aria-hidden />
          {loading ? t('search.image.engineLoading', { mb: OCR_DOWNLOAD_MB, percent: formatNumber(Math.round(loading.progress * 100), lng) }) : t('search.image.recognising')}
        </div>
        {loading && (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-100" aria-hidden>
            <div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${Math.max(3, Math.round(loading.progress * 100))}%` }} />
          </div>
        )}
      </div>
    )
  }
  if (!textSearchAvailable) return null
  const words = recognition?.words ?? []
  const hasText = !!recognition && recognition.text.trim().length > 0
  const confidence = recognition ? Math.round(recognition.confidence) : 0
  const level = !recognition || !words.length ? 'none' : recognition.uncertain ? 'uncertain' : 'confident'
  return (
    <div className="mt-3 rounded-lg border border-ink-200 bg-white p-3" data-testid="recognition">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={`${uid}-text`} className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-600">
          <ScanText className="h-3.5 w-3.5" aria-hidden /> {t('search.image.recognised.title')}
        </label>
        {recognition && words.length > 0 && (
          <span
            className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', level === 'confident' ? 'bg-brand-50 text-brand-800' : 'bg-amber-50 text-amber-900')}
            data-testid="recognition-confidence"
          >
            {t(level === 'confident' ? 'search.image.recognised.confident' : 'search.image.recognised.uncertain', { percent: formatNumber(confidence, lng) })}
          </span>
        )}
      </div>
      {analysisNotice === 'engine_failed' && mode !== 'intelligent' && (
        <p className="mt-2 flex items-start gap-2 text-[12px] text-amber-900" role="status" data-testid="recognition-engine-failed">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {t('search.image.recognised.engineFailed')}{' '}
            <button type="button" onClick={ocr.retry} disabled={busy} className="font-semibold underline underline-offset-2">{t('common.retry')}</button>
          </span>
        </p>
      )}
      {analysisNotice === 'ocr_failed' && (
        <p className="mt-2 text-[12px] text-amber-900" role="status">
          {t('search.image.recognised.ocrFailed')}{' '}
          <button type="button" onClick={c.reanalyse} disabled={busy} className="font-semibold underline underline-offset-2">{t('common.retry')}</button>
        </p>
      )}
      {!recognition && !analysisNotice && mode === 'basic' && c.basicReason === 'save_data' && (
        <p className="mt-2 text-[12px] text-ink-600" role="status">
          {t('search.image.recognised.optIn', { mb: OCR_DOWNLOAD_MB })}{' '}
          <button type="button" onClick={() => { ocr.enable(); c.reanalyse() }} disabled={busy} className="font-semibold text-brand-700 underline underline-offset-2">{t('search.image.mode.enableOcr', { mb: OCR_DOWNLOAD_MB })}</button>
        </p>
      )}
      {recognition && !words.length && !analysisNotice && !recognition.blank && <p className="mt-2 text-[12px] text-ink-600" data-testid="recognition-none">{t('search.image.recognised.none')}</p>}
      <input
        id={`${uid}-text`}
        type="text"
        value={recognition?.text ?? ''}
        onChange={(e) => c.setRecognisedText(e.target.value)}
        placeholder={t('search.image.recognised.placeholder')}
        className="sfield-control mt-2 h-10 w-full text-[14px]"
        dir="auto"
        autoComplete="off"
        maxLength={200}
        disabled={busy}
        data-testid="recognition-input"
      />
      <p className="mt-1 text-[11px] leading-snug text-ink-500">
        {hasText && recognition?.original && recognition.original !== recognition.text ? t('search.image.recognised.edited', { original: recognition.original }) : t('search.image.recognised.help')}
      </p>
      {recognition && recognition.variants.length > 0 && (
        <div className="mt-2">
          <label className="flex cursor-pointer items-start gap-2 text-[12px] text-ink-700">
            <input type="checkbox" checked={recognition.useVariants} onChange={(e) => c.setUseVariants(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" disabled={busy} data-testid="recognition-variants-toggle" />
            <span>
              {t('search.image.recognised.variants', { count: recognition.variants.length })}
              <span className="mt-1 flex flex-wrap gap-1" dir="auto">
                {recognition.variants.slice(0, 10).map((v) => (
                  <span key={`${v.from}-${v.text}`} className="rounded border border-ink-200 bg-ink-50 px-1.5 py-0.5 font-mono text-[11px] text-ink-700" title={t('search.image.recognised.variantFrom', { from: v.from })}>{v.text}</span>
                ))}
                {recognition.variants.length > 10 && <span className="px-1 text-[11px] text-ink-500">+{formatNumber(recognition.variants.length - 10, lng)}</span>}
              </span>
            </span>
          </label>
        </div>
      )}
    </div>
  )
}

function OptionRow({ name, value, current, onChange, title, text }: { name: string; value: ImageSearchOption; current: ImageSearchOption; onChange: (v: ImageSearchOption) => void; title: string; text: string }) {
  const on = current === value
  return (
    <label className={cn('opt', on && 'border-brand-200 bg-white shadow-sm')} data-testid={`option-${value}`}>
      <input type="radio" name={name} value={value} checked={on} onChange={() => onChange(value)} className="sr-only" />
      <span className="opt-dot" aria-hidden>{on && <span className="h-2 w-2 rounded-full bg-white" />}</span>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-ink-900">{title}</span>
        <span className="block text-[12px] leading-snug text-ink-500">{text}</span>
      </span>
    </label>
  )
}

/** Class / gazette / application-type refinement for the "Advanced search" option. */
function RefineFields({ c }: { c: ImageSearchController }) {
  const { t, i18n } = useTranslation()
  const { data: options } = useQuery(filterOptionsQuery())
  const { refine, setRefine } = c
  const counts = new Map(options?.classes.map((x) => [x.class, x.count]) ?? [])
  return (
    <div className="mt-3 rounded-lg border border-ink-200 bg-white p-3" data-testid="image-refine">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-500">{t('search.image.options.refineTitle')}</p>
      <div className="mt-2 grid gap-2">
        <div className="sfield">
          <span className="sfield-label">{t('search.advanced.fields.classes')}</span>
          <details className="group relative">
            <summary className="sfield-control flex h-10 cursor-pointer list-none items-center justify-between text-[13px] [&::-webkit-details-marker]:hidden">
              <span className={cn('truncate', !refine.classes.length && 'text-ink-400')}>
                {refine.classes.length ? t('search.advanced.classesSelected', { count: refine.classes.length, list: [...refine.classes].sort((a, b) => a - b).join(', ') }) : t('search.advanced.placeholders.classes')}
              </span>
              <ChevronDown className="h-4 w-4 text-ink-500 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="mt-2 grid grid-cols-9 gap-1">
              {ALL_CLASSES.map((cl) => {
                const on = refine.classes.includes(cl)
                const n = counts.get(cl) ?? 0
                return (
                  <button
                    key={cl}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${t('fields.class')} ${cl} (${n})`}
                    onClick={() => setRefine({ ...refine, classes: on ? refine.classes.filter((x) => x !== cl) : [...refine.classes, cl] })}
                    className={cn('h-7 rounded border text-[11px] font-semibold tabular-nums', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-brand-500')}
                  >
                    {cl}
                  </button>
                )
              })}
            </div>
          </details>
        </div>
        <label className="sfield">
          <span className="sfield-label">{t('search.advanced.fields.gazette')}</span>
          <span className="relative block">
            <select className="sfield-control h-10 text-[13px]" value={refine.gazette} onChange={(e) => setRefine({ ...refine, gazette: e.target.value })} dir="ltr">
              <option value="">{t('search.advanced.placeholders.anyGazette')}</option>
              {options?.gazettes.map((g) => <option key={g.gazette_number} value={g.gazette_number}>{g.gazette_number}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" aria-hidden />
          </span>
        </label>
        <label className="sfield">
          <span className="sfield-label">{t('search.advanced.fields.type')}</span>
          <span className="relative block">
            <select className="sfield-control h-10 text-[13px]" value={refine.type} onChange={(e) => setRefine({ ...refine, type: e.target.value })}>
              <option value="">{t('search.advanced.placeholders.anyType')}</option>
              {options?.application_types.map((a) => <option key={a.value} value={a.value}>{a.value}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" aria-hidden />
          </span>
        </label>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-ink-500">{t('search.image.options.advancedNote', { count: formatNumber(IMAGE_SEARCH_MAX_LIMIT, i18n.resolvedLanguage) })}</p>
    </div>
  )
}

function formatBytes(n: number, locale?: string) {
  if (n < 1024) return `${formatNumber(n, locale)} B`
  if (n < 1024 * 1024) return `${formatNumber(Math.round(n / 1024), locale)} KB`
  return `${new Intl.NumberFormat(locale === 'fa' ? 'fa-AF' : 'en', { maximumFractionDigits: 1 }).format(n / (1024 * 1024))} MB`
}
