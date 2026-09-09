import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Globe, Menu, X } from 'lucide-react'
import { LANGUAGES } from '@/i18n'
import { cn } from '@/lib/utils'
import { Logo } from './Logo'
import { SITE_CONTACT } from '@/lib/site'

const NAV = [
  { to: '/search', key: 'nav.search' },
  { to: '/gazettes', key: 'nav.gazettes' },
  { to: '/trademarks', key: 'nav.trademarks' },
  { to: '/about', key: 'nav.about' },
  { to: '/help', key: 'nav.help' },
] as const

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
    <div className="flex min-h-screen flex-col bg-ink-50">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm">
        {t('app.skipToContent')}
      </a>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-ink-200 bg-white">
        <div className="container-x flex h-[68px] items-center justify-between gap-6">
          <Link to="/" className="flex items-center" aria-label="TMistan — home">
            <Logo className="h-11" />
          </Link>

          <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cn(
                    'relative py-5 text-[15px] font-medium text-ink-800 transition-colors hover:text-brand-600',
                    isActive && 'text-ink-900 after:absolute after:inset-x-0 after:-bottom-px after:h-[2px] after:rounded-full after:bg-brand-600',
                  )
                }
              >
                {t(n.key)}
              </NavLink>
            ))}
          </nav>

          <div className="hidden items-center gap-4 md:flex">
            <LanguageSwitcher />
            <Link to="/admin/login" className="btn-primary h-9 px-5">
              {t('nav.login')}
            </Link>
          </div>

          <button type="button" className="btn-ghost md:hidden" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-label={t('common.menu')}>
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {menuOpen && (
          <div className="border-t border-ink-200 bg-white md:hidden">
            <div className="container-x flex flex-col gap-1 py-3">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} onClick={() => setMenuOpen(false)} className={({ isActive }) => cn('rounded-md px-3 py-2 text-[15px] font-medium', isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-800')}>
                  {t(n.key)}
                </NavLink>
              ))}
              <div className="flex items-center justify-between px-3 py-2">
                <LanguageSwitcher />
                <Link to="/admin/login" className="btn-primary h-9 px-5" onClick={() => setMenuOpen(false)}>
                  {t('nav.login')}
                </Link>
              </div>
            </div>
          </div>
        )}
      </header>

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="mt-12 bg-dark-900 text-white">
        <div className="container-x grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div>
            <Logo variant="dark" className="h-12" />
            <p className="mt-5 max-w-xs text-[14px] leading-relaxed text-white/85">{t('footer.blurb')}</p>
          </div>
          <FooterCol title={t('footer.quickLinks')} links={[['/search', t('nav.search')], ['/gazettes', t('nav.gazettes')], ['/trademarks', t('nav.trademarks')], ['/about', t('nav.about')]]} />
          <FooterCol title={t('footer.resources')} links={[['/help', t('footer.helpCenter')], ['/help#glossary', t('footer.glossary')], ['/terms', t('footer.terms')], ['/privacy', t('footer.privacy')]]} />
          <div>
            <h3 className="text-[15px] font-semibold">{t('footer.contact')}</h3>
            <ul className="mt-4 space-y-2.5 text-[14px] text-white/85">
              {SITE_CONTACT.email && <li>{t('footer.email')}: <a href={`mailto:${SITE_CONTACT.email}`} className="hover:underline">{SITE_CONTACT.email}</a></li>}
              {SITE_CONTACT.phone && <li>{t('footer.phone')}: <a href={`tel:${SITE_CONTACT.phone.replace(/[^+\d]/g, '')}`} className="hover:underline" dir="ltr">{SITE_CONTACT.phone}</a></li>}
              <li>{SITE_CONTACT.address || t('footer.address')}</li>
            </ul>
            <div className={cn('mt-5 flex items-center gap-3', SOCIAL.length === 0 && 'hidden')}>
              {SOCIAL.map(({ label, href, d }) => (
                <a key={label} href={href} target="_blank" rel="noreferrer" aria-label={label} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden><path d={d} /></svg>
                </a>
              ))}
            </div>
          </div>
        </div>
        <div className="container-x border-t border-white/10 py-5 text-center text-[13px] text-white/70">
          © {new Date().getFullYear()} TMistan. {t('footer.rights')}
        </div>
      </footer>
    </div>
  )
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <ul className="mt-4 space-y-2.5 text-[14px] text-white/85">
        {links.map(([to, label]) => (
          <li key={to}>
            <Link to={to} className="hover:underline">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n, t } = useTranslation()
  const current = LANGUAGES.find((l) => l.code === i18n.resolvedLanguage) ?? LANGUAGES[0]
  return (
    <label className={cn('inline-flex items-center gap-1.5 text-[14px] font-medium text-ink-800', className)}>
      <Globe className="h-[18px] w-[18px] text-ink-700" aria-hidden />
      <span className="sr-only">{t('nav.language')}</span>
      <select
        value={current.code}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
        className="cursor-pointer appearance-none bg-transparent pe-1 text-[14px] font-medium text-ink-800 outline-none"
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
