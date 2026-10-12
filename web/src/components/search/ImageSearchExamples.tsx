import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ScanSearch } from 'lucide-react'
import { imageSearchExamplesQuery, type ImageSearchExample } from '@/services'
import { cn } from '@/lib/utils'
import { TrademarkImage } from '@/components/TrademarkImage'
import { classText } from '@/components/ResultCards'

/**
 * "Example searches": real trademark images already published in this
 * database (never stock logos). Clicking a tile runs the image search with
 * that picture, so visitors can see how the feature behaves before uploading.
 */
export function ImageSearchExamples({ onPick, disabled, className }: { onPick: (ex: ImageSearchExample) => void; disabled?: boolean; className?: string }) {
  const { t } = useTranslation()
  const q = useQuery(imageSearchExamplesQuery(6))
  if (q.isError || (q.isSuccess && q.data.length === 0)) return null
  return (
    <section className={cn(className)} aria-labelledby="examples-title" data-testid="image-examples">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="examples-title" className="text-[17px] font-semibold text-ink-900">{t('search.image.examples.title')}</h2>
          <p className="mt-0.5 text-[13px] text-ink-500">{t('search.image.examples.lead')}</p>
        </div>
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {q.isLoading
          ? Array.from({ length: 6 }).map((_, i) => <li key={i} className="card h-[136px] animate-pulse bg-ink-50" aria-hidden />)
          : q.data?.map((ex) => {
              const name = ex.trademark.mark_name ?? t('fields.unnamed')
              return (
                <li key={ex.image.id} className="flex">
                  <button
                    type="button"
                    onClick={() => onPick(ex)}
                    disabled={disabled}
                    className="card group flex w-full flex-col items-stretch p-3 text-start transition-shadow hover:border-brand-300 hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)] focus-visible:border-brand-500 disabled:opacity-60"
                    aria-label={`${t('search.image.examples.try')}: ${name} (${ex.trademark.serial_number})`}
                    data-testid="image-example"
                  >
                    <TrademarkImage bucket={ex.image.storage_bucket} path={ex.image.storage_path} thumbnailPath={ex.image.thumbnail_path} alt="" className="h-[72px] w-full rounded-md !bg-white" imgClassName="max-h-[64px]" plain />
                    <span className="bidi-auto mt-2 truncate text-[13px] font-semibold text-ink-900">{name}</span>
                    <span className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-ink-500">
                      <span className="tabular-nums" dir="ltr">{ex.trademark.serial_number}</span>
                      <span className="truncate">{t('fields.class')} {classText(ex.trademark.class_numbers, ex.trademark.trademark_class, '—')}</span>
                    </span>
                    <span className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      <ScanSearch className="h-3.5 w-3.5" aria-hidden /> {t('search.image.examples.try')}
                    </span>
                  </button>
                </li>
              )
            })}
      </ul>
    </section>
  )
}
