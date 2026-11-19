import { cn } from '@/lib/utils'

interface Props {
  /** `dark` renders the white-text variant for the footer / admin sidebar. */
  variant?: 'light' | 'dark'
  className?: string
}

/**
 * The TMistan logo supplied by the client (public/brand/): `logo.png` is the colour version
 * with the "Trademarks in Afghanistan" tagline, `logo-white.png` the same artwork with the black
 * elements turned white for dark surfaces, `logo-mono.png` the single-colour black version.
 * The header/footer use 480 px derivatives of the same files (`*-480.png`, ~26 KB instead of
 * ~105 KB — the 1600 px originals stay for Open Graph, structured data and the PDF report).
 */
export function Logo({ variant = 'light', className }: Props) {
  return (
    <img
      src={variant === 'dark' ? '/brand/logo-white-480.png' : '/brand/logo-480.png'}
      alt="TMistan — Trademarks in Afghanistan"
      width={480}
      height={246}
      decoding="async"
      className={cn('h-10 w-auto select-none', className)}
      draggable={false}
    />
  )
}
