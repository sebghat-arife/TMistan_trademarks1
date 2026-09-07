import { lazy, Suspense, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { HomePage } from '@/pages/HomePage'

// Route-level code splitting: the home page ships in the main bundle, the
// rest load on demand.
const SearchPage = lazy(() => import('@/pages/SearchPage').then((m) => ({ default: m.SearchPage })))
const TrademarkPage = lazy(() => import('@/pages/TrademarkPage').then((m) => ({ default: m.TrademarkPage })))
const GazettesPage = lazy(() => import('@/pages/GazettesPage').then((m) => ({ default: m.GazettesPage })))
const GazettePage = lazy(() => import('@/pages/GazettePage').then((m) => ({ default: m.GazettePage })))
const AboutPage = lazy(() => import('@/pages/AboutPage').then((m) => ({ default: m.AboutPage })))
const HelpPage = lazy(() => import('@/pages/HelpPage').then((m) => ({ default: m.HelpPage })))
const LegalPage = lazy(() => import('@/pages/HelpPage').then((m) => ({ default: m.LegalPage })))
const AdminLoginPage = lazy(() => import('@/pages/admin/AdminLoginPage').then((m) => ({ default: m.AdminLoginPage })))
const AdminLayout = lazy(() => import('@/pages/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })))
const AdminDashboardPage = lazy(() => import('@/pages/admin/AdminDashboardPage').then((m) => ({ default: m.AdminDashboardPage })))
const AdminSectionPage = lazy(() => import('@/pages/admin/AdminDashboardPage').then((m) => ({ default: m.AdminSectionPage })))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
})

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [pathname])
  return null
}

function PageFallback() {
  return <div className="container-x py-10 text-sm text-ink-400">…</div>
}

const ADMIN_SECTIONS: [string, string][] = [
  ['trademarks', 'admin.trademarks'],
  ['gazettes', 'admin.gazettes'],
  ['images', 'admin.images'],
  ['applicants', 'admin.applicants'],
  ['imports', 'admin.importJobs'],
  ['reviews', 'admin.reviews'],
  ['users', 'admin.users'],
  ['audit', 'admin.auditLogs'],
  ['settings', 'admin.settings'],
]

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ScrollToTop />
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/trademarks" element={<SearchPage browseAll />} />
              <Route path="/trademark/:serial" element={<TrademarkPage />} />
              <Route path="/gazettes" element={<GazettesPage />} />
              <Route path="/gazette/:number" element={<GazettePage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/help" element={<HelpPage />} />
              <Route path="/terms" element={<LegalPage kind="terms" />} />
              <Route path="/privacy" element={<LegalPage kind="privacy" />} />
              <Route path="/admin/login" element={<AdminLoginPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboardPage />} />
              {ADMIN_SECTIONS.map(([path, key]) => (
                <Route key={path} path={path} element={<AdminSectionPage titleKey={key} />} />
              ))}
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
