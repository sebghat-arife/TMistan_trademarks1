import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, BookOpen, Image as ImageIcon, Tag } from 'lucide-react'
import { importJobsQuery, registryStatsQuery, trademarksByClassQuery } from '@/lib/queries'
import { cn, formatDate, formatNumber } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import type { ImportJobRow } from '@/lib/database.types'

export function AdminDashboardPage() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const { data: stats } = useQuery(registryStatsQuery())
  const { data: byClass } = useQuery(trademarksByClassQuery())
  const { data: jobs, isLoading: jobsLoading } = useQuery(importJobsQuery(8))
  useDocumentTitle(`${t('admin.dashboard')} · ${t('app.shortName')}`)

  const max = Math.max(1, ...(byClass ?? []).map((c) => c.count))

  return (
    <div>
      <h1 className="text-[24px] font-bold text-ink-900">{t('admin.dashboard')}</h1>

      <div className="mt-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat icon={Tag} label={t('admin.totalTrademarks')} value={formatNumber(stats?.trademarks, lng)} />
        <Stat icon={BookOpen} label={t('admin.gazettes')} value={formatNumber(stats?.gazettes, lng)} />
        <Stat icon={ImageIcon} label={t('admin.images')} value={formatNumber(stats?.images, lng)} />
        <Stat icon={AlertTriangle} label={t('admin.needsReview')} value={formatNumber(stats?.needs_review, lng)} tone="danger" />
      </div>

      {/* Trademarks by class */}
      <section className="card mt-5 p-5">
        <h2 className="text-[16px] font-semibold text-ink-900">{t('admin.byClass')}</h2>
        <div className="mt-4 flex h-44 items-end gap-[3px]" role="img" aria-label={t('admin.byClass')}>
          {(byClass ?? []).map((c) => (
            <div key={c.class} className="group relative flex h-full flex-1 flex-col items-center justify-end" title={`${t('fields.class')} ${c.class}: ${c.count}`}>
              <div className="w-full rounded-t-sm bg-brand-600 transition-colors group-hover:bg-brand-700" style={{ height: `${Math.max(2, (c.count / max) * 100)}%` }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-[3px] text-[10px] text-ink-500">
          {(byClass ?? []).map((c) => (
            <div key={c.class} className="flex-1 text-center tabular-nums">{c.class % 5 === 0 || c.class === 1 ? c.class : ''}</div>
          ))}
        </div>
      </section>

      {/* Recent imports */}
      <section className="card mt-5 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-[16px] font-semibold text-ink-900">{t('admin.recentImports')}</h2>
          <Link to="/admin/imports" className="link-green">{t('admin.viewAllImports')} →</Link>
        </div>
        <table className="w-full text-[14px]">
          <thead className="border-y border-ink-200 bg-ink-50 text-[13px] text-ink-600">
            <tr className="[&>th]:px-5 [&>th]:py-2.5 [&>th]:text-start [&>th]:font-medium">
              <th>{t('admin.fileName')}</th>
              <th className="w-24">{t('admin.total')}</th>
              <th className="w-24">{t('admin.inserted')}</th>
              <th className="w-24">{t('admin.updated')}</th>
              <th className="w-40">{t('admin.status')}</th>
              <th className="w-40">{t('admin.date')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {(jobs ?? []).map((j) => (
              <tr key={j.id}>
                <td className="px-5 py-3 font-medium text-ink-900" dir="ltr" title={j.source_path ?? undefined}>{j.filename ?? basename(j.source_path) ?? `${j.job_type} import`}</td>
                <td className="px-5 py-3 tabular-nums">{formatNumber(j.total_rows, lng)}</td>
                <td className="px-5 py-3 tabular-nums">{formatNumber(j.inserted_rows, lng)}</td>
                <td className="px-5 py-3 tabular-nums">{formatNumber(j.updated_rows, lng)}</td>
                <td className="px-5 py-3"><StatusPill status={j.status} /></td>
                <td className="px-5 py-3 tabular-nums text-ink-600">{formatDate(j.completed_at ?? j.created_at, lng)}</td>
              </tr>
            ))}
            {!jobsLoading && (jobs ?? []).length === 0 && (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-ink-500">{t('admin.noImports')}</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function basename(p: string | null): string | null {
  if (!p) return null
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
}

function Stat({ icon: Icon, label, value, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; tone?: 'danger' }) {
  return (
    <div className="card flex items-center gap-4 p-5">
      <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-full', tone === 'danger' ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-600')}>
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <div className="text-[22px] font-bold leading-tight tabular-nums text-ink-900">{value}</div>
        <div className="text-[13px] text-ink-500">{label}</div>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: ImportJobRow['status'] }) {
  const map: Record<ImportJobRow['status'], string> = {
    completed: 'bg-brand-50 text-brand-700',
    completed_with_warnings: 'bg-amber-50 text-amber-800',
    failed: 'bg-red-50 text-red-700',
    processing: 'bg-blue-50 text-blue-700',
    queued: 'bg-ink-100 text-ink-600',
  }
  const label = status === 'completed_with_warnings' ? 'Completed · warnings' : status.charAt(0).toUpperCase() + status.slice(1)
  return <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-semibold', map[status])}>{label}</span>
}

/** Placeholder for the remaining admin sections (Phase 2). */
export function AdminSectionPage({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation()
  useDocumentTitle(`${t(titleKey)} · ${t('app.shortName')}`)
  return (
    <div>
      <h1 className="text-[24px] font-bold text-ink-900">{t(titleKey)}</h1>
      <div className="card mt-5 p-8 text-center text-[14px] text-ink-600">{t('admin.comingSoon')}</div>
    </div>
  )
}
