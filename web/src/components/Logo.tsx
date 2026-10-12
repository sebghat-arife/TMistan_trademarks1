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
 */
export function Logo({ variant = 'light', className }: Props) {
  return (
    <img
      src={variant === 'dark' ? '/brand/logo-white.png' : '/brand/logo.png'}
      alt="TMistan — Trademarks in Afghanistan"
      width={1600}
      height={820}
      decoding="async"
      className={cn('h-10 w-auto select-none', className)}
      draggable={false}
    />
  )
}
