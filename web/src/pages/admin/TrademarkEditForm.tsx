import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2, RefreshCw, Save, X } from 'lucide-react'
import { cn, formatDateTime } from '@/lib/utils'
import type { ReviewStatus, TrademarkRow } from '@/lib/database.types'
import { Mono, Notice, shortId } from '@/components/admin/AdminUi'
import { DataError } from '@/services/_shared'
import { TrademarkEditConflict, type TrademarkPatch, type UpdateTrademarkResult, updateTrademark } from '@/services/admin_data_service'

/* ---------------------------------------------------------------------------
 * Direct record editing (migration 1100). The form is populated from the row
 * the administrator is looking at; on save only the fields that actually
 * differ are sent to `admin_update_trademark`, together with the `updated_at`
 * of that row so a concurrent change is detected instead of overwritten.
 * Images, provenance, timestamps and history are never part of the patch.
 * ------------------------------------------------------------------------- */

type TextField =
  | 'serial_number' | 'official_gazette_number' | 'record_number' | 'registration_number' | 'application_number'
  | 'application_type' | 'trademark_class' | 'publication_date' | 'objection_deadline'
  | 'mark_name' | 'mark_print'
  | 'applicant_name' | 'applicant_address' | 'new_owner' | 'old_owner' | 'new_address' | 'old_address'
  | 'goods_and_services' | 'source_page'
  | 'attorney_or_representative' | 'review_note' | 'review_comment'

interface Draft extends Record<TextField, string> {
  review_status: ReviewStatus
  is_published: boolean
}

const TEXT_FIELDS: TextField[] = [
  'serial_number', 'official_gazette_number', 'record_number', 'registration_number', 'application_number',
  'application_type', 'trademark_class', 'publication_date', 'objection_deadline', 'mark_name', 'mark_print',
  'applicant_name', 'applicant_address', 'new_owner', 'old_owner', 'new_address', 'old_address',
  'goods_and_services', 'source_page', 'attorney_or_representative', 'review_note', 'review_comment',
]
const REQUIRED: TextField[] = ['serial_number', 'official_gazette_number']
const SHORT_FIELDS: TextField[] = ['record_number', 'registration_number', 'application_number', 'trademark_class', 'source_page', 'application_type']
const REVIEW_STATUSES: ReviewStatus[] = ['unreviewed', 'reviewed', 'needs_correction', 'verified']
const MAX_LONG = 20000
const MAX_SHORT = 500

const norm = (v: string) => v.trim()
const toDraft = (r: TrademarkRow): Draft => ({
  ...(Object.fromEntries(TEXT_FIELDS.map((f) => [f, (r[f] as string | null | undefined) ?? ''])) as Record<TextField, string>),
  review_status: r.review_status,
  is_published: r.is_published,
})

/** Fields whose draft value differs from the base row, as the patch the database expects. */
function diff(draft: Draft, base: TrademarkRow): TrademarkPatch {
  const patch: TrademarkPatch = {}
  for (const f of TEXT_FIELDS) {
    const next = norm(draft[f]) || null
    const prev = (base[f] as string | null | undefined) ?? null
    if (next !== prev) patch[f] = next
  }
  if (draft.review_status !== base.review_status) patch.review_status = draft.review_status
  if (draft.is_published !== base.is_published) patch.is_published = draft.is_published
  return patch
}

export interface TrademarkEditFormProps {
  record: TrademarkRow
  onSaved: (result: UpdateTrademarkResult) => void
  onCancel: () => void
  onDirtyChange: (dirty: boolean) => void
  /** Fetch the latest version of the row (conflict reconciliation). */
  onReload: () => Promise<TrademarkRow | null>
  onOpenOther?: (id: string) => void
}

