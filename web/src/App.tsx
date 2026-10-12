import { lazy, Suspense, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { ConfigScreen } from '@/components/ConfigScreen'
import { supabaseConfigError } from '@/lib/supabase'
import { HomePage } from '@/pages/HomePage'

// Route-level code splitting: the home page ships in the main bundle, the
// rest load on demand.
const SearchPage = lazy(() => import('@/pages/SearchPage').then((m) => ({ default: m.SearchPage })))
const TrademarkPage = lazy(() => import('@/pages/TrademarkPage').then((m) => ({ default: m.TrademarkPage })))
const AboutPage = lazy(() => import('@/pages/AboutPage').then((m) => ({ default: m.AboutPage })))
const HelpPage = lazy(() => import('@/pages/HelpPage').then((m) => ({ default: m.HelpPage })))
const LegalPage = lazy(() => import('@/pages/HelpPage').then((m) => ({ default: m.LegalPage })))
const AdminLoginPage = lazy(() => import('@/pages/admin/AdminLoginPage').then((m) => ({ default: m.AdminLoginPage })))
const AdminLayout = lazy(() => import('@/pages/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })))
const AdminDashboardPage = lazy(() => import('@/pages/admin/AdminDashboardPage').then((m) => ({ default: m.AdminDashboardPage })))
const ImportCenterPage = lazy(() => import('@/pages/admin/ImportCenterPage').then((m) => ({ default: m.ImportCenterPage })))
const AdminTrademarksPage = lazy(() => import('@/pages/admin/AdminTrademarksPage').then((m) => ({ default: m.AdminTrademarksPage })))
const AdminImagesPage = lazy(() => import('@/pages/admin/AdminImagesPage').then((m) => ({ default: m.AdminImagesPage })))
const AdminImportHistoryPage = lazy(() => import('@/pages/admin/AdminImportHistoryPage').then((m) => ({ default: m.AdminImportHistoryPage })))
const AdminStoragePage = lazy(() => import('@/pages/admin/AdminStoragePage').then((m) => ({ default: m.AdminStoragePage })))
const AdminAuditPage = lazy(() => import('@/pages/admin/AdminAuditPage').then((m) => ({ default: m.AdminAuditPage })))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
})

function ScrollToTop() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      // In-page anchors (e.g. /#how-it-works from the footer): scroll to the section once rendered.
      const id = decodeURIComponent(hash.slice(1))
      const timer = window.setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ block: 'start' })
      }, 60)
      return () => window.clearTimeout(timer)
    }
    window.scrollTo({ top: 0 })
  }, [pathname, hash])
  return null
}

function PageFallback() {
  return <div className="container-x py-10 text-sm text-ink-400">…</div>
}

export default function App() {
  if (supabaseConfigError) return <ConfigScreen message={supabaseConfigError} />
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ScrollToTop />
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/trademark/:serial" element={<TrademarkPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/help" element={<HelpPage />} />
              <Route path="/terms" element={<LegalPage kind="terms" />} />
              <Route path="/privacy" element={<LegalPage kind="privacy" />} />
              <Route path="/disclaimer" element={<LegalPage kind="disclaimer" />} />
              <Route path="/admin/login" element={<AdminLoginPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
            <Route path="/admin" element={<AdminLayout />}>
              {/* Admin Data Management Center — see docs/ADMIN_DATA_MANAGEMENT.md */}
              <Route index element={<AdminDashboardPage />} />
              <Route path="trademarks" element={<AdminTrademarksPage />} />
              <Route path="images" element={<AdminImagesPage mode="all" />} />
              <Route path="images/unmatched" element={<AdminImagesPage mode="unmatched" />} />
              <Route path="imports" element={<ImportCenterPage mode="all" />} />
              <Route path="imports/excel" element={<ImportCenterPage mode="excel" />} />
              <Route path="imports/images" element={<ImportCenterPage mode="images" />} />
              <Route path="import" element={<Navigate to="/admin/imports" replace />} />
              <Route path="history" element={<AdminImportHistoryPage />} />
              <Route path="storage" element={<AdminStoragePage />} />
              <Route path="audit" element={<AdminAuditPage />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
