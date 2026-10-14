import { useEffect, useRef } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ArrowLeft, ArrowRight, Check, Copyright, FileText, Info, Scale, ShieldCheck, Users, type LucideIcon } from 'lucide-react'
import { ClosingBanner, FeatureCard, InfoBanner, SectionHeading, SidePanel, SplitHero } from '@/components/editorial'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'

/** Hero photograph: law library of the Afghanistan Rule of Law Project, Kabul (CC BY 2.0, cropped) — see public/img/CREDITS.md. */
const HERO_PHOTO_SOURCE = 'https://commons.wikimedia.org/wiki/File:ARoLP_Library-Kabul.jpg'

/** Policy keys ↔ routes. `/terms`, `/privacy`, `/disclaimer` redirect here (see App.tsx). */
const POLICIES = [
  { key: 'terms', slug: 'terms', Icon: FileText },
  { key: 'privacy', slug: 'privacy', Icon: ShieldCheck },
  { key: 'disclaimer', slug: 'disclaimer', Icon: AlertCircle },
  { key: 'ip', slug: 'intellectual-property', Icon: Copyright },
] as const
type PolicyKey = (typeof POLICIES)[number]['key']

/** Date the current drafts were prepared (real authoring date, shown as "draft pending approval"). */
const DRAFT_DATE = '2026-10-13'
/** Policies whose text was drafted for this release and still awaits Masnad's approval. The Disclaimer is the client's own text. */
const DRAFT_POLICIES: readonly PolicyKey[] = ['terms', 'privacy', 'ip']

type Section = { title: string; text?: string; items?: string[]; style?: 'check' | 'bullet'; after?: string }
type Policy = { title: string; short: string; intro: string[]; sections: Section[]; note?: string }

