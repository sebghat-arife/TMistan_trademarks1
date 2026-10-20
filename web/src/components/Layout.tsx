import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, Globe, Menu, X } from 'lucide-react'
import { LANGUAGES } from '@/i18n'
import { cn } from '@/lib/utils'
import { Logo } from './Logo'
import { MASNAD_URL, SITE_CONTACT } from '@/lib/site'
import { DecorativeBorder, StarMotif } from './ornament'

// Primary navigation. Nine entries: the desktop bar is shown from the `lg`
// breakpoint (1024px) with a compact type size and switches to the full size
// at `xl`; narrower viewports use the menu button.
const NAV: readonly { to: string; key: string; end?: boolean }[] = [
  { to: '/', key: 'nav.search', end: true }, // the search is the landing page
  { to: '/services', key: 'nav.services' },
  { to: '/data-sources', key: 'nav.dataSources' },
  { to: '/knowledge-center', key: 'nav.knowledge' },
  { to: '/data-corrections', key: 'nav.corrections' },
  { to: '/legal', key: 'nav.legal' },
  { to: '/about', key: 'nav.about' },
  { to: '/help', key: 'nav.help' },
  { to: '/contact', key: 'nav.contact' },
]

// Brand glyphs (lucide no longer ships brand icons). Links come from the
// SITE_*_URL build variables; a network without a URL is simply not rendered.
const SOCIAL = [
  { label: 'Facebook', href: SITE_CONTACT.facebook, d: 'M13.5 22v-8.2h2.8l.4-3.2h-3.2V8.5c0-.9.3-1.6 1.6-1.6h1.7V4.1c-.3 0-1.3-.1-2.5-.1-2.5 0-4.1 1.5-4.1 4.2v2.4H7.4v3.2h2.8V22h3.3z' },
  { label: 'Twitter', href: SITE_CONTACT.twitter, d: 'M22 5.9c-.7.3-1.5.5-2.4.6.9-.5 1.5-1.3 1.8-2.3-.8.5-1.7.8-2.6 1a4.1 4.1 0 0 0-7 3.7A11.6 11.6 0 0 1 3.4 4.6a4.1 4.1 0 0 0 1.3 5.5c-.7 0-1.3-.2-1.9-.5 0 2 1.4 3.7 3.3 4-.6.2-1.2.2-1.8.1.5 1.6 2 2.8 3.8 2.8A8.3 8.3 0 0 1 2 18.3 11.6 11.6 0 0 0 8.3 20c7.5 0 11.7-6.3 11.7-11.7v-.5c.8-.6 1.5-1.3 2-2z' },
  { label: 'LinkedIn', href: SITE_CONTACT.linkedin, d: 'M6.9 21H3.3V9h3.6v12zM5.1 7.4a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2zM21 21h-3.6v-5.8c0-1.4 0-3.2-1.9-3.2s-2.2 1.5-2.2 3.1V21H9.7V9h3.4v1.6h.1c.5-.9 1.7-1.9 3.4-1.9 3.7 0 4.4 2.4 4.4 5.5V21z' },
].filter((s) => s.href)