export function TrademarkEditForm({ record, onSaved, onCancel, onDirtyChange, onReload, onOpenOther }: TrademarkEditFormProps) {
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage
  const [base, setBase] = useState<TrademarkRow>(record)
  const [draft, setDraft] = useState<Draft>(() => toDraft(record))
  const [reason, setReason] = useState('')
  const [releaseProtection, setReleaseProtection] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [conflict, setConflict] = useState<TrademarkEditConflict | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [touched, setTouched] = useState<Partial<Record<TextField, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)

  const patch = useMemo(() => diff(draft, base), [draft, base])
  const changedCount = Object.keys(patch).length
  const dirty = changedCount > 0 || releaseProtection
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => {
    if (!dirty) return
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [dirty])

  // client-side validation (the database validates again)
  const errors = useMemo(() => {
    const e: Partial<Record<TextField, string>> = {}
    for (const f of REQUIRED) if (!norm(draft[f])) e[f] = t('admin.data.edit.required')
    for (const f of ['publication_date', 'objection_deadline'] as TextField[]) {
      const v = norm(draft[f])
      if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))) e[f] = t('admin.data.edit.invalidDate')
    }
    for (const f of TEXT_FIELDS) {
      const max = SHORT_FIELDS.includes(f) ? MAX_SHORT : f === 'serial_number' || f === 'official_gazette_number' ? 64 : MAX_LONG
      if (draft[f].length > max) e[f] = t('admin.data.edit.tooLong', { max })
    }
    return e
  }, [draft, t])
  const hasErrors = Object.keys(errors).length > 0
  const showError = (f: TextField) => (submitted || touched[f]) && errors[f]

  const protectedFields = base.manual_edit_fields ?? []
  const identifierChanged = 'serial_number' in patch || 'official_gazette_number' in patch
  const otherId = conflict?.kind === 'duplicate' ? conflict.other?.id ?? null : null

  const set = (f: TextField, v: string) => setDraft((d) => ({ ...d, [f]: v }))

  const save = async () => {
    setSubmitted(true)
    if (hasErrors) {
      // bring the first invalid field into view (sections may be collapsed or scrolled away)
      const first = Object.keys(errors)[0]
      const el = first ? document.getElementById(`tm-edit-${first}`) : null
      el?.closest('details')?.setAttribute('open', '')
      el?.scrollIntoView({ block: 'center' }); el?.focus()
      return
    }
    if (saving) return
    if (!dirty) { setInfo(t('admin.data.edit.savedNoChange')); return }
    setSaving(true); setError(null); setConflict(null); setInfo(null)
    try {
      const r = await updateTrademark(base.id, patch, base.updated_at, { reason: reason.trim() || null, releaseProtection })
      onSaved(r)
    } catch (e) {
      if (e instanceof TrademarkEditConflict) setConflict(e)
      else setError(e)
    } finally {
      setSaving(false)
    }
  }

  /** Conflict reconciliation: rebase the administrator's edits on the latest row. */
  const reload = async () => {
    setSaving(true)
    try {
      const fresh = await onReload()
      if (!fresh) { setConflict(null); setError(new DataError(t('admin.data.edit.gone'), 'not_found')); return }
      const mine = patch
      const rebased = toDraft(fresh)
      for (const [k, v] of Object.entries(mine)) {
        if (k === 'is_published') rebased.is_published = v as boolean
        else if (k === 'review_status') rebased.review_status = v as ReviewStatus
        else rebased[k as TextField] = (v as string | null) ?? ''
      }
      setBase(fresh); setDraft(rebased); setConflict(null); setInfo(t('admin.data.edit.reloaded'))
    } catch (e) {
      setError(e)
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, saving])

  const label = (f: TextField) => t(`admin.import.columns.${f}`)
  const field = (f: TextField, opts: { type?: 'text' | 'date' | 'textarea'; rows?: number; dir?: 'auto' | 'ltr' } = {}) => {
    const id = `tm-edit-${f}`
    const err = showError(f)
    const common = {
      id,
      value: draft[f],
      'aria-invalid': !!err,
      'aria-describedby': err ? `${id}-err` : undefined,
      onBlur: () => setTouched((x) => ({ ...x, [f]: true })),
      disabled: saving,
    }
    return (
      <div key={f} className={cn(opts.type === 'textarea' && 'sm:col-span-2')}>
        <label htmlFor={id} className="mb-1 block text-[12px] font-medium text-ink-600">
          {f === 'review_comment' ? t('admin.data.trademarks.reviewComment') : label(f)}
          {REQUIRED.includes(f) && <span className="text-red-600"> *</span>}
          {protectedFields.includes(f) && <span className="ms-1 rounded bg-brand-50 px-1 text-[10px] font-semibold uppercase tracking-wide text-brand-700">{t('admin.data.edit.protectedTag')}</span>}
        </label>
        {opts.type === 'textarea' ? (
          <textarea {...common} rows={opts.rows ?? 3} dir={opts.dir ?? 'auto'} className={cn('field min-h-[72px] resize-y py-2', err && 'border-red-400')} onChange={(e) => set(f, e.target.value)} />
        ) : (
          <input {...common} type={opts.type ?? 'text'} dir={opts.dir ?? 'auto'} className={cn('field', err && 'border-red-400')} onChange={(e) => set(f, e.target.value)} />
        )}
        {err && <p id={`${id}-err`} className="mt-1 text-[12px] text-red-700">{err}</p>}
      </div>
    )
  }

  return (
    <form
      className="space-y-4 text-[13px]"
      noValidate
      onSubmit={(e) => { e.preventDefault(); void save() }}
      data-testid="trademark-edit-form"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Mono className="text-[14px] font-bold text-ink-900">{base.serial_number}</Mono>
        <span className="text-ink-500">· {t('admin.data.edit.title')}</span>
      </div>

      {identifierChanged && <Notice tone="warn">{t('admin.data.edit.identifierWarning')}</Notice>}

      <Section title={t('admin.data.edit.sections.identification')} testId="edit-section-identification">
        {field('serial_number', { dir: 'ltr' })}
        {field('official_gazette_number', { dir: 'ltr' })}
        {field('record_number', { dir: 'ltr' })}
        {field('registration_number', { dir: 'ltr' })}
        {field('application_number', { dir: 'ltr' })}
        {field('application_type')}
        {field('trademark_class', { dir: 'ltr' })}
        {field('publication_date', { type: 'date', dir: 'ltr' })}
        {field('objection_deadline', { type: 'date', dir: 'ltr' })}
      </Section>

      <Section title={t('admin.data.edit.sections.mark')}>
        {field('mark_name')}
        {field('mark_print')}
      </Section>

      <Section title={t('admin.data.edit.sections.applicant')}>
        {field('applicant_name')}
        {field('applicant_address', { type: 'textarea', rows: 2 })}
        {field('new_owner')}
        {field('old_owner')}
        {field('new_address', { type: 'textarea', rows: 2 })}
        {field('old_address', { type: 'textarea', rows: 2 })}
      </Section>

      <Section title={t('admin.data.edit.sections.goods')}>
        {field('goods_and_services', { type: 'textarea', rows: 5 })}
        {field('source_page', { dir: 'ltr' })}
      </Section>

      <Section title={t('admin.data.trademarks.internal')} tone="internal" testId="edit-section-internal">
        {field('attorney_or_representative')}
        {field('review_note', { type: 'textarea', rows: 2 })}
        {field('review_comment', { type: 'textarea', rows: 2 })}
        <div>
          <label htmlFor="tm-edit-review_status" className="mb-1 block text-[12px] font-medium text-ink-600">{t('admin.data.edit.reviewStatus')}</label>
          <select id="tm-edit-review_status" className="field" value={draft.review_status} disabled={saving} onChange={(e) => setDraft((d) => ({ ...d, review_status: e.target.value as ReviewStatus }))}>
            {REVIEW_STATUSES.map((s) => <option key={s} value={s}>{t(`admin.data.edit.statusLabels.${s}`)}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-[13px] text-ink-800">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={draft.is_published} disabled={saving} onChange={(e) => setDraft((d) => ({ ...d, is_published: e.target.checked }))} />
          {t('admin.data.edit.published')}
        </label>
      </Section>

      <Section title={t('admin.data.edit.sections.reason')}>
        <div className="sm:col-span-2">
          <input value={reason} maxLength={500} disabled={saving} dir="auto" className="field" placeholder={t('admin.data.edit.reasonPlaceholder')} onChange={(e) => setReason(e.target.value)} aria-label={t('admin.data.edit.sections.reason')} />
        </div>
        {protectedFields.length > 0 && (
          <label className="flex items-start gap-2 text-[12px] text-ink-700 sm:col-span-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={releaseProtection} disabled={saving} onChange={(e) => setReleaseProtection(e.target.checked)} />
            <span>{t('admin.data.edit.releaseProtection')} <span className="text-ink-500">({protectedFields.map((f) => t(`admin.import.columns.${f}`, { defaultValue: f })).join(', ')})</span></span>
          </label>
        )}
      </Section>

      <Section title={t('admin.data.edit.sections.system')} tone="system">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[12px] sm:col-span-2">
          <dt className="text-ink-500">{t('admin.data.trademarks.sourceFile')}</dt>
          <dd className="min-w-0 break-words text-ink-800">{base.source_file ? <Mono>{base.source_file}{base.source_sheet ? ` / ${base.source_sheet}` : ''}{base.source_row ? ` / ${t('admin.import.columns.source_row')} ${base.source_row}` : ''}</Mono> : '—'}</dd>
          <dt className="text-ink-500">{t('admin.data.created')}</dt>
          <dd className="text-ink-800">{formatDateTime(base.created_at, lng)}</dd>
          <dt className="text-ink-500">{t('admin.data.updated')}</dt>
          <dd className="text-ink-800">{formatDateTime(base.updated_at, lng)}</dd>
          {base.manual_edited_at && <><dt className="text-ink-500">{t('admin.data.edit.manuallyEditedAt')}</dt><dd className="text-ink-800">{formatDateTime(base.manual_edited_at, lng)}</dd></>}
          <dt className="text-ink-500">{t('admin.data.provenance.createdBy')}</dt>
          <dd className="text-ink-800">{base.created_by_job_id ? <Mono>{shortId(base.created_by_job_id)}</Mono> : t('admin.data.provenance.unknown')}</dd>
          <dt className="text-ink-500">ID</dt>
          <dd><Mono className="break-all">{base.id}</Mono></dd>
        </dl>
      </Section>

      {/* Feedback + actions are pinned to the bottom of the panel, so a conflict or error is visible wherever the form is scrolled. */}
      <div className="sticky bottom-0 -mx-4 -mb-4 border-t border-ink-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mb-3 max-h-[40vh] space-y-2 overflow-y-auto empty:hidden">
        {conflict?.kind === 'stale' && (
          <Notice tone="warn" title={t('admin.data.edit.conflictStale')}>
            <p className="mt-1 text-[12px]">{conflict.message}</p>
            <button type="button" className="btn-secondary mt-2 h-8 px-3 text-[12px]" onClick={() => void reload()} disabled={saving}><RefreshCw className="h-3.5 w-3.5" /> {t('admin.data.edit.reload')}</button>
          </Notice>
        )}
        {conflict?.kind === 'duplicate' && (
          <Notice tone="error" title={t('admin.data.edit.conflictDuplicate')}>
            <p className="mt-1 text-[12px]">
              <Mono>{conflict.other?.serial_number ?? draft.serial_number}</Mono>
              {conflict.other?.official_gazette_number ? <> · {t('fields.gazetteNumber')} <Mono>{conflict.other.official_gazette_number}</Mono></> : null}
              {conflict.other?.mark_name ? <> · {conflict.other.mark_name}</> : null}
            </p>
            {otherId && onOpenOther && (
              <button type="button" className="link-green mt-1 text-[12px]" onClick={() => onOpenOther(otherId)}>{t('admin.data.edit.openOther')}</button>
            )}
          </Notice>
        )}
        {error != null && (
          <Notice tone="error" title={t('common.error')}>
            <p className="text-[12px]">{errorMessage(error, t)}</p>
          </Notice>
        )}
        {info && <Notice tone="info">{info}</Notice>}
        {submitted && hasErrors && <Notice tone="error">{t('admin.data.edit.fixErrors', { count: Object.keys(errors).length })}</Notice>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn-primary h-9 px-3 text-[12px]" disabled={saving || !dirty || (submitted && hasErrors)} data-testid="edit-save">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} {saving ? t('admin.data.edit.saving') : t('admin.data.edit.save')}
          </button>
          <button type="button" className="btn-secondary h-9 px-3 text-[12px]" onClick={onCancel} disabled={saving} data-testid="edit-cancel"><X className="h-3.5 w-3.5" /> {t('admin.data.edit.cancel')}</button>
          <span className="ms-auto text-[12px] text-ink-500" aria-live="polite">
            {changedCount > 0 ? t('admin.data.edit.changedCount', { count: changedCount }) : t('admin.data.edit.noChanges')}
          </span>
        </div>
      </div>
    </form>
  )
}

function Section({ title, tone = 'default', testId, children }: { title: string; tone?: 'default' | 'internal' | 'system'; testId?: string; children: ReactNode }) {
  return (
    <details open={tone !== 'system'} className={cn('group rounded-md border', tone === 'internal' ? 'border-amber-200 bg-amber-50/60' : tone === 'system' ? 'border-ink-200 bg-ink-50/60' : 'border-ink-200')} data-testid={testId}>
      <summary className={cn('cursor-pointer select-none px-3 py-2 text-[12px] font-semibold uppercase tracking-wide', tone === 'internal' ? 'text-amber-800' : 'text-ink-700')}>
        {tone === 'internal' && <AlertTriangle className="me-1 inline h-3.5 w-3.5" aria-hidden />}{title}
      </summary>
      <div className="grid gap-3 border-t border-inherit px-3 pb-3 pt-3 sm:grid-cols-2">{children}</div>
    </details>
  )
}

function errorMessage(e: unknown, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (e instanceof DataError) {
    if (e.code === 'not_found') return t('admin.data.edit.gone')
    if (e.code === 'forbidden') return t('admin.data.edit.forbidden')
    if (e.code === 'schema_missing') return t('admin.data.edit.notReady', { message: e.message })
    if (e.code === 'auth') return t('admin.data.edit.sessionExpired')
    return e.message
  }
  if (e instanceof TypeError || (e instanceof Error && /fetch|network/i.test(e.message))) return t('admin.data.edit.network')
  return e instanceof Error ? e.message : String(e)
}