export function LegalPage() {
  const { t, i18n } = useTranslation()
  const { policy: slug } = useParams()
  const entry = slug ? POLICIES.find((p) => p.slug === slug) : POLICIES[0]
  const current: PolicyKey = entry?.key ?? 'terms'
  const policy = t(`legal.policies.${current}`, { returnObjects: true }) as Policy
  const hubTitle = t('legal.title')
  useDocumentTitle(slug && entry ? `${policy.title} | TMistan` : t('legal.metaTitle'), t('legal.metaDescription'))

  const policyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (slug && entry) policyRef.current?.scrollIntoView({ block: 'start' })
  }, [slug, entry])

  if (slug && !entry) return <Navigate to="/legal" replace />

  const trust: { key: 'transparent' | 'userFocused' | 'responsible'; Icon: LucideIcon }[] = [
    { key: 'transparent', Icon: ShieldCheck },
    { key: 'userFocused', Icon: Users },
    { key: 'responsible', Icon: Scale },
  ]

  return (
    <div data-testid="legal-page">
      <SplitHero
        label={t('legal.label')}
        title={hubTitle}
        text={t('legal.intro')}
        image="/img/hero-legal.jpg"
        imagePosition="55% 50%"
        credit={{ text: t('legal.photoCredit'), href: HERO_PHOTO_SOURCE }}
        benefits={trust.map(({ key, Icon }) => ({ Icon, title: t(`legal.trust.${key}.title`), text: t(`legal.trust.${key}.text`) }))}
      />

      <div className="container-x py-12 md:py-14">
        {/* Policy overview */}
        <SectionHeading label={t('legal.overview.label')} title={t('legal.overview.title')} text={t('legal.overview.text')} id="policies" />
        <ul className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {POLICIES.map(({ key, slug: s, Icon }) => (
            <li key={key}>
              <FeatureCard Icon={Icon} title={t(`legal.policies.${key}.title`)} text={t(`legal.policies.${key}.short`)} to={`/legal/${s}`} linkLabel={t('legal.overview.read')} selected={slug === s} testId={`policy-card-${key}`} />
            </li>
          ))}
        </ul>

        <InfoBanner Icon={Info} title={t('legal.notice.title')} className="mt-6">
          {t('legal.notice.text')}
        </InfoBanner>

        {/* Policy reader */}
        <div ref={policyRef} className="mt-12 grid scroll-mt-24 gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] lg:gap-10" id="policy">
          <article className="min-w-0" data-testid="policy-article" aria-labelledby="policy-title">
            <Link to="/legal" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-700 hover:underline">
              <ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
              {t('legal.back')}
            </Link>
            <p className="eyebrow mt-5">{t('legal.policyLabel')}</p>
            <h2 id="policy-title" className="mt-2 font-serif text-[32px] font-semibold leading-tight tracking-[-0.01em] text-navy-900 md:text-[38px]">{policy.title}</h2>
            {DRAFT_POLICIES.includes(current) && (
              <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[12px] font-medium text-amber-900" data-testid="policy-draft">
                {t('legal.draft', { date: formatDate(DRAFT_DATE, i18n.resolvedLanguage) })}
              </p>
            )}
            <div className="prose-ed mt-6 border-b border-ink-200 pb-6">
              {policy.intro.map((p, i) => (
                <p key={i} dangerouslySetInnerHTML={{ __html: strong(p) }} />
              ))}
            </div>
            <ol className="mt-6 space-y-8">
              {policy.sections.map((s, i) => (
                <li key={s.title} className="flex gap-4" id={`${current}-${i + 1}`}>
                  <span className="num-badge mt-0.5" aria-hidden>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-serif text-[20px] font-semibold text-navy-900">{s.title}</h3>
                    {s.text && <p className="mt-2 text-[14.5px] leading-[1.75] text-ink-700">{s.text}</p>}
                    {s.items && (
                      <ul className={cn('mt-3 space-y-2', s.style === 'check' ? '' : 'list-disc ps-5 marker:text-brand-600')}>
                        {s.items.map((it) => (
                          <li key={it} className={cn('text-[14px] leading-relaxed text-ink-700', s.style === 'check' && 'flex items-start gap-2.5')}>
                            {s.style === 'check' ? <Check className="mt-1 h-4 w-4 shrink-0 text-brand-600" aria-hidden /> : null}
                            <span>{it}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {s.after && <p className="mt-3 text-[14.5px] leading-[1.75] text-ink-700">{s.after}</p>}
                  </div>
                </li>
              ))}
            </ol>
            {policy.note && (
              <InfoBanner Icon={AlertCircle} tone="amber" title={t('legal.ownerNoteTitle')} className="mt-8">
                {policy.note}
              </InfoBanner>
            )}
            <nav className="mt-10 flex flex-wrap gap-3 border-t border-ink-200 pt-6" aria-label={t('legal.nav.title')}>
              {POLICIES.filter((p) => p.key !== current).map(({ key, slug: s }) => (
                <Link key={key} to={`/legal/${s}`} className="btn btn-secondary">
                  {t(`legal.policies.${key}.title`)}
                  <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                </Link>
              ))}
            </nav>
          </article>

          <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
            <SidePanel title={t('legal.nav.title')} tone="white">
              <ul className="mt-3 space-y-1">
                {POLICIES.map(({ key, slug: s, Icon }) => (
                  <li key={key}>
                    <Link to={`/legal/${s}`} className={cn('policy-nav-link', current === key && 'active')} aria-current={current === key ? 'page' : undefined}>
                      <Icon className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                      <span className="flex-1">{t(`legal.policies.${key}.title`)}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-ink-400 rtl:-scale-x-100" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </SidePanel>
            <SidePanel tone="white" className="overflow-hidden p-0">
              <div className="h-28 bg-cover bg-center" style={{ backgroundImage: "url('/img/hero-legal.jpg')" }} aria-hidden />
              <div className="p-5">
                <h2 className="font-serif text-[18px] font-semibold text-navy-900">{t('legal.help.title')}</h2>
                <p className="mt-2 text-[13.5px] leading-relaxed text-ink-600">{t('legal.help.text')}</p>
                <Link to="/help" className="btn btn-secondary mt-4">
                  {t('legal.help.button')}
                  <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                </Link>
              </div>
            </SidePanel>
            <SidePanel title={t('legal.trustPanel.title')} Icon={ShieldCheck} tone="green">
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-700">{t('legal.trustPanel.text')}</p>
            </SidePanel>
          </aside>
        </div>

        <ClosingBanner
          className="mt-12"
          label={t('legal.closing.label')}
          title={t('legal.closing.title')}
          text={t('legal.closing.text')}
          Icon={ShieldCheck}
          action={
            <Link to="/contact" className="btn btn-outline-green">
              {t('legal.closing.button')}
              <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
            </Link>
          }
        />
      </div>
    </div>
  )
}

/** Allow **bold** in intro paragraphs; everything else is escaped. */
function strong(s: string): string {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.replace(/\*\*(.+?)\*\*/g, '<strong class="text-ink-900">$1</strong>')
}