export function Layout() {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="flex min-h-screen flex-col bg-ivory-50">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm">
        {t('app.skipToContent')}
      </a>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-ink-200 bg-white">
        <div className="container-x flex h-[68px] items-center justify-between gap-4 xl:gap-6">
          <Link to="/" className="flex shrink-0 items-center" aria-label="TMistan — home">
            <Logo className="h-[48px] xl:h-[52px]" />
          </Link>

          <nav className="hidden min-w-0 items-center gap-3.5 lg:flex xl:gap-5" aria-label="Primary">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn(
                    'relative whitespace-nowrap py-5 text-[13px] font-medium text-ink-700 transition-colors hover:text-brand-700 xl:text-[14.5px]',
                    isActive && 'font-semibold text-navy-900 after:absolute after:inset-x-0 after:-bottom-px after:h-[2px] after:rounded-full after:bg-brand-600',
                  )
                }
              >
                {t(n.key)}
              </NavLink>
            ))}
          </nav>

          {/* The administrator sign-in is deliberately not linked from the public site: open /admin/login directly. */}
          <div className="hidden shrink-0 items-center gap-4 lg:flex">
            <LanguageSwitcher />
          </div>

          <button type="button" className="btn-ghost lg:hidden" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-label={t('common.menu')}>
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {menuOpen && (
          <div className="border-t border-ink-200 bg-white lg:hidden">
            <div className="container-x flex flex-col gap-1 py-3">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setMenuOpen(false)} className={({ isActive }) => cn('rounded-md px-3 py-2 text-[15px] font-medium', isActive ? 'bg-brand-50 font-semibold text-brand-800' : 'text-ink-800')}>
                  {t(n.key)}
                </NavLink>
              ))}
              <div className="flex items-center justify-between px-3 py-2">
                <LanguageSwitcher />
              </div>
            </div>
          </div>
        )}
      </header>

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="relative mt-12 border-t border-ink-200 bg-ivory-100 text-ink-700">
        {/* decorative frieze: fine lozenge chain in turquoise over the top edge */}
        <DecorativeBorder className="text-turquoise-400" thickness={12} />
        <div className="container-x grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[1.7fr_1fr_1fr_1.15fr_1fr] lg:gap-8">
          <div className="sm:col-span-2 lg:col-span-1">
            <Logo className="h-14" />
            <p className="mt-5 max-w-xs text-[14px] leading-relaxed text-ink-600">{t('footer.blurb')}</p>
            {(SITE_CONTACT.email || SITE_CONTACT.phone) && (
              <ul className="mt-4 space-y-1.5 text-[13px] text-ink-600">
                {SITE_CONTACT.email && (
                  <li>
                    <a href={`mailto:${SITE_CONTACT.email}`} className="hover:text-brand-700 hover:underline">{SITE_CONTACT.email}</a>
                  </li>
                )}
                {SITE_CONTACT.phone && (
                  <li>
                    <a href={`tel:${SITE_CONTACT.phone.replace(/[^+\d]/g, '')}`} className="hover:text-brand-700 hover:underline" dir="ltr">{SITE_CONTACT.phone}</a>
                  </li>
                )}
              </ul>
            )}
            <div className={cn('mt-5 flex items-center gap-3', SOCIAL.length === 0 && 'hidden')}>
              {SOCIAL.map(({ label, href, d }) => (
                <a key={label} href={href} target="_blank" rel="noreferrer" aria-label={label} className="flex h-9 w-9 items-center justify-center rounded-full border border-ink-200 bg-white text-navy-900 transition-colors hover:border-brand-300 hover:text-brand-700">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden><path d={d} /></svg>
                </a>
              ))}
            </div>
          </div>
          <FooterCol title={t('footer.platform')} links={[['/', t('nav.search')], ['/services', t('footer.services')], ['/about', t('nav.about')], ['/help', t('nav.help')]]} />
          <FooterCol
            title={t('footer.information')}
            links={[['/about', t('footer.aboutTMistan')], ['/data-sources', t('footer.dataSources')], ['/knowledge-center', t('footer.knowledge')], ['/data-corrections', t('footer.corrections')], ['/#how-it-works', t('footer.howItWorks')], ['/contact', t('footer.contact')]]}
          />
          <div>
            <h3 className="font-serif text-[16px] font-semibold text-navy-900">{t('footer.masnad')}</h3>
            <p className="mt-4 text-[14px] leading-relaxed text-ink-600">{t('footer.product')}</p>
            {MASNAD_URL && (
              <a href={MASNAD_URL} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[14px] font-semibold text-brand-700 hover:text-brand-800 hover:underline">
                {t('footer.visitMasnad')}
                <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
              </a>
            )}
          </div>
          <FooterCol title={t('footer.legal')} links={[['/legal', t('footer.legalHub')], ['/legal/terms', t('footer.terms')], ['/legal/privacy', t('footer.privacy')], ['/legal/disclaimer', t('footer.disclaimer')], ['/legal/intellectual-property', t('footer.ip')]]} />
        </div>
        <div className="border-t border-ink-200/80">
          <div className="container-x flex flex-col items-center justify-between gap-4 py-5 text-[13px] text-ink-600 sm:flex-row">
            <span className="inline-flex items-center gap-2.5">
              <StarMotif size={14} variant="dot" className="text-brand-600" />
              <span>© {new Date().getFullYear()} TMistan — {t('footer.rights')}</span>
            </span>
            <LanguageSwitcher />
          </div>
        </div>
      </footer>
    </div>
  )
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h3 className="font-serif text-[16px] font-semibold text-navy-900">{title}</h3>
      <ul className="mt-4 space-y-2.5 text-[14px] text-ink-600">
        {links.map(([to, label]) => (
          <li key={to}>
            <Link to={to} className="transition-colors hover:text-brand-700 hover:underline">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function LanguageSwitcher({ className, tone = 'light' }: { className?: string; tone?: 'light' | 'dark' }) {
  const { i18n, t } = useTranslation()
  const current = LANGUAGES.find((l) => l.code === i18n.resolvedLanguage) ?? LANGUAGES[0]
  const text = tone === 'dark' ? 'text-white/85' : 'text-ink-800'
  return (
    <label className={cn('inline-flex items-center gap-1.5 text-[14px] font-medium', text, className)}>
      <Globe className={cn('h-[18px] w-[18px]', tone === 'dark' ? 'text-white/70' : 'text-ink-700')} aria-hidden />
      <span className="sr-only">{t('nav.language')}</span>
      <select
        value={current.code}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
        className={cn('cursor-pointer appearance-none bg-transparent pe-1 text-[14px] font-medium outline-none', text, tone === 'dark' && '[&>option]:text-ink-900')}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.short}
          </option>
        ))}
      </select>
    </label>
  )
}
