import { useCallback, useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronLeft, ChevronRight, Download, Maximize2, Minus, Plus, RotateCcw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { storagePublicUrl } from '@/lib/supabase'
import type { TrademarkImageRow } from '@/lib/database.types'
import { cn } from '@/lib/utils'

interface Props {
  images: TrademarkImageRow[]
  index: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onIndexChange: (i: number) => void
  title: string
}

const ZOOM_STEPS = [1, 1.5, 2, 3, 4, 6]

/** Fullscreen zoomable viewer: wheel/buttons to zoom, drag to pan, ←/→ to switch. */
export function ImageViewer({ images, index, open, onOpenChange, onIndexChange, title }: Props) {
  const { t } = useTranslation()
  const img = images[index]
  const src = img ? storagePublicUrl(img.storage_bucket, img.storage_path) : null
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const frame = useRef<HTMLDivElement>(null)

  const reset = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  useEffect(() => {
    reset()
  }, [index, open, reset])

  const zoomTo = (z: number) => {
    const clamped = Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], Math.max(1, z))
    setZoom(clamped)
    if (clamped === 1) setPan({ x: 0, y: 0 })
  }
  const zoomIn = () => zoomTo(ZOOM_STEPS.find((s) => s > zoom + 0.01) ?? zoom)
  const zoomOut = () => zoomTo([...ZOOM_STEPS].reverse().find((s) => s < zoom - 0.01) ?? 1)

  const prev = useCallback(() => onIndexChange((index - 1 + images.length) % images.length), [index, images.length, onIndexChange])
  const next = useCallback(() => onIndexChange((index + 1) % images.length), [index, images.length, onIndexChange])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === '+' || e.key === '=') zoomIn()
      else if (e.key === '-') zoomOut()
      else if (e.key === '0') reset()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    if (e.deltaY < 0) zoomIn()
    else zoomOut()
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom === 1) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    setPan({ x: drag.current.px + (e.clientX - drag.current.x), y: drag.current.py + (e.clientY - drag.current.y) })
  }
  const onPointerUp = () => {
    drag.current = null
  }

  const requestFullscreen = () => {
    const el = frame.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen?.()
  }

  if (!img) return null

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink-900/90 backdrop-blur-[2px]" />
        <Dialog.Content
          ref={frame}
          className="fixed inset-0 z-50 flex flex-col bg-ink-900 text-white outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
            <Dialog.Title className="truncate text-sm font-medium">
              <span className="bidi-auto">{title}</span>
              <span className="ms-2 text-white/50">
                {t(`trademark.imageType.${img.image_type}`)} · {index + 1}/{images.length}
              </span>
            </Dialog.Title>
            <div className="flex items-center gap-1">
              <ViewerBtn onClick={zoomOut} label={t('trademark.zoom')} disabled={zoom <= 1}><Minus className="h-4 w-4" /></ViewerBtn>
              <span className="w-12 text-center text-xs tabular-nums text-white/70">{Math.round(zoom * 100)}%</span>
              <ViewerBtn onClick={zoomIn} label={t('trademark.zoom')} disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}><Plus className="h-4 w-4" /></ViewerBtn>
              <ViewerBtn onClick={reset} label="Reset" disabled={zoom === 1}><RotateCcw className="h-4 w-4" /></ViewerBtn>
              <ViewerBtn onClick={requestFullscreen} label={t('trademark.fullscreen')}><Maximize2 className="h-4 w-4" /></ViewerBtn>
              {src && (
                <a href={src} download target="_blank" rel="noreferrer" className="rounded-md p-2 hover:bg-white/10" aria-label={t('trademark.download')} title={t('trademark.download')}>
                  <Download className="h-4 w-4" />
                </a>
              )}
              <Dialog.Close className="ms-1 rounded-md p-2 hover:bg-white/10" aria-label={t('trademark.close')}>
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>
          </div>

          <div
            className={cn('relative flex flex-1 items-center justify-center overflow-hidden select-none', zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in')}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={() => (zoom === 1 ? zoomTo(2) : reset())}
          >
            {src && (
              <img
                src={src}
                alt={title}
                draggable={false}
                style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transition: drag.current ? 'none' : 'transform 120ms ease-out' }}
                className="max-h-[calc(100vh-7rem)] max-w-[calc(100vw-2rem)] object-contain will-change-transform"
              />
            )}
            {images.length > 1 && (
              <>
                <button type="button" onClick={prev} className="absolute start-3 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 hover:bg-black/60" aria-label={t('search.prev')}>
                  <ChevronLeft className="h-5 w-5 rtl:rotate-180" />
                </button>
                <button type="button" onClick={next} className="absolute end-3 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 hover:bg-black/60" aria-label={t('search.next')}>
                  <ChevronRight className="h-5 w-5 rtl:rotate-180" />
                </button>
              </>
            )}
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-white/10 px-4 py-1.5 text-xs text-white/60">
            <span className="truncate font-mono">{img.storage_path}</span>
            <span className="shrink-0 tabular-nums">
              {img.width && img.height ? `${img.width}×${img.height}` : ''}
              {img.byte_size ? ` · ${(img.byte_size / 1024).toFixed(0)} KB` : ''}
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ViewerBtn({ onClick, label, disabled, children }: { onClick: () => void; label: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="rounded-md p-2 hover:bg-white/10 disabled:opacity-30">
      {children}
    </button>
  )
}
