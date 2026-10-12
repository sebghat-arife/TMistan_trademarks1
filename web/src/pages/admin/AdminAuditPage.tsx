import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Download, Lock, RefreshCw } from 'lucide-react'
import { cn, formatDateTime, formatNumber } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { downloadText, toCsv } from '@/lib/import/spreadsheet'
import { ErrorState } from '@/components/AsyncState'
import { DataManagementGate, Mono, Notice, PageHeader, Pager, Pill, StickyDetailCell, Toolbar, shortId, useScrollerWidth } from '@/components/admin/AdminUi'
import { type AdminAction, listAdminActions, listAuditLogs } from '@/services/admin_data_service'

const LIMIT = 50
const ACTIONS = ['trademarks.delete', 'trademarks.archive', 'trademarks.restore', 'images.delete', 'import_job.delete_records', 'import_job.delete', 'import_job.cancel', 'import_job.purge', 'storage.delete_orphans']

export function AdminAuditPage() {
  const { t } = useTranslation()
  useDocumentTitle(`${t('admin.nav.audit')} · ${t('app.shortName')}`)
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') === 'rows' ? 'rows' : 'actions'
  return (
    <div>
      <PageHeader title={t('admin.nav.audit')} subtitle={t('admin.data.audit.subtitle')} />
      <DataManagementGate>
        <div className="mt-5 inline-flex overflow-hidden rounded-md border border-ink-200 bg-white text-[13px]">
          {(['actions', 'rows'] as const).map((k) => (
            <button key={k} type="button" className={cn('px-4 py-2 font-medium', tab === k ? 'bg-brand-600 text-white' : 'text-ink-700 hover:bg-ink-100')} onClick={() => setSp(k === 'actions' ? {} : { tab: k }, { replace: true })}>
              {t(`admin.data.audit.tab.${k}`)}
            </button>
          ))}
        </div>
        <Notice tone="info" className="mt-3 inline-flex items-center gap-2"><Lock className="h-3.5 w-3.5" /> {t('admin.data.audit.immutable')}</Notice>
        {tab === 'actions' ? <ActionsTable /> : <RowChangesTable />}
      </DataManagementGate>
    </div>
  )
}

function ActionsTable() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const [sp, setSp] = useSearchParams()
  const params = useMemo(() => ({ action: sp.get('action'), jobId: sp.get('job'), limit: LIMIT, offset: Number(sp.get('offset') ?? 0) || 0 }), [sp])
  const scrollerRef = useScrollerWidth()
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp)
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    if (!('offset' in patch)) next.delete('offset')
    setSp(next, { replace: true })
  }
  const q = useQuery({ queryKey: ['admin', 'actions', params], queryFn: () => listAdminActions(params), placeholderData: (prev) => prev, staleTime: 10_000 })
  const rows = q.data?.items ?? []
  const [open, setOpen] = useState<number | null>(null)
  return (
    <section className="card mt-3 overflow-hidden">
      <Toolbar className="px-4 py-3">
        <select className="field h-9 w-64" value={params.action ?? ''} onChange={(e) => update({ action: e.target.value || null })}>
          <option value="">{t('admin.data.filters.allActions')}</option>
          {ACTIONS.map((a) => <option key={a} value={a}>{t(`admin.data.actionNames.${a}`, { defaultValue: a })}</option>)}
        </select>
        {params.jobId && <span className="text-[13px] text-ink-600">{t('admin.data.trademarks.filteredByJob')} <Mono>{shortId(params.jobId)}</Mono> <button type="button" className="link-green ms-1" onClick={() => update({ job: null })}>{t('admin.data.clearFilter')}</button></span>}
        <button type="button" className="btn-ghost h-9 px-2" onClick={() => void q.refetch()} aria-label={t('admin.import.refresh')}><RefreshCw className={cn('h-4 w-4', q.isFetching && 'animate-spin')} /></button>
        <button type="button" className="btn-secondary ms-auto h-9 px-3 text-[12px]" disabled={rows.length === 0} onClick={() => downloadText('admin-actions.csv', toCsv(['time', 'admin', 'action', 'target_type', 'count', 'status', 'serials', 'paths', 'job'], rows.map((a) => [a.created_at, a.actor_email ?? a.actor_id, a.action, a.target_type, a.affected_count, a.status, a.serials.join(' '), a.storage_paths.join(' '), a.job_id])))}><Download className="h-3.5 w-3.5" /> CSV</button>
      </Toolbar>
      {q.isError && <ErrorState className="m-4" error={q.error} />}
      <div ref={scrollerRef} className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="border-y border-ink-200 bg-ink-50 text-[12px] text-ink-600">
            <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
              <th>{t('admin.data.audit.time')}</th><th>{t('admin.data.audit.admin')}</th><th>{t('admin.data.audit.action')}</th><th>{t('admin.data.audit.target')}</th><th className="text-end">{t('admin.data.audit.count')}</th><th>{t('admin.status')}</th><th>{t('admin.data.audit.details')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((a) => (
              <ActionRow key={a.id} a={a} lng={lng} open={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} />
            ))}
            {!q.isLoading && rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-ink-500">{t('admin.data.audit.noActions')}</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager className="border-t border-ink-200 px-4 py-2" total={q.data?.total ?? 0} offset={params.offset} limit={LIMIT} onChange={(o) => update({ offset: o ? String(o) : null })} />
    </section>
  )
}

