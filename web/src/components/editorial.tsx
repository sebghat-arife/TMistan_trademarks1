import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/* Shared building blocks for the editorial pages (Legal, Knowledge Center, Data Corrections).
 * They follow the client mock-ups: split hero with an angled photograph, labelled sections,
 * pale-green icon badges, sidebar panels and a closing banner. */

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('section-label', className)}>{children}</p>
}

export type Benefit = { Icon: LucideIcon; title: string; text: string }

export function SplitHero({
  label,
  title,
  text,
  benefits,
  image,
  imagePosition = '60% 50%',
  actions,
  testId,
}: {
  label: string
  title: string
  text: string | string[]
  benefits?: Benefit[]
  image: string
  imagePosition?: string
  actions?: ReactNode
  testId?: string
}) {
  const style = { '--hero-img': `url('${image}')`, '--hero-pos': imagePosition } as CSSProperties
  const paragraphs = Array.isArray(text) ? text : [text]
  return (
    <section className="split-hero" style={style} data-testid={testId}>
      <div className="split-hero-media" aria-hidden />
      <div className="split-hero-band" aria-hidden />
      <div className="container-x relative py-12 md:py-14 lg:py-16">
        <div className="max-w-[560px]">
          <SectionLabel>{label}</SectionLabel>
          <h1 className="mt-3 font-serif text-[36px] font-semibold leading-[1.08] tracking-[-0.015em] text-navy-900 sm:text-[44px] lg:text-[50px]">{title}</h1>
          <div className="mt-5 space-y-3 text-[15.5px] leading-relaxed text-ink-700 md:text-[16px]">
            {paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
          {actions && <div className="mt-6 flex flex-wrap gap-3">{actions}</div>}
          {benefits && benefits.length > 0 && (
            <ul className={cn('mt-8 grid gap-x-4 gap-y-5', benefits.length === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-4')}>
              {benefits.map(({ Icon, title: bt, text: btx }, i) => (
                <li key={bt} className={cn('min-w-0 border-ink-200 pe-2', i % 2 === 1 && 'border-s ps-4', i > 0 && 'sm:border-s sm:ps-4', i > 0 && 'sm:pe-3')}>
                  <Icon className="h-6 w-6 text-brand-600" aria-hidden strokeWidth={1.75} />
                  <p className="mt-2 text-[13px] font-semibold text-ink-900">{bt}</p>
                  <p className="mt-0.5 text-[12px] leading-snug text-ink-500">{btx}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

export function SectionHeading({ label, title, text, id, className, children }: { label: string; title: string; text?: string; id?: string; className?: string; children?: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-4 md:flex-row md:items-end md:justify-between', className)}>
      <div className="max-w-2xl">
        <SectionLabel>{label}</SectionLabel>
        <h2 id={id} className="ed-h2 mt-2">{title}</h2>
        {text && <p className="mt-2 text-[15px] leading-relaxed text-ink-600">{text}</p>}
      </div>
      {children}
    </div>
  )
}

export function IconBadge({ Icon, size = 'md', className }: { Icon: LucideIcon; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const dims = size === 'lg' ? 'h-14 w-14' : size === 'sm' ? 'h-9 w-9' : 'h-11 w-11'
  const icon = size === 'lg' ? 'h-6 w-6' : size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
  return (
    <span className={cn('icon-circle', dims, className)}>
      <Icon className={icon} aria-hidden strokeWidth={1.75} />
    </span>
  )
}

/** Card with icon, serif title, text and an optional link (whole card clickable when `to` is set). */
export function FeatureCard({ Icon, title, text, to, linkLabel, arrow, onClick, selected, className, testId }: { Icon: LucideIcon; title: string; text: string; to?: string; linkLabel?: string; /** Arrow only (no link text) at the bottom of the card. */ arrow?: boolean; onClick?: () => void; selected?: boolean; className?: string; testId?: string }) {
  const body = (
    <>
      <IconBadge Icon={Icon} />
      <h3 className="ed-title mt-4">{title}</h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-600">{text}</p>
      {linkLabel ? (
        <span className="link-green mt-4 inline-flex items-center gap-1.5">
          {linkLabel}
          <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
        </span>
      ) : arrow ? (
        <span className="mt-auto pt-4 text-brand-600" aria-hidden>
          <ArrowRight className="h-4 w-4 rtl:-scale-x-100" />
        </span>
      ) : null}
    </>
  )
  const cls = cn('ed-card flex h-full flex-col text-start', selected && 'border-brand-600 ring-1 ring-brand-600', className)
  if (to) return <Link to={to} className={cls} data-testid={testId}>{body}</Link>
  if (onClick) return <button type="button" onClick={onClick} className={cls} aria-pressed={selected} data-testid={testId}>{body}</button>
  return <div className={cls} data-testid={testId}>{body}</div>
}

export function InfoBanner({ Icon, title, children, tone = 'green', className }: { Icon: LucideIcon; title: string; children: ReactNode; tone?: 'green' | 'amber'; className?: string }) {
  return (
    <div className={cn('relative flex gap-4 overflow-hidden rounded-xl border p-5', tone === 'green' ? 'border-brand-100 bg-brand-50/70' : 'border-amber-200 bg-amber-50/80', className)}>
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white', tone === 'green' ? 'bg-brand-600' : 'bg-amber-500')}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-ink-900">{title}</p>
        <div className="mt-1 text-[13.5px] leading-relaxed text-ink-700">{children}</div>
      </div>
    </div>
  )
}

export function SidePanel({ title, Icon, children, tone = 'light', className }: { title?: string; Icon?: LucideIcon; children: ReactNode; tone?: 'light' | 'green' | 'dark' | 'white'; className?: string }) {
  const tones = {
    light: 'ed-panel',
    green: 'ed-panel',
    white: 'rounded-xl border border-ink-200 bg-white p-5',
    dark: 'rounded-xl bg-teal-900 p-5 text-white',
  }
  return (
    <section className={cn(tones[tone], className)}>
      {title && (
        <h2 className={cn('flex items-center gap-2 font-serif text-[18px] font-semibold', tone === 'dark' ? 'text-white' : 'text-navy-900')}>
          {Icon && <Icon className={cn('h-5 w-5', tone === 'dark' ? 'text-brand-200' : 'text-brand-600')} aria-hidden />}
          {title}
        </h2>
      )}
      {children}
    </section>
  )
}

export function NumberedSteps({ steps, className }: { steps: { title: string; text: string }[]; className?: string }) {
  return (
    <ol className={cn('relative space-y-5', className)}>
      {steps.map((s, i) => (
        <li key={s.title} className="relative flex gap-4">
          {i < steps.length - 1 && <span className="absolute start-[15px] top-8 h-[calc(100%-4px)] w-px bg-brand-200" aria-hidden />}
          <span className="num-badge relative h-8 w-8 text-[13px]" aria-hidden>{i + 1}</span>
          <div className="min-w-0 pt-1">
            <p className="text-[14px] font-semibold text-ink-900">{s.title}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-600">{s.text}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

/** Very light mountain silhouette used at the bottom of closing banners (decorative). */
export function Mountains({ className }: { className?: string }) {
  return (
    <svg className={cn('mountains', className)} viewBox="0 0 1200 160" preserveAspectRatio="none" aria-hidden>
      <path d="M0 160 L0 120 C80 100 140 60 220 70 C290 78 330 110 400 96 C470 82 520 30 600 40 C680 50 720 110 800 100 C880 90 930 40 1010 56 C1080 70 1120 110 1200 96 L1200 160 Z" fill="#0f6b3f" />
      <path d="M0 160 L0 140 C120 128 200 100 300 112 C400 124 460 150 560 136 C660 122 720 86 820 98 C920 110 980 146 1080 134 C1130 128 1170 120 1200 118 L1200 160 Z" fill="#10233a" />
    </svg>
  )
}

export function ClosingBanner({ label, title, text, action, Icon, className, testId }: { label?: string; title: string; text: string; action?: ReactNode; Icon?: LucideIcon; className?: string; testId?: string }) {
  return (
    <section className={cn('relative overflow-hidden rounded-xl border border-brand-100 bg-brand-50/70 px-6 py-8 md:px-10 md:py-10', className)} data-testid={testId}>
      <Mountains />
      <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="flex gap-5">
          {Icon && <IconBadge Icon={Icon} size="lg" className="hidden sm:flex" />}
          <div className="max-w-2xl">
            {label && <SectionLabel>{label}</SectionLabel>}
            <h2 className="ed-h2 mt-2 text-[24px] md:text-[28px]">{title}</h2>
            <p className="mt-2 text-[14.5px] leading-relaxed text-ink-700">{text}</p>
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </section>
  )
}
