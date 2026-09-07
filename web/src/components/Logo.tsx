import { cn } from '@/lib/utils'

interface Props {
  /** `dark` renders the white-text variant for the footer / admin sidebar. */
  variant?: 'light' | 'dark'
  className?: string
}

/** The TMistan wordmark supplied by the client (public/brand/logo*.png). */
export function Logo({ variant = 'light', className }: Props) {
  return (
    <img
      src={variant === 'dark' ? '/brand/logo-white.png' : '/brand/logo.png'}
      alt="TMistan"
      width={1271}
      height={615}
      decoding="async"
      className={cn('h-10 w-auto select-none', className)}
      draggable={false}
    />
  )
}
