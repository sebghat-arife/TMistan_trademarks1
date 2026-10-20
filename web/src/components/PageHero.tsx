import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ArchitecturalArch, CornerAccent } from './ornament'

/**
 * Hero band shared by the informational pages. The decorative artwork is a
 * CSS background (aria-hidden) so the text column stays fully accessible and
 * nothing is downloaded on small screens.
 */
export function PageHero({
  eyebrow,
  title,
  children,
  actions,
  imagePosition = '70% 50%',
  imageOpacity = 0.5,
  motif = 'photo',
  accent = false,
  className,
}: {
  eyebrow: string
  title: string
  children?: ReactNode
  actions?: ReactNode
  imagePosition?: string
  imageOpacity?: number
  /** End-side artwork: the archival photograph (default), the line-art arch, lattice only, or nothing. */
  motif?: 'photo' | 'arch' | 'none'
  /** Thin architectural corner frame at the top-start corner (selected pages only). */
  accent?: boolean
  className?: string
}) {
  const style = { '--hero-pos': imagePosition, '--hero-opacity': imageOpacity } as CSSProperties
  return (
    <section className={cn('page-hero', className)} style={style}>
      {accent && <CornerAccent corner="top-start" size={200} className="hidden lg:block" />}
      {motif === 'photo' && <div className="page-hero-photo" aria-hidden />}
      {motif === 'arch' && (
        <div className="page-hero-arch" aria-hidden>
          <ArchitecturalArch className="h-full w-auto text-brand-700" />
        </div>
      )}
      <div className="container-x relative py-12 md:py-16">
        <div className="max-w-2xl">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-3 font-serif text-[34px] font-semibold leading-[1.1] tracking-[-0.015em] text-navy-900 sm:text-[42px] lg:text-[48px]">{title}</h1>
          <div className="mt-5 space-y-3 text-[16px] leading-relaxed text-ink-700 md:text-[17px]">{children}</div>
          {actions && <div className="mt-7 flex flex-wrap gap-3">{actions}</div>}
        </div>
      </div>
    </section>
  )
}

/** Section heading used on the informational pages: optional number badge + serif title + lead. */
export function SectionTitle({ number, title, lead, id, className }: { number?: number; title: string; lead?: ReactNode; id?: string; className?: string }) {
  return (
    <div className={cn('flex items-start gap-4', className)}>
      {number !== undefined && <span className="num-badge mt-0.5" aria-hidden>{number}</span>}
      <div className="min-w-0">
        <h2 id={id} className="font-serif text-[26px] font-semibold leading-tight tracking-[-0.01em] text-navy-900 md:text-[30px]">{title}</h2>
        {lead && <div className="mt-2 text-[15px] leading-relaxed text-ink-600">{lead}</div>}
      </div>
    </div>
  )
}
