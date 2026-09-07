import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { storagePublicUrl } from '@/lib/supabase'

interface Props {
  bucket: string | null | undefined
  /** Full-size object path in storage. */
  path: string | null | undefined
  /** Optional thumbnail path; used when `variant` is `thumb` and it exists. */
  thumbnailPath?: string | null
  variant?: 'thumb' | 'full'
  alt: string
  className?: string
  imgClassName?: string
  /** Text shown in the empty/broken state. */
  fallbackLabel?: string
  loading?: 'lazy' | 'eager'
  /** Plain white background (cards) instead of the transparency checkerboard (viewer). */
  plain?: boolean
}

/**
 * Renders a trademark logo without distortion (object-contain on a fixed box),
 * with a skeleton while loading and an honest "no image" state on error.
 */
export function TrademarkImage({
  bucket,
  path,
  thumbnailPath,
  variant = 'thumb',
  alt,
  className,
  imgClassName,
  fallbackLabel,
  loading = 'lazy',
  plain = false,
}: Props) {
  const src = variant === 'thumb' ? (storagePublicUrl(bucket, thumbnailPath) ?? storagePublicUrl(bucket, path)) : storagePublicUrl(bucket, path)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>(src ? 'loading' : 'error')

  useEffect(() => {
    setState(src ? 'loading' : 'error')
  }, [src])

  return (
    <div className={cn('relative flex items-center justify-center overflow-hidden', plain ? 'bg-white' : 'checker', className)}>
      {src && state !== 'error' && (
        <img
          src={src}
          alt={alt}
          loading={loading}
          decoding="async"
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
          className={cn(
            'max-h-full max-w-full object-contain transition-opacity duration-200',
            state === 'loading' ? 'opacity-0' : 'opacity-100',
            imgClassName,
          )}
        />
      )}
      {state === 'loading' && <div className="absolute inset-0 animate-pulse bg-ink-100" aria-hidden />}
      {state === 'error' && (
        <div className="flex flex-col items-center justify-center gap-1 p-2 text-center text-ink-400">
          {fallbackLabel ? (
            <span className="bidi-auto line-clamp-2 font-serif text-xl italic tracking-wide text-ink-700">{fallbackLabel}</span>
          ) : (
            <ImageOff className="h-5 w-5" aria-hidden />
          )}
        </div>
      )}
    </div>
  )
}