function ActionRow({ a, lng, open, onToggle }: { a: AdminAction; lng: string | undefined; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  const details = Object.entries(a.details ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '')
  return (
    <>
      <tr className="hover:bg-ink-50">
        <td className="whitespace-nowrap px-4 py-2 text-ink-700">{formatDateTime(a.created_at, lng)}</td>
        <td className="px-4 py-2 text-ink-700">{a.actor_email ?? <Mono>{shortId(a.actor_id)}</Mono>}</td>
        <td className="px-4 py-2 font-medium text-ink-900">{t(`admin.data.actionNames.${a.action}`, { defaultValue: a.action })}</td>
        <td className="px-4 py-2 text-ink-700">{t(`admin.data.targetTypes.${a.target_type}`, { defaultValue: a.target_type })}{a.job_id && <> · <Link to={`/admin/history?job=${a.job_id}`} className="link-green"><Mono>{shortId(a.job_id)}</Mono></Link></>}</td>
        <td className="px-4 py-2 text-end">{formatNumber(a.affected_count, lng)}</td>
        <td className="px-4 py-2"><Pill tone={a.status === 'success' ? 'ok' : a.status === 'partial' ? 'warn' : a.status === 'failed' ? 'error' : 'muted'}>{t(`admin.data.actionStatus.${a.status}`)}</Pill></td>
        <td className="px-4 py-2"><button type="button" className="link-green" onClick={onToggle}>{open ? t('admin.import.hideReport') : t('admin.data.audit.show')}</button></td>
      </tr>
      {open && (
        <tr>
          <StickyDetailCell colSpan={7} className="bg-ink-50/70 text-[12px]">
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <p className="mb-1 font-semibold text-ink-800">{t('admin.data.audit.serials')} ({a.serials.length})</p>
                <div className="max-h-32 overflow-auto rounded border border-ink-200 bg-white p-2" dir="ltr"><Mono>{a.serials.join(', ') || '—'}</Mono></div>
              </div>
              <div>
                <p className="mb-1 font-semibold text-ink-800">{t('admin.data.audit.paths')} ({a.storage_paths.length})</p>
                <div className="max-h-32 overflow-auto rounded border border-ink-200 bg-white p-2" dir="ltr"><Mono>{a.storage_paths.join('\n') || '—'}</Mono></div>
              </div>
              <div>
                <p className="mb-1 font-semibold text-ink-800">{t('admin.data.audit.details')}</p>
                <div className="max-h-32 overflow-auto rounded border border-ink-200 bg-white p-2" dir="ltr">
                  <Mono>{details.length ? details.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('\n') : '—'}</Mono>
                  <p className="mt-1 text-ink-500">ids: {a.target_ids.length}</p>
                </div>
              </div>
            </div>
          </StickyDetailCell>
        </tr>
      )}
    </>
  )
}

function RowChangesTable() {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const [sp, setSp] = useSearchParams()
  const params = useMemo(() => ({ table: sp.get('table'), action: sp.get('op'), rowId: sp.get('row'), limit: LIMIT, offset: Number(sp.get('offset') ?? 0) || 0 }), [sp])
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp)
    next.set('tab', 'rows')
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    if (!('offset' in patch)) next.delete('offset')
    setSp(next, { replace: true })
  }
  const q = useQuery({ queryKey: ['admin', 'audit_logs', params], queryFn: () => listAuditLogs(params), placeholderData: (prev) => prev, staleTime: 10_000 })
  const rows = q.data?.items ?? []
  return (
    <section className="card mt-3 overflow-hidden">
      <Toolbar className="px-4 py-3">
        <select className="field h-9 w-48" value={params.table ?? ''} onChange={(e) => update({ table: e.target.value || null })}>
          <option value="">{t('admin.data.filters.allTables')}</option>
          <option value="trademarks">trademarks</option>
          <option value="trademark_images">trademark_images</option>
          <option value="gazettes">gazettes</option>
        </select>
        <select className="field h-9 w-40" value={params.action ?? ''} onChange={(e) => update({ op: e.target.value || null })}>
          <option value="">{t('admin.data.filters.allOps')}</option>
          <option value="INSERT">INSERT</option><option value="UPDATE">UPDATE</option><option value="DELETE">DELETE</option>
        </select>
        <button type="button" className="btn-ghost h-9 px-2" onClick={() => void q.refetch()} aria-label={t('admin.import.refresh')}><RefreshCw className={cn('h-4 w-4', q.isFetching && 'animate-spin')} /></button>
      </Toolbar>
      {q.isError && <ErrorState className="m-4" error={q.error} />}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="border-y border-ink-200 bg-ink-50 text-[12px] text-ink-600">
            <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
              <th>{t('admin.data.audit.time')}</th><th>{t('admin.data.audit.table')}</th><th>{t('admin.data.audit.op')}</th><th>{t('fields.serial')}</th><th>{t('admin.data.audit.changedFields')}</th><th>{t('admin.data.audit.actor')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-ink-50">
                <td className="whitespace-nowrap px-4 py-2 text-ink-700">{formatDateTime(r.created_at, lng)}</td>
                <td className="px-4 py-2"><Mono>{r.table_name}</Mono></td>
                <td className="px-4 py-2"><Pill tone={r.action === 'DELETE' ? 'error' : r.action === 'UPDATE' ? 'info' : 'ok'}>{r.action}</Pill></td>
                <td className="px-4 py-2"><Mono className="font-semibold">{r.serial ?? shortId(r.row_id)}</Mono></td>
                <td className="max-w-[320px] truncate px-4 py-2 text-ink-700" dir="ltr">{Array.isArray(r.changed_fields) ? r.changed_fields.join(', ') : r.changed_fields ? JSON.stringify(r.changed_fields) : '—'}</td>
                <td className="px-4 py-2 text-ink-500"><Mono>{shortId(r.actor_id)}</Mono>{r.actor_role ? ` · ${r.actor_role}` : ''}</td>
              </tr>
            ))}
            {!q.isLoading && rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-500">{t('admin.data.audit.noRows')}</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager className="border-t border-ink-200 px-4 py-2" total={q.data?.total ?? 0} offset={params.offset} limit={LIMIT} onChange={(o) => update({ offset: o ? String(o) : null })} />
    </section>
  )
}
