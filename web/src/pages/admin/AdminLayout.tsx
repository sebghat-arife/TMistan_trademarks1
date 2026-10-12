import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FileClock, FileSpreadsheet, HardDrive, History, ImageOff, Image as ImageIcon, Images, Inbox, LayoutDashboard, LogOut, Tag } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { Logo } from '@/components/Logo'
import { LanguageSwitcher } from '@/components/Layout'

/** Admin Data Management Center navigation (order mandated by the client brief). */
export const ADMIN_NAV = [
  { to: '/admin', key: 'admin.nav.overview', Icon: LayoutDashboard, end: true },
  { to: '/admin/trademarks', key: 'admin.nav.trademarks', Icon: Tag },
  { to: '/admin/images', key: 'admin.nav.images', Icon: ImageIcon, end: true },
  { to: '/admin/imports/excel', key: 'admin.nav.importsExcel', Icon: FileSpreadsheet },
  { to: '/admin/imports/images', key: 'admin.nav.importsImages', Icon: Images },
  { to: '/admin/history', key: 'admin.nav.history', Icon: History },
  { to: '/admin/images/unmatched', key: 'admin.nav.unmatched', Icon: ImageOff },
  { to: '/admin/storage', key: 'admin.nav.orphans', Icon: HardDrive },
  { to: '/admin/audit', key: 'admin.nav.audit', Icon: FileClock },
  { to: '/admin/inquiries', key: 'admin.nav.inquiries', Icon: Inbox },
] as const

/** Dark sidebar shell from the mock-up. Only reachable when `is_admin()` is true. */
export function AdminLayout() {
  const { t } = useTranslation()
  const auth = useAuth()
  const loc = useLocation()

  if (auth.loading) return <div className="flex min-h-screen items-center justify-center text-sm text-ink-500">{t('common.loading')}</div>
  if (!auth.isAdmin) return <Navigate to="/admin/login" replace state={{ from: loc.pathname }} />

  return (
    <div className="flex min-h-screen bg-ink-50">
      <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col bg-dark-950 text-white md:flex">
        <div className="px-5 pb-4 pt-5">
          <Logo variant="dark" className="h-10" />
        </div>
        <nav className="flex-1 space-y-0.5 px-3" aria-label="Admin">
          {ADMIN_NAV.map(({ to, key, Icon, ...rest }) => (
            <NavLink
              key={to}
              to={to}
              end={'end' in rest && rest.end}
              className={({ isActive }) =>
                cn('flex items-center gap-3 rounded-md px-3 py-2 text-[14px] font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white', isActive && 'bg-brand-700 text-white hover:bg-brand-700')
              }
            >
              <Icon className="h-[18px] w-[18px]" /> {t(key)}
            </NavLink>
          ))}
        </nav>
        <button type="button" onClick={() => void auth.signOut()} className="mx-3 mb-5 flex items-center gap-3 rounded-md px-3 py-2 text-[14px] font-medium text-white/80 hover:bg-white/10 hover:text-white">
          <LogOut className="h-[18px] w-[18px]" /> {t('admin.signOut')}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-ink-200 bg-white px-6">
          <Logo className="h-8 md:hidden" />
          <span className="hidden text-[13px] text-ink-500 md:inline">{auth.session?.user.email ?? 'admin'}</span>
          <div className="flex items-center gap-4">
            <LanguageSwitcher />
            <NavLink to="/" className="text-[13px] font-medium text-brand-600 hover:underline">TMistan ↗</NavLink>
          </div>
        </header>
        {/* Mobile navigation (the sidebar is desktop-only) */}
        <nav className="flex gap-1 overflow-x-auto border-b border-ink-200 bg-white px-3 py-2 md:hidden" aria-label="Admin">
          {ADMIN_NAV.map(({ to, key, Icon, ...rest }) => (
            <NavLink
              key={to}
              to={to}
              end={'end' in rest && rest.end}
              className={({ isActive }) => cn('inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-ink-700 hover:bg-ink-100', isActive && 'bg-brand-50 text-brand-700')}
            >
              <Icon className="h-3.5 w-3.5" /> {t(key)}
            </NavLink>
          ))}
        </nav>
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
