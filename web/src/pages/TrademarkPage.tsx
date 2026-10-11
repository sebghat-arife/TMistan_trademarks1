import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Download, Loader2, Maximize2 } from 'lucide-react'
import { trademarkBySerialQuery, similarTrademarksQuery } from '@/services'
import { cn, formatRegistryDate, formatToday, trademarkPath } from '@/lib/utils'
import { storagePublicUrl } from '@/lib/supabase'
import { CANONICAL_URL } from '@/lib/site'
import { REPORT_DISCLAIMER, reportFileName } from '@/lib/pdf/disclaimer'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { TrademarkImage } from '@/components/TrademarkImage'
import { ImageViewer } from '@/components/ImageViewer'
import { TrademarkCard, classText } from '@/components/ResultCards'
import type { TrademarkImageRow, TrademarkRow } from '@/lib/database.types'
import { ErrorState, LoadingState } from '@/components/AsyncState'

type Tab = 'images' | 'goods' | 'history'

export function TrademarkPage() {
  const { serial = '' } = useParams()
  const [sp] = useSearchParams()
  const gazetteHint = sp.get('g')
  const { t, i18n } = useTranslation()
  const { data, isLoading, isError, error, refetch } = useQuery(trademarkBySerialQuery(serial, gazetteHint))

  const tm = data?.trademark
  const images = data?.images ?? []
  const [viewerOpen, setViewerOpen] = useState(false)
  const [imageIndex, setImageIndex] = useState(0)
  const [tab, setTab] = useState<Tab>('images')
  const report = useRecordDownload()

  const { data: similar } = useQuery({ ...similarTrademarksQuery(tm?.id ?? ''), enabled: !!tm })

  const title = tm ? `${tm.mark_name ?? tm.serial_number} (${tm.serial_number}) — ${t('app.shortName')}` : t('app.name')
  const description = tm
    ? `${t('fields.mark')} ${tm.mark_name ?? ''}, ${t('fields.serial')} ${tm.serial_number}, ${t('fields.gazette')} ${tm.official_gazette_number}${tm.applicant_name ? `, ${t('fields.applicant')} ${tm.applicant_name}` : ''}.`
    : undefined
  useDocumentTitle(title, description)

  if (isLoading) return <div className="container-x py-10"><LoadingState lines={6} /></div>
  if (isError) return <div className="container-x py-10"><ErrorState error={error} onRetry={() => void refetch()} /></div>
  if (!tm) {
    return (
      <div className="container-x py-10">
        <div className="card p-8 text-center">
          <p className="text-[15px] font-medium text-ink-900">{t('trademark.notFound')}</p>
          <p className="mt-1 font-mono text-xs text-ink-500">{serial}</p>
          <Link to="/search" className="btn-secondary mt-4">{t('trademark.backToSearch')}</Link>
        </div>
      </div>
    )
  }

  const lng = i18n.resolvedLanguage
  const current = images[imageIndex] ?? images[0]
  const name = tm.mark_name ?? t('fields.unnamed')
  const na = t('fields.notProvided')
  const hasHistory = !!(tm.old_owner || tm.new_owner || tm.old_address || tm.new_address)
  const sourceLine =
    tm.source_page != null
      ? t('trademark.source', { gazette: tm.official_gazette_number, page: tm.source_page })
      : t('trademark.sourceNoPage', { gazette: tm.official_gazette_number })

  return (
    <div className="container-x py-6">
      {/* ── Breadcrumb + Download ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[14px] text-ink-500">
          <Link to="/" className="hover:text-brand-600">{t('trademark.home')}</Link>
          <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
          <Link to="/search" className="hover:text-brand-600">{t('trademark.searchResults')}</Link>
          <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
          <span className="bidi-auto text-ink-900">{name} ({tm.serial_number})</span>
        </nav>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => void report.download(tm, current, sourceLine)}
            disabled={report.status === 'working'}
            title={t('trademark.record.hint')}
            aria-busy={report.status === 'working'}
            className="btn-outline-green h-9 px-4 text-[13px] disabled:cursor-progress disabled:opacity-70"
          >
            {report.status === 'working' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            {report.status === 'working' ? t('trademark.record.preparing') : t('trademark.download')}
          </button>
          {report.status === 'error' && (
            <p role="alert" className="text-[12px] text-red-700">
              {t('trademark.record.failed')}{' '}
              <button type="button" onClick={() => void report.download(tm, current, sourceLine)} className="font-medium underline underline-offset-2">{t('common.retry')}</button>
            </p>
          )}
        </div>
      </div>

      {/* ── Main two-column block ────────────────────────────────────── */}
      <div className="card mt-4 grid gap-8 p-5 md:grid-cols-[380px_1fr] md:p-6">
        {/* Images */}
        <div>
          <button
            type="button"
            onClick={() => images.length && setViewerOpen(true)}
            disabled={!images.length}
            className="group relative block w-full overflow-hidden rounded-lg border border-ink-200 bg-white"
            aria-label={t('trademark.openImage')}
          >
            <TrademarkImage
              bucket={current?.storage_bucket}
              path={current?.storage_path}
              variant="full"
              alt={name}
              fallbackLabel={t('trademark.noImage')}
              loading="eager"
              className="aspect-[4/3] w-full !bg-white p-5"
              plain
            />
            {images.length > 0 && (
              <span className="absolute bottom-2 end-2 hidden items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-[12px] font-medium text-ink-700 shadow group-hover:inline-flex">
                <Maximize2 className="h-3.5 w-3.5" /> {t('trademark.zoom')}
              </span>
            )}
          </button>
          {images.length > 1 && (
            <ul className="mt-3 flex gap-3" aria-label={t('trademark.tabs.images', { count: images.length })}>
              {images.map((img, i) => (
                <li key={img.id}>
                  <button
                    type="button"
                    onClick={() => setImageIndex(i)}
                    aria-pressed={i === imageIndex}
                    className={cn('block h-[72px] w-[92px] overflow-hidden rounded-md border bg-white p-1 transition-colors', i === imageIndex ? 'border-brand-600 ring-1 ring-brand-600' : 'border-ink-200 hover:border-ink-400')}
                  >
                    <TrademarkImage bucket={img.storage_bucket} path={img.storage_path} thumbnailPath={img.thumbnail_path} alt={t(`trademark.imageType.${img.image_type}`)} className="h-full w-full !bg-white" plain />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Facts */}
        <div className="min-w-0">
          <h1 className="bidi-auto text-[26px] font-bold leading-tight text-ink-900">{name}</h1>
          {tm.mark_print && tm.mark_print !== tm.mark_name && <p className="bidi-auto mt-1 text-[14px] text-ink-500">{t('fields.markPrint')}: {tm.mark_print}</p>}

          <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <Fact label={t('fields.serialNumber')} mono>{tm.serial_number}</Fact>
            <Fact label={t('fields.class')}>{classText(tm.class_numbers, tm.trademark_class, na)}</Fact>
            <Fact label={t('fields.publicationDate')}>{tm.publication_date ? formatRegistryDate(tm.publication_date, lng) : na}</Fact>
            {tm.objection_deadline && <Fact label={t('fields.objectionDeadline')}>{formatRegistryDate(tm.objection_deadline, lng)}</Fact>}
            {tm.record_number && <Fact label={t('fields.recordNumber')} mono>{tm.record_number}</Fact>}
          </dl>

          <dl className="mt-5 space-y-4 border-t border-ink-100 pt-5">
            <Fact label={t('fields.applicant')}>{tm.applicant_name || na}</Fact>
            <Fact label={t('fields.address')}>{tm.applicant_address || na}</Fact>
            <Fact label={t('fields.goods')}><span className="line-clamp-3">{tm.goods_and_services || na}</span></Fact>
            <Fact label={t('fields.applicationType')}>{tm.application_type || na}</Fact>
          </dl>

          {/* Source information: Official Gazette number + page only */}
          <div className="mt-5 border-t border-ink-100 pt-5">
            <h2 className="text-[15px] font-semibold text-ink-900">{t('trademark.sourceInformation')}</h2>
            <p className="mt-1.5 text-[14px] text-ink-700">{sourceLine}</p>
          </div>
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <div className="card mt-4">
        <div className="flex gap-6 border-b border-ink-200 px-5" role="tablist">
          {(['images', 'goods', 'history'] as Tab[]).map((k) => (
            <button
              key={k}
              role="tab"
              type="button"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn('-mb-px border-b-2 py-3 text-[14px] font-medium transition-colors', tab === k ? 'border-brand-600 text-brand-600' : 'border-transparent text-ink-600 hover:text-ink-900')}
            >
              {k === 'images' ? t('trademark.tabs.images', { count: images.length }) : t(`trademark.tabs.${k}`)}
            </button>
          ))}
        </div>
        <div className="p-5 text-[14px] leading-relaxed text-ink-800">
          {tab === 'images' &&
            (images.length ? (
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {images.map((img, i) => (
                  <li key={img.id}>
                    <button type="button" onClick={() => { setImageIndex(i); setViewerOpen(true) }} className="block w-full overflow-hidden rounded-md border border-ink-200 bg-white p-2 hover:border-brand-500">
                      <TrademarkImage bucket={img.storage_bucket} path={img.storage_path} thumbnailPath={img.thumbnail_path} alt={t(`trademark.imageType.${img.image_type}`)} className="h-28 w-full !bg-white" plain />
                    </button>
                    <div className="mt-1.5 flex items-center justify-between text-[12px] text-ink-500">
                      <span>{t(`trademark.imageType.${img.image_type}`)}</span>
                      {img.width && img.height && <span className="tabular-nums" dir="ltr">{img.width}×{img.height}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-500">{t('trademark.noImage')}</p>
            ))}
          {tab === 'goods' && <p className="bidi-auto whitespace-pre-line">{tm.goods_and_services || na}</p>}
          {tab === 'history' &&
            (hasHistory ? (
              <dl className="grid gap-4 sm:grid-cols-2">
                {tm.old_owner && <Fact label={t('fields.oldOwner')}>{tm.old_owner}</Fact>}
                {tm.new_owner && <Fact label={t('fields.newOwner')}>{tm.new_owner}</Fact>}
                {tm.old_address && <Fact label={t('fields.oldAddress')}>{tm.old_address}</Fact>}
                {tm.new_address && <Fact label={t('fields.newAddress')}>{tm.new_address}</Fact>}
              </dl>
            ) : (
              <p className="text-ink-500">{t('trademark.noHistory')}</p>
            ))}
        </div>
      </div>

      {/* ── Similar ──────────────────────────────────────────────────── */}
      {similar && similar.length > 0 && (
        <section className="card mt-4 p-5 md:p-6">
          <h2 className="text-[18px] font-semibold text-ink-900">{t('trademark.similar')}</h2>
          <p className="muted mt-0.5">{t('trademark.similarHint')}</p>
          <ul className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            {similar.slice(0, 4).map((r) => (
              <li key={r.id} className="flex"><TrademarkCard r={r} className="w-full" /></li>
            ))}
          </ul>
        </section>
      )}

      <ImageViewer images={images} index={imageIndex} open={viewerOpen} onOpenChange={setViewerOpen} onIndexChange={setImageIndex} title={name} />
    </div>
  )
}

function Fact({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-ink-500">{label}</dt>
      <dd className={cn('bidi-auto mt-0.5 text-[15px] text-ink-900', mono && 'tabular-nums')}>{children}</dd>
    </div>
  )
}

/* ── Download Record ─────────────────────────────────────────────────────
 * Generates a real PDF file ("TMistan Trademark Publication Report") in the
 * browser and downloads it. The PDF engine is loaded on demand (code-split),
 * so it costs nothing until the button is used. The document contains exactly
 * the recorded fields shown on this page (N/A when not recorded), the
 * approved disclaimer and the canonical record link — nothing invented.
 * ---------------------------------------------------------------------- */

type DownloadStatus = 'idle' | 'working' | 'error'

function useRecordDownload() {
  const { t, i18n } = useTranslation()
  const [status, setStatus] = useState<DownloadStatus>('idle')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const download = async (tm: TrademarkRow, image: TrademarkImageRow | undefined, sourceLine: string) => {
    if (status === 'working') return
    setStatus('working')
    try {
      const lng = i18n.resolvedLanguage ?? 'en'
      const dir = i18n.dir(lng) === 'rtl' ? 'rtl' : 'ltr'
      const na = t('fields.notProvided')
      const mod = await import('@/lib/pdf/trademarkReport') // code-split PDF engine
      const src = storagePublicUrl(image?.storage_bucket, image?.storage_path)
      const [logo, pictureData] = await Promise.all([fetchLogo(), src ? mod.imageToPngDataUrl(src) : Promise.resolve(null)])
      const picture = { data: pictureData, failed: !!src && !pictureData }

      const rows: { label: string; value: string }[] = [
        { label: t('fields.mark'), value: tm.mark_name || na },
        { label: t('fields.serialNumber'), value: tm.serial_number },
        { label: t('fields.applicant'), value: tm.applicant_name || na },
        { label: t('fields.address'), value: tm.applicant_address || na },
        { label: t('fields.class'), value: classText(tm.class_numbers, tm.trademark_class, na) },
        { label: t('fields.goods'), value: tm.goods_and_services || na },
        { label: t('fields.applicationType'), value: tm.application_type || na },
        { label: t('fields.publicationDate'), value: tm.publication_date ? formatRegistryDate(tm.publication_date, lng) : na },
      ]
      if (tm.mark_print && tm.mark_print !== tm.mark_name) rows.splice(1, 0, { label: t('fields.markPrint'), value: tm.mark_print })
      if (tm.objection_deadline) rows.push({ label: t('fields.objectionDeadline'), value: formatRegistryDate(tm.objection_deadline, lng) })
      if (tm.record_number) rows.push({ label: t('fields.recordNumber'), value: tm.record_number })
      if (tm.old_owner) rows.push({ label: t('fields.oldOwner'), value: tm.old_owner })
      if (tm.new_owner) rows.push({ label: t('fields.newOwner'), value: tm.new_owner })
      if (tm.old_address) rows.push({ label: t('fields.oldAddress'), value: tm.old_address })
      if (tm.new_address) rows.push({ label: t('fields.newAddress'), value: tm.new_address })
      rows.push({ label: t('fields.gazette'), value: tm.official_gazette_number })
      rows.push({ label: t('trademark.sourceInformation'), value: sourceLine })

      const generated = formatToday(lng)

      await mod.downloadTrademarkReport({
        dir,
        labels: {
          platformName: t('app.shortName'),
          tagline: t('home.hero.lead'),
          documentTitle: t('trademark.record.title'),
          generated: t('trademark.record.generated', { date: generated }),
          serial: t('fields.serialNumber'),
          source: t('trademark.sourceInformation'),
          details: t('trademark.record.details'),
          image: t('trademark.record.image'),
          imageUnavailable: t('trademark.record.imageUnavailable'),
          disclaimerTitle: t('trademark.record.disclaimer'),
          recordLink: t('trademark.record.link'),
          page: (n, total) => t('trademark.record.page', { page: n, total }),
        },
        markName: tm.mark_name || na,
        serial: tm.serial_number,
        sourceLine,
        rows,
        disclaimer: REPORT_DISCLAIMER,
        link: `${CANONICAL_URL}${trademarkPath(tm.serial_number, tm.official_gazette_number)}`,
        logo,
        image: picture.data,
        imageFailed: picture.failed,
        fileName: reportFileName(tm.serial_number),
      })
      if (alive.current) setStatus('idle')
    } catch (err) {
      console.error('[TMistan] PDF report failed', err)
      if (alive.current) setStatus('error')
    }
  }

  return { status, download }
}

let logoCache: Promise<string | null> | null = null
function fetchLogo(): Promise<string | null> {
  logoCache ??= (async () => {
    try {
      const url = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}brand/logo.png`
      const res = await fetch(url)
      if (!res.ok) return null
      const blob = await res.blob()
      return await new Promise<string | null>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(blob)
      })
    } catch {
      return null
    }
  })()
  return logoCache
}

export { trademarkPath }
