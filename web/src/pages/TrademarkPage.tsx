import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertCircle, BadgeCheck, ChevronRight, CircleDashed, Download, Maximize2, ShieldCheck } from 'lucide-react'
import { trademarkBySerialQuery, similarTrademarksQuery } from '@/services'
import { cn, formatRegistryDate, gazettePath, trademarkPath } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { TrademarkImage } from '@/components/TrademarkImage'
import { ImageViewer } from '@/components/ImageViewer'
import { TrademarkCard, classText } from '@/components/ResultCards'
import type { TrademarkRow } from '@/lib/database.types'
import { ErrorState, LoadingState } from '@/components/AsyncState'

type Tab = 'images' | 'goods' | 'history' | 'notes'

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
  const hasHistory = !!(tm.old_owner || tm.new_owner || tm.old_address || tm.new_address)

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
        <a href={recordDownloadHref(tm)} download={`TMistan-${tm.official_gazette_number}-${tm.serial_number}.json`} className="btn-outline-green h-9 px-4 text-[13px]">
          <Download className="h-4 w-4" /> {t('trademark.download')}
        </a>
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
              fallbackLabel={tm.mark_name ?? tm.serial_number}
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
          {images.length > 0 && (
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
          {!images.length && <p className="muted mt-3">{t('trademark.noImage')}</p>}
        </div>

        {/* Facts */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="bidi-auto text-[26px] font-bold leading-tight text-ink-900">{name}</h1>
            <ReviewBadge status={tm.review_status} />
          </div>
          {tm.mark_print && tm.mark_print !== tm.mark_name && <p className="bidi-auto mt-1 text-[14px] text-ink-500">{t('fields.markPrint')}: {tm.mark_print}</p>}

          <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <Fact label={t('fields.serialNumber')} mono>{tm.serial_number}</Fact>
            <Fact label={t('fields.gazetteNumber')}>
              <Link to={gazettePath(tm.official_gazette_number)} className="text-brand-600 hover:underline">{tm.official_gazette_number}</Link>
            </Fact>
            <Fact label={t('fields.publicationDate')}>{formatRegistryDate(tm.publication_date, lng) || t('fields.notProvided')}</Fact>
            <Fact label={t('fields.class')}>{classText(tm.class_numbers, tm.trademark_class)}</Fact>
            {tm.objection_deadline && <Fact label={t('fields.objectionDeadline')}>{formatRegistryDate(tm.objection_deadline, lng)}</Fact>}
            {tm.record_number && <Fact label={t('fields.recordNumber')} mono>{tm.record_number}</Fact>}
          </dl>

          <dl className="mt-5 space-y-4 border-t border-ink-100 pt-5">
            <Fact label={t('fields.applicant')}>{tm.applicant_name || t('fields.notProvided')}</Fact>
            <Fact label={t('fields.address')}>{tm.applicant_address || t('fields.notProvided')}</Fact>
            <Fact label={t('fields.goods')}><span className="line-clamp-3">{tm.goods_and_services || t('fields.notProvided')}</span></Fact>
            <Fact label={t('fields.attorney')}>{tm.attorney_or_representative || t('fields.notProvided')}</Fact>
            <Fact label={t('fields.applicationType')}>{tm.application_type || t('fields.notProvided')}</Fact>
          </dl>

          {/* Source information */}
          <div className="mt-5 border-t border-ink-100 pt-5">
            <h2 className="text-[15px] font-semibold text-ink-900">{t('trademark.sourceInformation')}</h2>
            <p className="mt-1.5 text-[14px] text-ink-700">
              <span>{t('fields.gazette')} <Link to={gazettePath(tm.official_gazette_number)} className="text-brand-600 hover:underline">{tm.official_gazette_number}</Link></span>
              {tm.source_page != null && <> · {t('fields.page')} {tm.source_page}</>}
              {tm.source_row != null && <> · {t('fields.row')} {tm.source_row}</>}
            </p>
            {(tm.source_file || tm.source_sheet) && (
              <p className="mt-0.5 break-all text-[13px] text-ink-500" dir="ltr">
                {tm.source_file && <>{t('fields.file')}: {tm.source_file}</>}
                {tm.source_sheet && <> · {t('fields.sheet')}: {tm.source_sheet}</>}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <div className="card mt-4">
        <div className="flex gap-6 border-b border-ink-200 px-5" role="tablist">
          {(['images', 'goods', 'history', 'notes'] as Tab[]).map((k) => (
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
              <p className="text-ink-500">{t('trademark.noImage')} — {t('trademark.noImageHint')}</p>
            ))}
          {tab === 'goods' && <p className="bidi-auto whitespace-pre-line">{tm.goods_and_services || t('fields.notProvided')}</p>}
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
          {tab === 'notes' &&
            (tm.review_note ? (
              <p className="bidi-auto whitespace-pre-line">{tm.review_note}</p>
            ) : (
              <p className="text-ink-500">{t('trademark.noNotes')}</p>
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

export function ReviewBadge({ status }: { status: TrademarkRow['review_status'] }) {
  const { t } = useTranslation()
  const styles: Record<TrademarkRow['review_status'], string> = {
    verified: 'bg-brand-50 text-brand-700 border-brand-200',
    reviewed: 'bg-brand-50 text-brand-700 border-brand-200',
    unreviewed: 'bg-ink-100 text-ink-600 border-ink-200',
    needs_correction: 'bg-amber-50 text-amber-800 border-amber-200',
  }
  const icons = { verified: ShieldCheck, reviewed: BadgeCheck, unreviewed: CircleDashed, needs_correction: AlertCircle } as const
  const Icon = icons[status]
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-[12px] font-semibold', styles[status])}>
      <Icon className="h-3.5 w-3.5" /> {t(`trademark.review.${status}`)}
    </span>
  )
}

/** Client-side JSON export of the record (no extra endpoint; the data is already loaded). */
function recordDownloadHref(tm: TrademarkRow): string {
  const { search_vector: _sv, ...rest } = tm as TrademarkRow & { search_vector?: unknown }
  void _sv
  return 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(rest, null, 2))
}

export { trademarkPath }
