import { useId, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'

/* ---------------------------------------------------------------------------
 * TMistan ornament library — original geometric SVG motifs inspired by the
 * star-and-cross lattices, pointed arches and bordered friezes of Afghan
 * architecture. Everything is plain vector geometry drawn for this project
 * (no reproduction of a historic artefact), tinted through `currentColor` so
 * the same component works on ivory, navy or emerald surfaces.
 *
 * Rules shared by every motif:
 *   – purely decorative: `aria-hidden`, `focusable="false"`, `pointer-events: none`
 *   – no raster images, no animation, no external URLs
 *   – crisp on HiDPI (vector `<pattern>` tiles), cheap to paint
 * ------------------------------------------------------------------------- */

/* Eight-point star (two overlapping squares) drawn as one 16-vertex outline on
 * a 64×64 tile. Neighbouring tiles meet tip-to-tip at the edge midpoints, so the
 * voids between four stars form the classic cross of a star-and-cross lattice. */
const STAR_64 =
  'M32 0L41.37 9.37H54.63V22.63L64 32L54.63 41.37V54.63H41.37L32 64L22.63 54.63H9.37V41.37L0 32L9.37 22.63V9.37H22.63Z'
/* Small octagon in the heart of each star (the "detail" layer). */
const OCTAGON_64 = 'M41 32L38.36 38.36L32 41L25.64 38.36L23 32L25.64 25.64L32 23L38.36 25.64Z'
/* Same star scaled to a 24×24 box for the standalone motif. */
const STAR_24 =
  'M12 0L15.51 3.51H20.49V8.49L24 12L20.49 15.51V20.49H15.51L12 24L8.49 20.49H3.51V15.51L0 12L3.51 8.49V3.51H8.49Z'
const OCTAGON_24 = 'M15.4 12L14.4 14.4L12 15.4L9.6 14.4L8.6 12L9.6 9.6L12 8.6L14.4 9.6Z'

type Fade = 'none' | 'bottom' | 'top' | 'start' | 'end' | 'radial' | 'corner'
const FADE: Record<Fade, string | undefined> = {
  none: undefined,
  bottom: 'orn-fade-bottom',
  top: 'orn-fade-top',
  start: 'orn-fade-start',
  end: 'orn-fade-end',
  radial: 'orn-fade-radial',
  corner: 'orn-fade-corner',
}

function svgId(raw: string, prefix: string) {
  return prefix + raw.replace(/[^a-zA-Z0-9_-]/g, '')
}

/**
 * A — Geometric lattice. Fills its positioned parent (`position: relative`
 * required) with a tiling star-and-cross pattern in `currentColor`.
 * Use for page-header backgrounds, section backgrounds, feature panels and
 * empty states. `size` is the tile size in CSS px; `opacity` keeps it quiet.
 */
export function GeometricLattice({
  className,
  size = 64,
  opacity = 0.08,
  strokeWidth = 1,
  detail = true,
  fade = 'none',
  style,
}: {
  className?: string
  size?: number
  opacity?: number
  strokeWidth?: number
  /** Draw the inner octagons as well as the stars. */
  detail?: boolean
  /** Soft mask so the pattern dissolves instead of ending on a hard edge. */
  fade?: Fade
  style?: CSSProperties
}) {
  const id = svgId(useId(), 'lattice')
  return (
    <svg className={cn('pointer-events-none absolute inset-0 h-full w-full', FADE[fade], className)} style={{ opacity, ...style }} aria-hidden focusable="false">
      <defs>
        <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse" viewBox="0 0 64 64">
          <path d={STAR_64} fill="none" stroke="currentColor" strokeWidth={strokeWidth * (64 / size)} strokeLinejoin="round" />
          {detail && <path d={OCTAGON_64} fill="none" stroke="currentColor" strokeWidth={strokeWidth * 0.85 * (64 / size)} strokeLinejoin="round" />}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}

/**
 * B — Signature eight-point star. Inline (not positioned) so it can sit in
 * labels, dividers, badges and empty states. Sized through `size`/className.
 */
export function StarMotif({
  size = 16,
  className,
  variant = 'outline',
  strokeWidth = 1.5,
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

/** Thin rule with the star at its centre — a quiet section transition. */
export function StarDivider({ className, tone = 'muted' }: { className?: string; tone?: 'muted' | 'brand' | 'light' }) {
  const color = tone === 'brand' ? 'text-brand-600' : tone === 'light' ? 'text-white/40' : 'text-turquoise-400'
  const line = tone === 'light' ? 'bg-white/15' : tone === 'brand' ? 'bg-brand-200' : 'bg-turquoise-200'
  return (
    <div className={cn('flex items-center gap-3', color, className)} aria-hidden>
      <span className={cn('h-px flex-1', line)} />
      <StarMotif size={14} variant="outline" />
      <span className={cn('h-px flex-1', line)} />
    </div>
  )
}

/**
 * D — Decorative border: a fine repeating frieze (chain of lozenges between two
 * hairlines) for footer separators, section transitions and card details.
 * Horizontal by default; `vertical` rotates the strip for side rails.
 */
export function DecorativeBorder({
  className,
  thickness = 12,
  vertical = false,
  variant = 'chain',
  style,
}: {
  className?: string
  /** Strip height (or width when vertical) in px. */
  thickness?: number
  vertical?: boolean
  /** `chain` = lozenges with hairlines, `zigzag` = single running line, `dots` = evenly spaced stars. */
  variant?: 'chain' | 'zigzag' | 'dots'
  style?: CSSProperties
}) {
  const id = svgId(useId(), 'border')
  const w = vertical ? thickness : undefined
  const h = vertical ? undefined : thickness
  return (
    <svg
      className={cn('pointer-events-none block', vertical ? 'h-full' : 'w-full', className)}
      width={w}
      height={h}
      style={style}
      aria-hidden
      focusable="false"
    >
      <defs>
        <pattern id={id} width={24} height={12} patternUnits="userSpaceOnUse" patternTransform={vertical ? 'rotate(90)' : undefined}>
          {variant === 'chain' && (
            <>
              <path d="M0 6L6 1.5L12 6L18 1.5L24 6M0 6L6 10.5L12 6L18 10.5L24 6" fill="none" stroke="currentColor" strokeWidth={1} strokeLinejoin="round" />
              <circle cx={6} cy={6} r={1} fill="currentColor" />
              <circle cx={18} cy={6} r={1} fill="currentColor" />
            </>
          )}
          {variant === 'zigzag' && <path d="M0 9L6 3L12 9L18 3L24 9" fill="none" stroke="currentColor" strokeWidth={1} strokeLinejoin="round" />}
          {variant === 'dots' && <path d="M12 2.5L13.4 4H15.5V6.1L17 7.5L15.5 8.9V11H13.4L12 12.5L10.6 11H8.5V8.9L7 7.5L8.5 6.1V4H10.6Z" fill="currentColor" transform="translate(0 -1.5)" />}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}

/**
 * C — Architectural arch: line-art pointed arch with an inner arch and a lattice
 * infill, a star keystone and a stepped base. Scales with its container.
 */
export function ArchitecturalArch({
  className,
  strokeWidth = 1.25,
  lattice = true,
  style,
}: {
  className?: string
  strokeWidth?: number
  /** Fill the inner opening with the lattice pattern. */
  lattice?: boolean
  style?: CSSProperties
}) {
  const uid = useId()
  const clip = svgId(uid, 'archclip')
  const pat = svgId(uid, 'archpat')
  return (
    <svg viewBox="0 0 200 250" className={cn('pointer-events-none block', className)} style={style} aria-hidden focusable="false">
      <defs>
        <clipPath id={clip}>
          <path d="M34 238V98Q34 44 100 28Q166 44 166 98V238Z" />
        </clipPath>
        <pattern id={pat} width={32} height={32} patternUnits="userSpaceOnUse" viewBox="0 0 64 64">
          <path d={STAR_64} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
        </pattern>
      </defs>
      <g fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round">
        {/* outer arch */}
        <path d="M14 238V96Q14 30 100 10Q186 30 186 96V238" />
        {/* inner arch */}
        <path d="M34 238V98Q34 44 100 28Q166 44 166 98V238" />
        {/* spring line and base steps */}
        <path d="M14 112H34M166 112H186" />
        <path d="M4 238H196M10 246H190" />
        {/* keystone star */}
        <path d={STAR_24} transform="translate(92.8 11.8) scale(0.6)" />
      </g>
      {lattice && <rect x={34} y={28} width={132} height={210} fill={`url(#${pat})`} clipPath={`url(#${clip})`} opacity={0.55} />}
    </svg>
  )
}
