import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ImageIcon, ImageOff, Loader2, RefreshCw, ScanSearch, Upload, X } from 'lucide-react'
import { imageSearchStatusQuery, searchTrademarksByDescriptor, type ImageSearchResult } from '@/services'
import { ImageDecodeError, MAX_QUERY_IMAGE_BYTES, describeImage, validateQueryFile } from '@/lib/imageSearch/descriptor'
import { cn, formatNumber } from '@/lib/utils'
import { TrademarkCard } from './ResultCards'
import { EmptyState } from './AsyncState'

/**
 * Search by Image.
 *
 * The visitor picks (or drops) a picture of a logo; it is decoded and reduced
 * to a visual descriptor in this browser (lib/imageSearch/descriptor.ts) and
 * only that vector is sent to the database, which returns the published
 * trademarks whose indexed image is most similar. The picture itself is never
 * uploaded or stored anywhere.
 */

type Phase = 'idle' | 'analysing' | 'searching' | 'done'
type ErrorKind = 'invalidType' | 'tooLarge' | 'decode' | 'failed' | null

const MAX_MB = Math.round(MAX_QUERY_IMAGE_BYTES / (1024 * 1024))

export function ImageSearchPanel({ className }: { className?: string }) {
  const { t, i18n } = useTranslation()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [errorKind, setErrorKind] = useState<ErrorKind>(null)
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [results, setResults] = useState<ImageSearchResult[] | null>(null)
  const runRef = useRef(0)

  const status = useQuery(imageSearchStatusQuery())
  const available = status.data?.available ?? false

  // object URL for the preview — derived from the file, revoked when it changes
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const reset = () => {
    runRef.current += 1
    setFile(null)
    setResults(null)
    setPhase('idle')
    setErrorKind(null)
    setErrorDetail(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const choose = (f: File | null | undefined) => {
    if (!f) return
    runRef.current += 1
    setResults(null)
    setPhase('idle')
    setErrorDetail(null)
    const v = validateQueryFile(f)
    if (v !== 'ok') {
      setFile(null)
      setErrorKind(v === 'size' ? 'tooLarge' : 'invalidType')
      return
    }
    setErrorKind(null)
    setFile(f)
  }

  const run = async () => {
    if (!file || !available) return
    const token = ++runRef.current
    setErrorKind(null)
    setErrorDetail(null)
    setResults(null)
    setPhase('analysing')
    try {
      const descriptor = await describeImage(file)
      if (token !== runRef.current) return
      setPhase('searching')
      const rows = await searchTrademarksByDescriptor(descriptor)
      if (token !== runRef.current) return
      setResults(rows)
      setPhase('done')
    } catch (e) {
      if (token !== runRef.current) return
      setPhase('idle')
      if (e instanceof ImageDecodeError) setErrorKind('decode')
      else {
        setErrorKind('failed')
        setErrorDetail(e instanceof Error ? e.message : String(e))
      }
    }
  }

  const busy = phase === 'analysing' || phase === 'searching'
  const lng = i18n.resolvedLanguage

  return (
    <section className={cn('mx-auto max-w-3xl', className)} aria-labelledby={`${inputId}-title`}>
      <div className="card p-5 md:p-6">
        <h2 id={`${inputId}-title`} className="text-[18px] font-semibold text-ink-900">{t('search.image.title')}</h2>
        <p className="muted mt-1">{t('search.image.lead')}</p>

        {/* Availability */}
        {status.isSuccess && !available && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-[14px] text-amber-900" role="status">
            <ImageOff className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">{t('search.image.unavailableTitle')}</p>
              <p className="mt-0.5">{t('search.image.unavailableText')}</p>
            </div>
          </div>
        )}
        {status.isError && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-[14px] text-red-800" role="alert">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t('search.image.statusFailed')}</p>
              <p className="mt-0.5 break-words text-[13px] opacity-80">{status.error instanceof Error ? status.error.message : String(status.error)}</p>
            </div>
            <button type="button" onClick={() => void status.refetch()} className="btn-secondary h-8 px-3 text-[13px]"><RefreshCw className="h-3.5 w-3.5" /> {t('common.retry')}</button>
          </div>
        )}

        {/* Drop zone / preview */}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
          className="sr-only"
          onChange={(e) => choose(e.target.files?.[0])}
          disabled={busy}
        />
        {!file ? (
          <label
            htmlFor={inputId}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); choose(e.dataTransfer.files?.[0]) }}
            className={cn(
              'mt-5 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
              dragOver ? 'border-brand-500 bg-brand-50' : 'border-ink-300 bg-ink-50/40 hover:border-brand-400 hover:bg-brand-50/40',
            )}
            data-testid="image-dropzone"
          >
            <span className="icon-circle h-12 w-12"><Upload className="h-5 w-5" aria-hidden /></span>
            <span className="mt-3 text-[15px] font-medium text-ink-900">{t('search.image.dropTitle')}</span>
            <span className="muted mt-1">
              {t('search.image.dropOr')} <span className="font-medium text-brand-600 underline underline-offset-2">{t('search.image.browse')}</span>
            </span>
            <span className="mt-3 text-[12px] text-ink-500">{t('search.image.formats', { mb: MAX_MB })}</span>
          </label>
        ) : (
          <div className="mt-5 flex flex-col gap-4 rounded-xl border border-ink-200 bg-white p-4 sm:flex-row sm:items-center" data-testid="image-preview">
            <div className="flex h-36 w-full shrink-0 items-center justify-center overflow-hidden rounded-lg border border-ink-100 bg-white p-2 sm:w-48">
              {previewUrl ? <img src={previewUrl} alt={t('search.image.previewAlt')} className="max-h-full max-w-full object-contain" /> : <ImageIcon className="h-8 w-8 text-ink-300" aria-hidden />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium text-ink-900" dir="ltr">{file.name}</p>
              <p className="muted mt-0.5" dir="ltr">{formatBytes(file.size, lng)}{file.type ? ` · ${file.type}` : ''}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="btn-secondary h-9 px-3 text-[13px]">
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden /> {t('search.image.replace')}
                </button>
                <button type="button" onClick={reset} disabled={busy} className="btn-secondary h-9 px-3 text-[13px]">
                  <X className="h-3.5 w-3.5" aria-hidden /> {t('search.image.remove')}
                </button>
              </div>
            </div>
          </div>
        )}

        <p className="mt-3 text-[12px] text-ink-500">{t('search.image.privacy')}</p>

        {/* Errors */}
        {errorKind && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[14px] text-red-800" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p>{t(`search.image.errors.${errorKind}`, { mb: MAX_MB })}</p>
              {errorDetail && <p className="mt-0.5 break-words text-[12px] opacity-80">{errorDetail}</p>}
            </div>
          </div>
        )}

        {/* Action */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void run()} disabled={!file || busy || !available} className="btn-primary h-11 px-5 text-[15px]" data-testid="image-search-submit">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ScanSearch className="h-4 w-4" aria-hidden />}
            {phase === 'analysing' ? t('search.image.analysing') : phase === 'searching' ? t('search.image.searching') : t('search.image.submit')}
          </button>
          {status.data?.available && (
            <span className="text-[12px] text-ink-500">
              {t('search.image.indexedNote', { images: formatNumber(status.data.indexed_images, lng), trademarks: formatNumber(status.data.indexed_trademarks, lng) })}
            </span>
          )}
        </div>
      </div>

      {/* Results */}
      {phase === 'done' && results && (
        <div className="mt-6" aria-live="polite">
          {results.length === 0 ? (
            <EmptyState title={t('search.image.noResults')} hint={t('search.image.noResultsHint')} />
          ) : (
            <>
              <p className="text-[15px] text-ink-800">
                <span className="font-semibold">{t('search.image.resultsFound', { count: results.length })}</span>
              </p>
              <p className="muted mt-1">{t('search.image.indicatorNote')}</p>
              <ul className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3" data-testid="image-results">
                {results.map((r) => (
                  <li key={r.id} className="relative flex">
                    <TrademarkCard r={r} className="w-full" />
                    <SimilarityBadge value={r.similarity} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function SimilarityBadge({ value }: { value: number }) {
  const { t, i18n } = useTranslation()
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  const level = value >= 0.8 ? 'high' : value >= 0.65 ? 'moderate' : 'low'
  return (
    <span
      className={cn(
        'pointer-events-none absolute end-3 top-3 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums shadow-sm',
        level === 'high' ? 'bg-brand-600 text-white' : level === 'moderate' ? 'bg-amber-100 text-amber-900' : 'bg-ink-100 text-ink-700',
      )}
      title={t(`search.image.level.${level}`)}
      dir="ltr"
    >
      {t('search.image.similarity', { percent: formatNumber(pct, i18n.resolvedLanguage) })}
    </span>
  )
}

function formatBytes(n: number, locale?: string) {
  if (n < 1024) return `${formatNumber(n, locale)} B`
  if (n < 1024 * 1024) return `${formatNumber(Math.round(n / 1024), locale)} KB`
  return `${new Intl.NumberFormat(locale === 'fa' ? 'fa-AF' : locale === 'ps' ? 'ps-AF' : 'en', { maximumFractionDigits: 1 }).format(n / (1024 * 1024))} MB`
}
