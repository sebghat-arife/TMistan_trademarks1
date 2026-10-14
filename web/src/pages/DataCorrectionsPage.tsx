import { useId, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Copy,
  FileText,
  Files,
  Image as ImageIcon,
  Info,
  ListChecks,
  Loader2,
  Mail,
  MessageCircle,
  Paperclip,
  Search,
  Send,
  ShieldCheck,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { ClosingBanner, FeatureCard, NumberedSteps, SectionHeading, SectionLabel, SidePanel, SplitHero } from '@/components/editorial'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

/** Hero image: illuminated frontispiece of the Makhzan al-Asrar, Herat, late 15th century (LACMA, public domain, cropped) — see public/img/CREDITS.md. */
const HERO_PHOTO_SOURCE = 'https://commons.wikimedia.org/wiki/File:Illuminated_frontispiece_from_the_Makhzan_al-Asrar_(Treasury_of_Mysteries)_LACMA_M.73.5.529.jpg'
import { cn, formatDateTime } from '@/lib/utils'
import {
  CORRECTION_LIMITS,
  CORRECTION_TYPES,
  CorrectionError,
  EVIDENCE,
  EVIDENCE_EXTENSIONS,
  checkCorrectionStatus,
  correctionFormStatusQuery,
  isCorrectionType,
  submitCorrectionRequest,
  uploadEvidence,
  validateEvidenceFile,
  type CorrectionReceipt,
  type CorrectionStatusView,
  type CorrectionType,
  type EvidenceUploadResult,
} from '@/services/correction_service'

const TYPE_ICON: Record<CorrectionType, LucideIcon> = {
  incorrect_name: FileText,
  classification: ListChecks,
  image: ImageIcon,
  publication_reference: CalendarDays,
  duplicate: Files,
  other: MessageCircle,
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MAX_MB = Math.round(EVIDENCE.maxBytes / 1024 / 1024)
const ACCEPT = [...EVIDENCE_EXTENSIONS.map((e) => `.${e}`), ...Object.keys(EVIDENCE.accept)].join(',')

type Values = { fullName: string; email: string; record: string; details: string; confirm: boolean; website: string }
type Field = keyof Values | 'type' | 'files'
type Errors = Partial<Record<Field, string>>
const EMPTY: Values = { fullName: '', email: '', record: '', details: '', confirm: false, website: '' }

type Outcome = { receipt: CorrectionReceipt; uploads: EvidenceUploadResult[] }

/** /data-corrections — public, controlled correction workflow (migration 0900). */
export function DataCorrectionsPage() {
  const { t, i18n } = useTranslation()
  useDocumentTitle(t('corrections.metaTitle'), t('corrections.metaDescription'))
  const [params] = useSearchParams()

  // Deep links: /data-corrections?type=image&serial=1022-073  or  ?gazette=1022
  const [type, setType] = useState<CorrectionType | ''>(() => {
    const v = params.get('type')
    return isCorrectionType(v) ? v : ''
  })
  const [values, setValues] = useState<Values>(() => {
    const serial = (params.get('serial') ?? '').trim().slice(0, 60)
    const gazette = (params.get('gazette') ?? '').trim().slice(0, 30)
    return { ...EMPTY, record: serial || (gazette ? `Gazette ${gazette}` : '') }
  })
  const [files, setFiles] = useState<File[]>([])
  const [errors, setErrors] = useState<Errors>({})
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const topRef = useRef<HTMLDivElement>(null)

  const status = useQuery(correctionFormStatusQuery())
  const available = status.data !== false // optimistic while probing; the submit button waits for the probe

  const set = <K extends keyof Values>(k: K, v: Values[K]) => {
    setValues((s) => ({ ...s, [k]: v }))
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }))
  }
  const chooseType = (next: CorrectionType | '') => {
    setType(next)
    if (errors.type) setErrors((e) => ({ ...e, type: undefined }))
  }

  const onFiles = (ev: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(ev.target.files ?? [])
    ev.target.value = '' // allow choosing the same file again after removing it
    const next = [...files]
    let err: string | undefined
    for (const f of picked) {
      if (next.length >= EVIDENCE.maxFiles) {
        err = t('corrections.form.errors.fileCount', { count: EVIDENCE.maxFiles })
        break
      }
      const invalid = validateEvidenceFile(f)
      if (invalid === 'type') err = t('corrections.form.errors.fileType', { name: f.name })
      else if (invalid === 'size') err = t('corrections.form.errors.fileSize', { name: f.name, mb: MAX_MB })
      else if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f)
    }
    setFiles(next)
    setErrors((e) => ({ ...e, files: err }))
  }
  const removeFile = (i: number) => {
    setFiles((fs) => fs.filter((_, idx) => idx !== i))
    setErrors((e) => ({ ...e, files: undefined }))
  }

  const validate = (): Errors => {
    const e: Errors = {}
    if (!type) e.type = t('corrections.form.errors.type')
    const name = values.fullName.trim()
    if (!name) e.fullName = t('corrections.form.errors.required')
    else if (name.length < 2) e.fullName = t('corrections.form.errors.min', { count: 2 })
    else if (name.length > CORRECTION_LIMITS.name) e.fullName = t('corrections.form.errors.max', { count: CORRECTION_LIMITS.name })
    const email = values.email.trim()
    if (!email) e.email = t('corrections.form.errors.required')
    else if (!EMAIL_RE.test(email) || email.length > CORRECTION_LIMITS.email) e.email = t('corrections.form.errors.email')
    if (values.record.trim().length > CORRECTION_LIMITS.record) e.record = t('corrections.form.errors.max', { count: CORRECTION_LIMITS.record })
    const details = values.details.trim()
    if (!details) e.details = t('corrections.form.errors.required')
    else if (details.length < CORRECTION_LIMITS.descriptionMin) e.details = t('corrections.form.errors.min', { count: CORRECTION_LIMITS.descriptionMin })
    else if (details.length > CORRECTION_LIMITS.description) e.details = t('corrections.form.errors.max', { count: CORRECTION_LIMITS.description })
    if (files.length > EVIDENCE.maxFiles) e.files = t('corrections.form.errors.fileCount', { count: EVIDENCE.maxFiles })
    if (!values.confirm) e.confirm = t('corrections.form.errors.confirm')
    return e
  }

  const [phase, setPhase] = useState<'idle' | 'submitting' | 'uploading'>('idle')
  const mutation = useMutation({
    mutationFn: async (): Promise<Outcome> => {
      setPhase('submitting')
      const receipt = await submitCorrectionRequest({
        requestType: type as CorrectionType,
        fullName: values.fullName,
        email: values.email,
        description: values.details,
        relatedRecord: values.record,
        locale: i18n.language,
        pageUrl: `${window.location.origin}${window.location.pathname}`, // no query string: it may carry a serial, nothing else
        honeypot: values.website,
      })
      let uploads: EvidenceUploadResult[] = []
      if (files.length > 0) {
        setPhase('uploading')
        uploads = await uploadEvidence(receipt.id, files)
      }
      return { receipt, uploads }
    },
    onSuccess: (o) => {
      setOutcome(o)
      window.setTimeout(() => topRef.current?.scrollIntoView({ block: 'start' }), 20)
    },
    onSettled: () => setPhase('idle'),
  })

  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault()
    if (mutation.isPending) return // duplicate-click guard (the button is disabled as well)
    const e = validate()
    setErrors(e)
    const first = (Object.keys(e) as Field[]).find((k) => e[k])
    if (first) {
      const el = formRef.current?.querySelector<HTMLElement>(first === 'type' ? 'select[name="type"]' : first === 'files' ? '#cr-file-button' : `[name="${first}"]`)
      el?.focus()
      el?.scrollIntoView({ block: 'center' })
      return
    }
    mutation.mutate()
  }

  const reset = () => {
    setValues({ ...EMPTY })
    setType('')
    setFiles([])
    setErrors({})
    setOutcome(null)
    mutation.reset()
  }

  const failure = mutation.error as CorrectionError | null
  const failureText = !failure
    ? null
    : failure.code === 'rate_limited'
      ? t('corrections.status.rateLimited')
      : failure.code === 'validation'
        ? `${t('corrections.form.errors.fix')} ${failure.message}`
        : t('corrections.status.failedText')

  const benefits = [
    { Icon: ShieldCheck, key: 'report' },
    { Icon: Search, key: 'review' },
    { Icon: ClipboardList, key: 'track' },
    { Icon: BadgeCheck, key: 'better' },
  ] as const

  return (
    <div data-testid="corrections-page">
      <SplitHero
        label={t('corrections.label')}
        title={t('corrections.title')}
        text={t('corrections.intro')}
        image="/img/hero-corrections.jpg"
        imagePosition="50% 50%"
        credit={{ text: t('corrections.photoCredit'), href: HERO_PHOTO_SOURCE }}
        benefits={benefits.map(({ Icon, key }) => ({ Icon, title: t(`corrections.benefits.${key}.title`), text: t(`corrections.benefits.${key}.text`) }))}
      />

      <div className="container-x py-12 md:py-14">
        {/* What you can report */}
        <SectionHeading label={t('corrections.types.label')} title={t('corrections.types.title')} text={t('corrections.types.text')} id="report-types" />
        <ul className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6" role="list">
          {CORRECTION_TYPES.map((k) => (
            <li key={k}>
              <FeatureCard
                Icon={TYPE_ICON[k]}
                title={t(`corrections.types.items.${k}.title`)}
                text={t(`corrections.types.items.${k}.text`)}
                onClick={() => {
                  chooseType(k)
                  formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
                }}
                selected={type === k}
                linkLabel={type === k ? t('corrections.types.selected') : undefined}
                testId={`type-card-${k}`}
              />
            </li>
          ))}
        </ul>

        <div ref={topRef} className="mt-12 grid scroll-mt-24 gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)] lg:gap-10">
          {/* ───────────── Form column ───────────── */}
          <div className="min-w-0 space-y-6">
            {outcome ? (
              <SuccessPanel outcome={outcome} onReset={reset} />
            ) : (
              <form ref={formRef} className="card scroll-mt-24 p-6 md:p-8" onSubmit={onSubmit} noValidate data-testid="correction-form">
                <SectionLabel>{t('corrections.form.label')}</SectionLabel>
                <h2 className="ed-h2 mt-2" id="request-form">{t('corrections.form.title')}</h2>
                <p className="mt-2 text-[14.5px] leading-relaxed text-ink-600">{t('corrections.form.text')}</p>

                {status.data === false && (
                  <div role="status" className="mt-6 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-[13.5px] text-amber-900" data-testid="correction-unavailable">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                    <div>
                      <p className="font-semibold">{t('corrections.status.unavailableTitle')}</p>
                      <p className="mt-1 leading-relaxed">{t('corrections.status.unavailableText')}</p>
                      <Link to="/contact?type=data-correction" className="mt-2 inline-flex items-center gap-1 font-semibold underline underline-offset-2">
                        {t('corrections.status.contactLink')}
                        <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                      </Link>
                    </div>
                  </div>
                )}

                <fieldset className="mt-6" disabled={mutation.isPending || !available}>
                  <legend className="sr-only">{t('corrections.form.title')}</legend>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Input name="fullName" label={t('corrections.form.fullName')} placeholder={t('corrections.form.fullNamePlaceholder')} required value={values.fullName} onChange={(v) => set('fullName', v)} error={errors.fullName} autoComplete="name" maxLength={CORRECTION_LIMITS.name} />
                    <Input name="email" type="email" label={t('corrections.form.email')} placeholder={t('corrections.form.emailPlaceholder')} required value={values.email} onChange={(v) => set('email', v)} error={errors.email} autoComplete="email" inputMode="email" dir="ltr" />
                    <FieldShell id="cr-type" label={t('corrections.form.type')} required error={errors.type}>
                      <select id="cr-type" name="type" value={type} onChange={(e) => chooseType(isCorrectionType(e.target.value) ? e.target.value : '')} required aria-required aria-invalid={!!errors.type || undefined} aria-describedby={errors.type ? 'cr-type-error' : undefined} className={cn('field', !type && 'text-ink-400', errors.type && 'border-red-400')} data-testid="correction-type">
                        <option value="">{t('corrections.form.typePlaceholder')}</option>
                        {CORRECTION_TYPES.map((k) => (
                          <option key={k} value={k} className="text-ink-900">{t(`corrections.types.items.${k}.title`)}</option>
                        ))}
                      </select>
                    </FieldShell>
                    <Input name="record" label={t('corrections.form.record')} placeholder={t('corrections.form.recordPlaceholder')} value={values.record} onChange={(v) => set('record', v)} error={errors.record} hint={t('corrections.form.recordHint')} maxLength={CORRECTION_LIMITS.record} dir="ltr" />
                  </div>

                  <FieldShell id="cr-details" label={t('corrections.form.details')} required error={errors.details} hint={t('corrections.form.counter', { count: values.details.length, max: CORRECTION_LIMITS.description })} className="mt-5">
                    <textarea
                      id="cr-details"
                      name="details"
                      value={values.details}
                      onChange={(e) => set('details', e.target.value)}
                      placeholder={t('corrections.form.detailsPlaceholder')}
                      required
                      aria-required
                      aria-invalid={!!errors.details || undefined}
                      aria-describedby={errors.details ? 'cr-details-error' : 'cr-details-hint'}
                      maxLength={CORRECTION_LIMITS.description}
                      rows={6}
                      className={cn('field min-h-[150px] resize-y', errors.details && 'border-red-400 focus:border-red-500 focus:ring-red-100')}
                    />
                  </FieldShell>

                  {/* Attachments */}
                  <div className={cn('mt-5 rounded-lg border border-dashed p-4 sm:p-5', errors.files ? 'border-red-300 bg-red-50/40' : 'border-ink-300 bg-ink-50/50')} data-testid="correction-files">
                    <div className="flex gap-3">
                      <Paperclip className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-semibold text-ink-900" id="cr-files-label">{t('corrections.form.attach')}</p>
                        <p className="mt-0.5 text-[12.5px] text-ink-600">{t('corrections.form.attachText')}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <button type="button" id="cr-file-button" onClick={() => fileRef.current?.click()} aria-describedby="cr-files-label cr-files-hint" className="btn btn-secondary h-9 text-[13px]">
                            {t('corrections.form.choose')}
                          </button>
                          <input ref={fileRef} id="cr-files" name="files" type="file" accept={ACCEPT} multiple onChange={onFiles} className="sr-only" tabIndex={-1} aria-labelledby="cr-files-label" data-testid="correction-file-input" />
                          <span className="text-[12.5px] text-ink-500">{files.length === 0 ? t('corrections.form.noFile') : t('corrections.form.filesChosen', { count: files.length })}</span>
                        </div>
                        {files.length > 0 && (
                          <ul className="mt-3 space-y-1.5" aria-label={t('corrections.status.attachments')}>
                            {files.map((f, i) => (
                              <li key={`${f.name}-${f.size}`} className="flex items-center gap-2 rounded border border-ink-200 bg-white px-3 py-1.5 text-[12.5px] text-ink-800">
                                <FileText className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden />
                                <span className="min-w-0 flex-1 truncate" dir="ltr">{f.name}</span>
                                <span className="shrink-0 text-ink-500">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
                                <button type="button" onClick={() => removeFile(i)} className="rounded p-0.5 text-ink-500 hover:bg-ink-100 hover:text-red-600" aria-label={t('corrections.form.remove', { name: f.name })}>
                                  <X className="h-3.5 w-3.5" aria-hidden />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        <p id="cr-files-hint" className="mt-3 text-[11.5px] text-ink-500">
                          {t('corrections.form.formats')} &nbsp;|&nbsp; {t('corrections.form.maxSize', { mb: MAX_MB })} &nbsp;|&nbsp; {t('corrections.form.maxFiles', { count: EVIDENCE.maxFiles })}
                        </p>
                        {errors.files && <p className="mt-1.5 text-[12.5px] text-red-700" role="alert">{errors.files}</p>}
                      </div>
                    </div>
                  </div>

                  {/* Honeypot — invisible to people, tempting for bots */}
                  <div className="hp-field" aria-hidden>
                    <label htmlFor="cr-website">Website</label>
                    <input id="cr-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={values.website} onChange={(e) => set('website', e.target.value)} />
                  </div>

                  <div className="mt-5">
                    <label className="flex cursor-pointer items-start gap-3 text-[13.5px] leading-relaxed text-ink-700">
                      <input type="checkbox" name="confirm" checked={values.confirm} onChange={(e) => set('confirm', e.target.checked)} aria-invalid={!!errors.confirm || undefined} aria-describedby={errors.confirm ? 'cr-confirm-error' : undefined} className="mt-1 h-4 w-4 shrink-0 accent-brand-600" data-testid="correction-confirm" />
                      <span>
                        {t('corrections.form.confirm')}
                        <span aria-hidden className="text-red-600"> *</span>
                      </span>
                    </label>
                    {errors.confirm && <p id="cr-confirm-error" className="mt-1.5 text-[12.5px] text-red-700" role="alert">{errors.confirm}</p>}
                  </div>

                  {Object.values(errors).some(Boolean) && (
                    <p className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-800" role="alert" data-testid="correction-errors">
                      {t('corrections.form.errors.fix')}
                    </p>
                  )}
                  {failureText && (
                    <div className="mt-5 flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-[13.5px] text-red-900" role="alert" data-testid="correction-failed">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
                      <div>
                        <p className="font-semibold">{t('corrections.status.failedTitle')}</p>
                        <p className="mt-1 leading-relaxed">{failureText}</p>
                      </div>
                    </div>
                  )}

                  <button type="submit" className="btn btn-primary mt-6 h-12 w-full text-[15px]" disabled={mutation.isPending || status.isPending || !available} data-testid="correction-submit">
                    {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                    {phase === 'uploading' ? t('corrections.form.uploading') : mutation.isPending ? t('corrections.form.submitting') : t('corrections.form.submit')}
                  </button>
                  <p className="mt-4 flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-600">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                    <span>
                      <Trans i18nKey="corrections.form.privacy" components={{ 1: <Link to="/legal/privacy" className="font-semibold text-brand-700 underline underline-offset-2" /> }} />
                    </span>
                  </p>
                </fieldset>
              </form>
            )}

            <StatusCheck available={available} />
          </div>

          {/* ───────────── Sidebar ───────────── */}
          <aside className="space-y-5">
            <SidePanel tone="green" className="p-6">
              <div className="flex gap-4">
                <span className="icon-circle h-12 w-12 bg-white"><ShieldCheck className="h-6 w-6" aria-hidden /></span>
                <div>
                  <h2 className="font-serif text-[19px] font-semibold text-navy-900">{t('corrections.process.title')}</h2>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-700">{t('corrections.process.text')}</p>
                </div>
              </div>
              <NumberedSteps className="mt-6" steps={(['receive', 'review', 'update', 'outcome'] as const).map((k) => ({ title: t(`corrections.process.steps.${k}.title`), text: t(`corrections.process.steps.${k}.text`) }))} />
            </SidePanel>
            <SidePanel tone="green">
              <div className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-brand-600"><Info className="h-4 w-4" aria-hidden /></span>
                <div>
                  <h2 className="font-serif text-[17px] font-semibold text-navy-900">{t('corrections.important.title')}</h2>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-700">{t('corrections.important.text')}</p>
                </div>
              </div>
            </SidePanel>
            <SidePanel tone="green">
              <div className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-brand-600"><Mail className="h-4 w-4" aria-hidden /></span>
                <div>
                  <h2 className="font-serif text-[17px] font-semibold text-navy-900">{t('corrections.help.title')}</h2>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-700">{t('corrections.help.text')}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Link to="/help" className="btn btn-secondary h-9 text-[13px]">
                      {t('corrections.help.button')}
                      <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                    </Link>
                    <Link to="/contact" className="link-green">{t('corrections.help.contact')}</Link>
                  </div>
                </div>
              </div>
            </SidePanel>
          </aside>
        </div>

        <ClosingBanner
          className="mt-12"
          label={t('corrections.closing.label')}
          title={t('corrections.closing.title')}
          text={t('corrections.closing.text')}
          testId="corrections-closing"
          action={
            <Link to="/data-sources#ds-quality" className="btn btn-outline-green">
              {t('corrections.closing.button')}
              <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
            </Link>
          }
        />
      </div>
    </div>
  )
}

/* ------------------------------ success ------------------------------ */

function SuccessPanel({ outcome, onReset }: { outcome: Outcome; onReset: () => void }) {
  const { t, i18n } = useTranslation()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(outcome.receipt.reference)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — the reference is visible on screen */
    }
  }
  return (
    <section className="card p-6 md:p-8" aria-live="polite" data-testid="correction-success">
      <span className="icon-circle h-12 w-12"><CheckCircle2 className="h-6 w-6" aria-hidden /></span>
      <h2 className="mt-4 font-serif text-[26px] font-semibold text-navy-900">{t('corrections.status.successTitle')}</h2>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-700">{t('corrections.status.successText')}</p>
      <div className="mt-5 rounded-lg border border-brand-100 bg-brand-50/70 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700">{t('corrections.status.reference')}</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <span className="font-mono text-[24px] font-semibold tracking-wide text-navy-900" dir="ltr" data-testid="correction-reference">{outcome.receipt.reference}</span>
          <button type="button" onClick={() => void copy()} className="btn btn-secondary h-8 gap-1.5 px-2.5 text-[12px]">
            <Copy className="h-3.5 w-3.5" aria-hidden />
            {copied ? t('corrections.status.copied') : t('corrections.status.copy')}
          </button>
        </div>
        <p className="mt-2 text-[12.5px] text-ink-600">{t('corrections.status.receivedAt')}: {formatDateTime(outcome.receipt.received_at, i18n.resolvedLanguage)}</p>
      </div>
      {outcome.uploads.length > 0 && (
        <div className="mt-5" data-testid="correction-uploads">
          <p className="text-[13px] font-semibold text-ink-900">{t('corrections.status.attachments')}</p>
          <ul className="mt-2 space-y-1.5">
            {outcome.uploads.map((u) => (
              <li key={u.file.name} className="flex items-center gap-2 text-[13px]">
                {u.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-600" aria-hidden /> : <XCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden />}
                <span className="min-w-0 truncate text-ink-800" dir="ltr">{u.file.name}</span>
                <span className={cn('shrink-0', u.ok ? 'text-ink-500' : 'text-red-700')}>— {u.ok ? t('corrections.status.uploadOk') : t('corrections.status.uploadFailed')}</span>
              </li>
            ))}
          </ul>
          {outcome.uploads.some((u) => !u.ok) && <p className="mt-2 text-[12.5px] text-ink-600">{t('corrections.status.uploadFailedHint')}</p>}
        </div>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" className="btn btn-secondary" onClick={onReset}>{t('corrections.status.another')}</button>
        <a href="#status-check" className="btn btn-primary">
          {t('corrections.status.checkNow')}
          <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
        </a>
      </div>
    </section>
  )
}

/* ------------------------------ status check ------------------------------ */

function StatusCheck({ available }: { available: boolean }) {
  const { t, i18n } = useTranslation()
  const [reference, setReference] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const lookup = useMutation({
    mutationFn: () => checkCorrectionStatus(reference, email),
  })
  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault()
    if (lookup.isPending) return
    const ref = reference.trim().toUpperCase()
    if (!/^CR-[A-Z0-9]{8}$/.test(ref)) return setError(t('corrections.form.errors.required'))
    if (!EMAIL_RE.test(email.trim())) return setError(t('corrections.form.errors.email'))
    setError(null)
    lookup.mutate()
  }
  const view = lookup.data as CorrectionStatusView | null | undefined
  return (
    <section id="status-check" className="card scroll-mt-24 p-6 md:p-8" aria-labelledby="status-check-title" data-testid="status-check">
      <SectionLabel>{t('corrections.check.label')}</SectionLabel>
      <h2 id="status-check-title" className="mt-2 font-serif text-[22px] font-semibold text-navy-900">{t('corrections.check.title')}</h2>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-600">{t('corrections.check.text')}</p>
      <form onSubmit={onSubmit} noValidate className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
        <FieldShell id="sc-reference" label={t('corrections.check.reference')} required>
          <input id="sc-reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('corrections.check.referencePlaceholder')} className="field font-mono uppercase" dir="ltr" autoComplete="off" disabled={!available} data-testid="status-reference" />
        </FieldShell>
        <FieldShell id="sc-email" label={t('corrections.check.email')} required>
          <input id="sc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('corrections.form.emailPlaceholder')} className="field" dir="ltr" autoComplete="email" inputMode="email" disabled={!available} data-testid="status-email" />
        </FieldShell>
        <button type="submit" className="btn btn-secondary h-10" disabled={lookup.isPending || !available} data-testid="status-submit">
          {lookup.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
          {lookup.isPending ? t('corrections.check.checking') : t('corrections.check.button')}
        </button>
      </form>
      <div aria-live="polite" className="mt-4">
        {error && <p className="text-[13px] text-red-700" role="alert">{error}</p>}
        {lookup.isError && <p className="text-[13px] text-red-700" role="alert">{t('corrections.check.failed')}</p>}
        {lookup.isSuccess && view === null && <p className="rounded-lg border border-ink-200 bg-ink-50 p-3 text-[13.5px] text-ink-700" data-testid="status-nomatch">{t('corrections.check.noMatch')}</p>}
        {lookup.isSuccess && view && (
          <div className="rounded-lg border border-brand-100 bg-brand-50/70 p-4" data-testid="status-result">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-[15px] font-semibold text-navy-900" dir="ltr">{view.reference}</span>
              <span className="rounded-full bg-brand-600 px-3 py-0.5 text-[12px] font-semibold text-white">{t(`corrections.check.statuses.${view.status}`, { defaultValue: view.status })}</span>
            </div>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-800">{t(`corrections.check.statusText.${view.status}`, { defaultValue: '' })}</p>
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-[12.5px] text-ink-600 sm:grid-cols-3">
              <div><dt className="inline">{t('corrections.check.type')}: </dt><dd className="inline text-ink-800">{t(`corrections.types.items.${view.request_type}.title`, { defaultValue: view.request_type })}</dd></div>
              <div><dt className="inline">{t('corrections.check.submitted')}: </dt><dd className="inline text-ink-800">{formatDateTime(view.created_at, i18n.resolvedLanguage)}</dd></div>
              <div><dt className="inline">{t('corrections.check.updated')}: </dt><dd className="inline text-ink-800">{formatDateTime(view.updated_at, i18n.resolvedLanguage)}</dd></div>
            </dl>
            {view.public_note && (
              <div className="mt-3 rounded border border-brand-100 bg-white p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-700">{t('corrections.check.note')}</p>
                <p className="bidi-auto mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-800">{view.public_note}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/* ------------------------------ form primitives ------------------------------ */

function FieldShell({ id, label, required, error, hint, className, children }: { id: string; label: string; required?: boolean; error?: string; hint?: ReactNode; className?: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-[13px] font-medium text-ink-800">
        {label}
        {required ? <span aria-hidden className="text-red-600"> *</span> : <span className="ms-1.5 text-[11.5px] font-normal text-ink-400">({t('corrections.form.optional')})</span>}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-[12.5px] text-red-700" role="alert">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[12px] text-ink-500">{hint}</p>
      ) : null}
    </div>
  )
}

function Input({ name, label, value, onChange, required, error, hint, placeholder, type = 'text', autoComplete, inputMode, maxLength, dir, className }: { name: keyof Values; label: string; value: string; onChange: (v: string) => void; required?: boolean; error?: string; hint?: string; placeholder?: string; type?: string; autoComplete?: string; inputMode?: 'email' | 'text'; maxLength?: number; dir?: 'ltr' | 'rtl'; className?: string }) {
  const reactId = useId()
  const id = `cr-${name}-${reactId}`
  return (
    <FieldShell id={id} label={label} required={required} error={error} hint={hint} className={className}>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        aria-required={required || undefined}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        dir={dir}
        className={cn('field', error && 'border-red-400 focus:border-red-500 focus:ring-red-100')}
      />
    </FieldShell>
  )
}
