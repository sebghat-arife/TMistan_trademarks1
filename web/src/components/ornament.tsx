import { useId, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

/* ---------------------------------------------------------------------------
 * TMistan ornament library — restrained, architectural linework inspired by
 * Afghan tilework and carved framing. Original vector geometry drawn for this
 * project (no reproduction of a historic artefact).
 *
 * Principles (design board "Background & footer patterns"):
 *   – generous negative space: one oversized motif in a corner, never a wallpaper
 *   – hairlines (1 px, non-scaling) in emerald / muted turquoise / navy
 *   – purely decorative: aria-hidden, focusable="false", pointer-events none
 *   – no raster images, no animation, no external URLs
 *
 *   GirihMotif      large eight-fold rosette — page corner, dark promo sections
 *   CornerAccent    thin stepped corner frame with a small rosette — selected headers / panels
 *   OrnamentalBand  narrow frieze (rosettes + cartouches between two rules) — footer
 *   StarMotif       small eight-point star — labels, icons, dividers
 *   StarDivider     hairline with the star at its centre
 *   ArchitecturalArch  line-art pointed arch — Services header, Home feature band
 * ------------------------------------------------------------------------- */

/* Eight-point star outlines (two squares) at three radii, centred on 0,0. */
const STAR_22 =
  'M0 -22L6.44 -15.55L15.56 -15.56L15.55 -6.44L22 0L15.55 6.44L15.56 15.56L6.44 15.55L0 22L-6.44 15.55L-15.56 15.56L-15.55 6.44L-22 0L-15.55 -6.44L-15.56 -15.56L-6.44 -15.55Z'
const STAR_9 =
  'M0 -9L2.63 -6.36L6.36 -6.36L6.36 -2.63L9 0L6.36 2.63L6.36 6.36L2.63 6.36L0 9L-2.63 6.36L-6.36 6.36L-6.36 2.63L-9 0L-6.36 -2.63L-6.36 -6.36L-2.63 -6.36Z'
const STAR_6 =
  'M0 -6L1.76 -4.24L4.24 -4.24L4.24 -1.76L6 0L4.24 1.76L4.24 4.24L1.76 4.24L0 6L-1.76 4.24L-4.24 4.24L-4.24 1.76L-6 0L-4.24 -1.76L-4.24 -4.24L-1.76 -4.24Z'
/* Same star on a 24×24 box (for the inline StarMotif). */
const STAR_24 =
  'M12 0L15.51 3.51H20.49V8.49L24 12L20.49 15.51V20.49H15.51L12 24L8.49 20.49H3.51V15.51L0 12L3.51 8.49V3.51H8.49Z'
const OCTAGON_24 = 'M15.4 12L14.4 14.4L12 15.4L9.6 14.4L8.6 12L9.6 9.6L12 8.6L14.4 9.6Z'

/* Girih rosette, viewBox -100 … 100: core star + octagon, 16-gon ring, petal star,
 * outer 16-point star with its inner ring, and radial spokes. */
const GIRIH = {
  core: `${STAR_22}M4.4 -10.62L10.62 -4.4L10.62 4.4L4.4 10.62L-4.4 10.62L-10.62 4.4L-10.62 -4.4L-4.4 -10.62Z`,
  ring:
    'M0 -46L17.6 -42.5L32.53 -32.53L42.5 -17.6L46 0L42.5 17.6L32.53 32.53L17.6 42.5L0 46L-17.6 42.5L-32.53 32.53L-42.5 17.6L-46 0L-42.5 -17.6L-32.53 -32.53L-17.6 -42.5Z' +
    'M0 -60L17.6 -42.5L42.43 -42.43L42.5 -17.6L60 0L42.5 17.6L42.43 42.43L17.6 42.5L0 60L-17.6 42.5L-42.43 42.43L-42.5 17.6L-60 0L-42.5 -17.6L-42.43 -42.43L-17.6 -42.5Z',
  outer:
    'M0 -96L14.05 -70.62L36.74 -88.69L40 -59.87L67.88 -67.88L59.87 -40L88.69 -36.74L70.62 -14.05L96 0L70.62 14.05L88.69 36.74L59.87 40L67.88 67.88L40 59.87L36.74 88.69L14.05 70.62L0 96L-14.05 70.62L-36.74 88.69L-40 59.87L-67.88 67.88L-59.87 40L-88.69 36.74L-70.62 14.05L-96 0L-70.62 -14.05L-88.69 -36.74L-59.87 -40L-67.88 -67.88L-40 -59.87L-36.74 -88.69L-14.05 -70.62Z' +
    'M14.05 -70.62L40 -59.87L59.87 -40L70.62 -14.05L70.62 14.05L59.87 40L40 59.87L14.05 70.62L-14.05 70.62L-40 59.87L-59.87 40L-70.62 14.05L-70.62 -14.05L-59.87 -40L-40 -59.87L-14.05 -70.62Z',
  spokes:
    'M0 -22L0 -46M0 -60L0 -96M15.56 -15.56L32.53 -32.53M42.43 -42.43L67.88 -67.88M22 0L46 0M60 0L96 0M15.56 15.56L32.53 32.53M42.43 42.43L67.88 67.88M0 22L0 46M0 60L0 96M-15.56 15.56L-32.53 32.53M-42.43 42.43L-67.88 67.88M-22 0L-46 0M-60 0L-96 0M-15.56 -15.56L-32.53 -32.53M-42.43 -42.43L-67.88 -67.88',
}

type Corner = 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end'

function svgId(raw: string, prefix: string) {
  return prefix + raw.replace(/[^a-zA-Z0-9_-]/g, '')
}

/**
 * Large eight-fold girih rosette, cropped into one corner of its positioned
 * parent (`position: relative` + `overflow: hidden`). Hairlines in
 * `currentColor`; keep `opacity` low (≈ 0.06 on ivory, ≈ 0.1 on navy).
 * `size` is the rosette diameter in px; `offset` pulls it out of the frame so
 * roughly half of it shows (0.5 = centre on the corner).
 */
export function GirihMotif({
  corner = 'bottom-end',
  size = 720,
  offset = 0.42,
  opacity = 0.07,
  detail = 'full',
  className,
  style,
}: {
  corner?: Corner
  size?: number
  offset?: number
  opacity?: number
  /** `full` = all rings, `ring` = outer geometry only (quieter). */
  detail?: 'full' | 'ring'
  className?: string
  style?: CSSProperties
}) {
  const shift = `${-Math.round(size * offset)}px`
  const pos: CSSProperties = {
    width: size,
    height: size,
    opacity,
    ...(corner.startsWith('top') ? { top: shift } : { bottom: shift }),
    ...(corner.endsWith('start') ? { insetInlineStart: shift } : { insetInlineEnd: shift }),
    ...style,
  }
  return (
    <svg viewBox="-100 -100 200 200" className={cn('pointer-events-none absolute', className)} style={pos} aria-hidden focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth={1} strokeLinejoin="round" vectorEffect="non-scaling-stroke">
        <path d={GIRIH.outer} vectorEffect="non-scaling-stroke" />
        <path d={GIRIH.spokes} vectorEffect="non-scaling-stroke" />
        {detail === 'full' && (
          <>
            <path d={GIRIH.ring} vectorEffect="non-scaling-stroke" />
            <path d={GIRIH.core} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </g>
    </svg>
  )
}

/**
 * Thin architectural corner frame: an outer L along two edges, an inner stepped
 * L and a small rosette near the corner. Emerald + muted turquoise by default.
 * Place inside a positioned parent; `corner` picks the edges it hugs. Use it on
 * a few page headers / promotional panels only.
 */
export function CornerAccent({
  corner = 'top-end',
  size = 180,
  opacity = 0.9,
  primary = 'var(--color-brand-600)',
  secondary = 'var(--color-turquoise-400)',
  className,
}: {
  corner?: Corner
  size?: number
  opacity?: number
  primary?: string
  secondary?: string
  className?: string
}) {
  /* Drawn for the top-end corner (lines along the top and the end edge); other
   * corners mirror the artwork. RTL flips the horizontal mirror automatically
   * because `inset-inline-*` follows the writing direction. */
  const { i18n } = useTranslation()
  const flipX = corner.endsWith('start') !== (i18n.dir() === 'rtl')
  const flipY = corner.startsWith('bottom')
  const style: CSSProperties = {
    width: size,
    height: size,
    opacity,
    top: flipY ? undefined : 0,
    bottom: flipY ? 0 : undefined,
    insetInlineEnd: corner.endsWith('start') ? undefined : 0,
    insetInlineStart: corner.endsWith('start') ? 0 : undefined,
    transform: `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`,
  }
  return (
    <svg viewBox="0 0 180 180" className={cn('pointer-events-none absolute', className)} style={style} aria-hidden focusable="false">
      <g fill="none" strokeWidth={1} strokeLinejoin="round" strokeLinecap="square" vectorEffect="non-scaling-stroke">
        {/* outer frame line along the two edges */}
        <path d="M8 6H174V172" stroke={primary} vectorEffect="non-scaling-stroke" />
        {/* inner stepped line */}
        <path d="M44 18H150V30H162V140" stroke={secondary} vectorEffect="non-scaling-stroke" />
        <path d="M70 30H138V42H150V110" stroke={secondary} vectorEffect="non-scaling-stroke" strokeOpacity={0.7} />
        {/* small rosette tucked into the corner */}
        <g transform="translate(130 58)" stroke={primary}>
          <path d={STAR_9} vectorEffect="non-scaling-stroke" />
          <circle r={2.6} vectorEffect="non-scaling-stroke" />
        </g>
        {/* three short ticks finishing the inner line (carved-frame detail) */}
        <path d="M150 122H158M150 130H158M150 138H158" stroke={secondary} vectorEffect="non-scaling-stroke" strokeOpacity={0.7} />
      </g>
    </svg>
  )
}

/**
 * Narrow ornamental frieze: two hairlines with alternating small rosettes and
 * long hexagonal cartouches, widely spaced. The footer's signature detail;
 * also usable as a section divider. 22 px tall, stretches to its container.
 */
export function OrnamentalBand({
  className,
  primary = 'var(--color-brand-600)',
  secondary = 'var(--color-turquoise-400)',
  opacity = 0.85,
  style,
}: {
  className?: string
  primary?: string
  secondary?: string
  opacity?: number
  style?: CSSProperties
}) {
  const id = svgId(useId(), 'band')
  const W = 184
  return (
    <svg className={cn('pointer-events-none block w-full', className)} height={22} style={{ opacity, ...style }} aria-hidden focusable="false">
      <defs>
        <pattern id={id} width={W} height={22} patternUnits="userSpaceOnUse" x="50%">
          <g fill="none" strokeWidth={0.9} strokeLinejoin="round">
            {/* rules */}
            <path d={`M0 2.5H${W}M0 19.5H${W}`} stroke={secondary} strokeOpacity={0.8} />
            {/* rosettes on the tile seam (drawn at both ends so the repeat completes them) */}
            <g transform="translate(0 11)" stroke={primary}>
              <path d={STAR_6} />
            </g>
            <g transform={`translate(${W} 11)`} stroke={primary}>
              <path d={STAR_6} />
            </g>
            {/* elongated cartouche with a centre point */}
            <path d="M26 11L36 5.5H148L158 11L148 16.5H36Z" stroke={secondary} />
            <circle cx={92} cy={11} r={1.6} fill={primary} stroke="none" />
            <path d="M14 11H20M164 11H170" stroke={secondary} />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="22" fill={`url(#${id})`} />
    </svg>
  )
}

/**
 * Small eight-point star. Inline (not positioned) for labels, badges, dividers.
 */
export function StarMotif({
  size = 16,
  className,
  variant = 'outline',
  strokeWidth = 1.25,
  style,
}: {
  size?: number
  className?: string
  /** `outline` = stroked star with inner octagon, `solid` = filled star, `dot` = filled star with a hollow centre. */
  variant?: 'outline' | 'solid' | 'dot'
  strokeWidth?: number
  style?: CSSProperties
}) {
  return (
    <svg width={size} height={size} viewBox="-1.5 -1.5 27 27" className={cn('pointer-events-none inline-block shrink-0', className)} style={style} aria-hidden focusable="false">
      {variant === 'outline' ? (
        <>
          <path d={STAR_24} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d={OCTAGON_24} fill="none" stroke="currentColor" strokeWidth={strokeWidth * 0.8} strokeLinejoin="round" />
        </>
      ) : variant === 'solid' ? (
        <path d={STAR_24} fill="currentColor" />
      ) : (
        <path d={`${STAR_24} ${OCTAGON_24}`} fill="currentColor" fillRule="evenodd" />
      )}
    </svg>
  )
}

/** Hairline with the star at its centre — a quiet section transition. */
export function StarDivider({ className, tone = 'muted' }: { className?: string; tone?: 'muted' | 'brand' | 'light' }) {
  const color = tone === 'brand' ? 'text-brand-600' : tone === 'light' ? 'text-white/40' : 'text-turquoise-400'
  const line = tone === 'light' ? 'bg-white/15' : tone === 'brand' ? 'bg-brand-200' : 'bg-ink-200'
  return (
    <div className={cn('flex items-center gap-4', color, className)} aria-hidden>
      <span className={cn('h-px flex-1', line)} />
      <StarMotif size={12} variant="outline" />
      <span className={cn('h-px flex-1', line)} />
    </div>
  )
}

/**
 * Line-art pointed arch: outer and inner arch, a large rosette in the opening,
 * spring lines and a stepped base. Hairlines stay 1 px at any size.
 */
export function ArchitecturalArch({ className, rosette = true, style }: { className?: string; rosette?: boolean; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 200 250" className={cn('pointer-events-none block', className)} style={style} aria-hidden focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth={1} strokeLinejoin="round" strokeLinecap="round">
        <path d="M14 238V96Q14 30 100 10Q186 30 186 96V238" vectorEffect="non-scaling-stroke" />
        <path d="M34 238V98Q34 44 100 28Q166 44 166 98V238" vectorEffect="non-scaling-stroke" />
        <path d="M14 112H34M166 112H186" vectorEffect="non-scaling-stroke" />
        <path d="M4 238H196M10 246H190" vectorEffect="non-scaling-stroke" />
        {rosette && (
          <g transform="translate(100 112) scale(1.6)">
            <path d={STAR_22} vectorEffect="non-scaling-stroke" />
            <path d="M4.4 -10.62L10.62 -4.4L10.62 4.4L4.4 10.62L-4.4 10.62L-10.62 4.4L-10.62 -4.4L-4.4 -10.62Z" vectorEffect="non-scaling-stroke" />
            <path d="M0 -22L0 -34M22 0L34 0M0 22L0 34M-22 0L-34 0" vectorEffect="non-scaling-stroke" />
          </g>
        )}
      </g>
    </svg>
  )
}
