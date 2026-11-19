import { useEffect, useRef, useState } from 'react'
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
  /** Small caption under the icon in the empty/broken state (e.g. "No image on file"). */
  fallbackLabel?: string
  loading?: 'lazy' | 'eager'
  /** Resource priority hint; 'high' for the largest above-the-fold image (record page). */
  fetchPriority?: 'high' | 'low' | 'auto'
  /** Plain white background (cards) instead of the transparency checkerboard (viewer). */
  plain?: boolean
}

/**
 * Renders a trademark logo without distortion (object-contain on a fixed box),
 * with a skeleton while loading and an honest "no image" state on error.
 *
 * The skeleton sits *behind* the image and the image is never hidden with CSS: on a
 * prerendered page the picture usually finishes loading before React hydrates, and
 * React does not replay `load` events that fired before hydration. The effect below
 * therefore also reads `img.complete` after mount (Phase 3 audit finding: on slow
 * connections the record image stayed invisible under the skeleton).
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
  fetchPriority,
  plain = false,
}: Props) {
  const src = variant === 'thumb' ? (storagePublicUrl(bucket, thumbnailPath) ?? storagePublicUrl(bucket, path)) : storagePublicUrl(bucket, path)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>(src ? 'loading' : 'error')
  const ref = useRef<HTMLImageElement>(null)

  useEffect(() => {
    if (!src) {
      setState('error')
      return
    }
    const el = ref.current
    // Already complete (loaded before hydration, or from the browser cache): no load event will follow.
    if (el && el.complete) setState(el.naturalWidth > 0 ? 'ok' : 'error')
    else setState('loading')
  }, [src])

  return (
    <div className={cn('relative flex items-center justify-center overflow-hidden', plain ? 'bg-white' : 'checker', className)}>
      {state === 'loading' && <div className="absolute inset-0 animate-pulse bg-ink-100" aria-hidden />}
      {src && state !== 'error' && (
        <img
          ref={ref}
          src={src}
          alt={alt}
          loading={loading}
          fetchPriority={fetchPriority}
          decoding="async"
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
          className={cn('relative max-h-full max-w-full object-contain', imgClassName)}
        />
      )}
      {state === 'error' && (
        <div className="flex flex-col items-center justify-center gap-1 p-2 text-center text-ink-400">
          <ImageOff className="h-5 w-5" aria-hidden />
          {fallbackLabel && <span className="line-clamp-2 text-[11px] leading-tight">{fallbackLabel}</span>}
        </div>
      )}
    </div>
  )
}
