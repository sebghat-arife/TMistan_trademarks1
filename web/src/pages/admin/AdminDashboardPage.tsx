import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Archive, BookOpen, FileClock, HardDrive, Image as ImageIcon, ShieldAlert, Tag } from 'lucide-react'
import { importJobsQuery, registryStatsQuery, trademarksByClassQuery } from '@/services'
import { dataManagementReady, getDataOverview } from '@/services/admin_data_service'
import { cn, formatDate, formatDateTime, formatNumber } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import type { ImportJobRow } from '@/lib/database.types'
import { ErrorState } from '@/components/AsyncState'
import { Notice, formatBytes } from '@/components/admin/AdminUi'

export function AdminDashboardPage() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const { data: stats, isError: statsError, error: statsErr } = useQuery(registryStatsQuery())
  const { data: byClass, isError: classError, error: classErr } = useQuery(trademarksByClassQuery())
  const { data: jobs, isLoading: jobsLoading, isError: jobsError, error: jobsErr } = useQuery(importJobsQuery(8))
  useDocumentTitle(`${t('admin.nav.overview')} · ${t('app.shortName')}`)

  const max = Math.max(1, ...(byClass ?? []).map((c) => c.count))

  return (
    <div>
      <h1 className="text-[24px] font-bold text-ink-900">{t('admin.nav.overview')}</h1>
      <p className="muted mt-1 max-w-3xl">{t('admin.data.overview.subtitle')}</p>
      {statsError && <ErrorState className="mt-5" error={statsErr} />}

      <div className="mt-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat icon={Tag} label={t('admin.totalTrademarks')} value={formatNumber(stats?.trademarks, lng)} />
        <Stat icon={BookOpen} label={t('admin.gazettes')} value={formatNumber(stats?.gazettes, lng)} />
        <Stat icon={ImageIcon} label={t('admin.images')} value={formatNumber(stats?.images, lng)} />
        <Stat icon={AlertTriangle} label={t('admin.needsReview')} value={formatNumber(stats?.needs_review, lng)} tone="danger" />
      </div>

      <DataOverviewPanel />

      {/* Trademarks by class */}
      <section className="card mt-5 p-5">
        <h2 className="text-[16px] font-semibold text-ink-900">{t('admin.byClass')}</h2>
        {classError && <ErrorState className="mt-3" error={classErr} />}
        {byClass && byClass.length === 0 && <p className="muted mt-3">{t('admin.noImports')}</p>}
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
          <Link to="/admin/history" className="link-green">{t('admin.viewAllImports')} →</Link>
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
            {jobsError && (
              <tr><td colSpan={6} className="px-5 py-4"><ErrorState error={jobsErr} /></td></tr>
            )}
            {!jobsLoading && !jobsError && (jobs ?? []).length === 0 && (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-ink-500">{t('admin.noImports')}</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}

/** Data-management overview (migration 0600). Shows a clear notice instead of numbers when not applied. */
function DataOverviewPanel() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const ready = useQuery({ queryKey: ['admin', 'data_ready'], queryFn: dataManagementReady, staleTime: 60_000, retry: false })
  const ov = useQuery({ queryKey: ['admin', 'overview'], queryFn: getDataOverview, enabled: ready.data?.ready === true, staleTime: 15_000 })
  if (ready.data && !ready.data.ready) {
    return (
      <Notice tone="warn" className="mt-5 flex items-start gap-2" title={ready.data.reason === 'schema_missing' ? t('admin.data.notApplied.title') : t('admin.data.notReady')}>
        <span className="flex items-start gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> {ready.data.message} {ready.data.reason === 'schema_missing' ? t('admin.data.notApplied.hint') : ''}</span>
      </Notice>
    )
  }
  const d = ov.data
  if (!d) return ov.isError ? <ErrorState className="mt-5" error={ov.error} /> : null
  const n = (x: number | null | undefined) => formatNumber(x ?? 0, lng)
  const sections: { to: string; icon: React.ComponentType<{ className?: string }>; title: string; rows: [string, string, ('warn' | 'error' | undefined)?][] }[] = [
    { to: '/admin/trademarks', icon: Tag, title: t('admin.nav.trademarks'), rows: [
      [t('admin.data.status.published'), n(d.trademarks.published)],
      [t('admin.data.status.archived'), n(d.trademarks.archived), d.trademarks.archived ? 'warn' : undefined],
      [t('admin.data.filters.withoutImages'), n(d.trademarks.without_images)],
      [t('admin.data.overview.withProvenance'), `${n(d.trademarks.with_provenance)} / ${n(d.trademarks.total)}`],
    ] },
    { to: '/admin/images', icon: ImageIcon, title: t('admin.nav.images'), rows: [
      [t('admin.data.imageStatus.matched'), n(d.images.matched)],
      [t('admin.data.filters.unlinked'), n(d.images.unlinked), d.images.unlinked ? 'warn' : undefined],
      [t('admin.data.images.indexed'), `${n(d.images.indexed)} / ${n(d.images.matched)}`],
      [t('admin.data.storage.size'), formatBytes(d.images.bytes)],
    ] },
    { to: '/admin/history', icon: FileClock, title: t('admin.nav.history'), rows: [
      [t('admin.data.history.running'), n(d.import_jobs.running), d.import_jobs.stale_running ? 'warn' : undefined],
      [t('admin.import.status.failed'), n(d.import_jobs.failed), d.import_jobs.failed ? 'error' : undefined],
      [t('admin.import.status.completed_with_warnings'), n(d.import_jobs.warnings)],
      [t('admin.data.overview.lastImport'), formatDateTime(d.import_jobs.last_at, lng)],
    ] },
    { to: '/admin/storage', icon: HardDrive, title: t('admin.nav.orphans'), rows: [
      [t('admin.data.cleanupStatus.pending'), n(d.storage_cleanup.pending), d.storage_cleanup.pending ? 'warn' : undefined],
      [t('admin.data.cleanupStatus.failed'), n(d.storage_cleanup.failed), d.storage_cleanup.failed ? 'error' : undefined],
      [t('admin.data.cleanupStatus.done'), n(d.storage_cleanup.done)],
      [t('admin.nav.audit'), `${n(d.audit.admin_actions)} · ${formatDateTime(d.audit.last_action_at, lng)}`],
    ] },
  ]
  return (
    <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {sections.map((s) => (
        <Link key={s.to} to={s.to} className="card block p-4 transition-colors hover:border-brand-300">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-ink-900"><s.icon className="h-4 w-4 text-brand-600" /> {s.title}</div>
          <dl className="mt-3 space-y-1 text-[13px]">
            {s.rows.map(([k, v, tone]) => (
              <div key={k} className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-500">{k}</dt>
                <dd className={cn('text-end font-semibold tabular-nums text-ink-900', tone === 'warn' && 'text-amber-700', tone === 'error' && 'text-red-700')}>{v}</dd>
              </div>
            ))}
          </dl>
        </Link>
      ))}
      {d.import_jobs.stale_running > 0 && (
        <Notice tone="warn" className="md:col-span-2 xl:col-span-4 flex items-center gap-2"><Archive className="h-4 w-4" /> {t('admin.data.overview.staleRunning', { count: d.import_jobs.stale_running })}</Notice>
      )}
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
  const { t } = useTranslation()
  return <span className={cn('inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold', map[status])}>{t(`admin.import.status.${status}`)}</span>
}
