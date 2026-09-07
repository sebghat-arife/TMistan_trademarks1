import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookOpen, ClipboardCheck, Download, FileClock, Image as ImageIcon, LayoutDashboard, LogOut, Settings, Tag, UserCircle, Users } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { Logo } from '@/components/Logo'
import { LanguageSwitcher } from '@/components/Layout'

export const ADMIN_NAV = [
  { to: '/admin', key: 'admin.dashboard', Icon: LayoutDashboard, end: true },
  { to: '/admin/trademarks', key: 'admin.trademarks', Icon: Tag },
  { to: '/admin/gazettes', key: 'admin.gazettes', Icon: BookOpen },
  { to: '/admin/images', key: 'admin.images', Icon: ImageIcon },
  { to: '/admin/applicants', key: 'admin.applicants', Icon: UserCircle },
  { to: '/admin/imports', key: 'admin.importJobs', Icon: Download },
  { to: '/admin/reviews', key: 'admin.reviews', Icon: ClipboardCheck },
  { to: '/admin/users', key: 'admin.users', Icon: Users },
  { to: '/admin/audit', key: 'admin.auditLogs', Icon: FileClock },
  { to: '/admin/settings', key: 'admin.settings', Icon: Settings },
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
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
