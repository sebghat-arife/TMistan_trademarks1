import { useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  Info,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Search,
  Send,
  ShieldCheck,
  Wrench,
  FileWarning,
  FileSearch,
} from 'lucide-react'
import { PageHero } from '@/components/PageHero'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { MASNAD_URL, SITE_CONTACT } from '@/lib/site'
import { cn } from '@/lib/utils'
import {
  CONTACT_LIMITS,
  ContactError,
  INQUIRY_TYPES,
  contactFormStatusQuery,
  isInquiryType,
  submitContactRequest,
  type ContactDetails,
  type ContactReceipt,
  type InquiryType,
} from '@/services/contact_service'

/* ----------------------------------------------------------------------------
 * Option lists. Values are stored verbatim in contact_requests.details so the
 * admin inbox can show the same label in any language.
 * ------------------------------------------------------------------------- */
const RESEARCH_TYPES = ['availability', 'similar', 'historical', 'review', 'portfolio', 'custom', 'other'] as const
const FORMATS = ['email', 'pdf', 'call', 'other'] as const
const CORRECTION_ISSUES = ['incorrect_text', 'missing_info', 'missing_image', 'incorrect_image', 'incorrect_source', 'other'] as const
const SUPPORT_ISSUES = ['search', 'download', 'login', 'broken_link', 'display', 'other'] as const

const CATEGORY_ICONS: Record<InquiryType, typeof HelpCircle> = {
  general: HelpCircle,
  'trademark-research': FileSearch,
  'data-correction': FileWarning,
  'technical-support': Wrench,
}

type Values = {
  fullName: string
  email: string
  organization: string
  subject: string
  message: string
  privacy: boolean
  website: string // honeypot — stays empty for people
  // category-specific (all optional)
  trademark_name: string
  serial_number: string
  applicant_name: string
  trademark_class: string
  gazette_number: string
  source_page: string
  research_type: string
  response_format: string
  purpose: string
  deadline: string
  issue_category: string
  issue_url: string
  browser_info: string
}
type Field = keyof Values
type Errors = Partial<Record<Field, string>>

const EMPTY: Values = {
  fullName: '', email: '', organization: '', subject: '', message: '', privacy: false, website: '',
  trademark_name: '', serial_number: '', applicant_name: '', trademark_class: '', gazette_number: '', source_page: '',
  research_type: '', response_format: '', purpose: '', deadline: '', issue_category: '', issue_url: '', browser_info: '',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function pick<T extends string>(raw: string | null, allowed: readonly T[]): T | '' {
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : ''
}

/** /contact — public inquiry form (server-validated, rate-limited, stored privately) plus the approved contact details. */
export function ContactPage() {
  const { t, i18n } = useTranslation()
  useDocumentTitle(t('contact.metaTitle'), t('contact.metaDescription'))
  const [params, setParams] = useSearchParams()

  const type: InquiryType = isInquiryType(params.get('type')) ? (params.get('type') as InquiryType) : 'general'
  const setType = (next: InquiryType) => {
    const p = new URLSearchParams(params)
    if (next === 'general') p.delete('type')
    else p.set('type', next)
    setParams(p, { replace: true })
  }

  // Initial values come from the URL once (e.g. /contact?type=trademark-research&research=similar&serial=1022-073).
  const [initial] = useState<Values>(() => ({
    ...EMPTY,
    research_type: pick(params.get('research'), RESEARCH_TYPES),
    issue_category: pick(params.get('issue'), [...CORRECTION_ISSUES, ...SUPPORT_ISSUES]),
    serial_number: (params.get('serial') ?? '').slice(0, 60),
    gazette_number: (params.get('gazette') ?? '').slice(0, 60),
    trademark_name: (params.get('mark') ?? '').slice(0, 200),
  }))
  const [values, setValues] = useState<Values>(initial)
  const [errors, setErrors] = useState<Errors>({})
  const [receipt, setReceipt] = useState<ContactReceipt | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const errorSummaryRef = useRef<HTMLDivElement>(null)

  const status = useQuery(contactFormStatusQuery())
  const available = status.data !== false // optimistic while probing; the submit button waits for the probe

  const set = <K extends Field>(k: K, v: Values[K]) => {
    setValues((s) => ({ ...s, [k]: v }))
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }))
  }

  const validate = (v: Values): Errors => {
    const e: Errors = {}
    const req = (k: Field) => {
      if (!String(v[k]).trim()) e[k] = t('contact.form.errors.required')
    }
    req('fullName')
    req('email')
    req('subject')
    req('message')
    if (!e.fullName && v.fullName.trim().length < 2) e.fullName = t('contact.form.errors.min', { count: 2 })
    if (v.fullName.length > CONTACT_LIMITS.name) e.fullName = t('contact.form.errors.max', { count: CONTACT_LIMITS.name })
    if (!e.email && !EMAIL_RE.test(v.email.trim())) e.email = t('contact.form.errors.email')
    if (v.organization.length > CONTACT_LIMITS.organization) e.organization = t('contact.form.errors.max', { count: CONTACT_LIMITS.organization })
    if (!e.subject && v.subject.trim().length < 3) e.subject = t('contact.form.errors.min', { count: 3 })
    if (v.subject.length > CONTACT_LIMITS.subject) e.subject = t('contact.form.errors.max', { count: CONTACT_LIMITS.subject })
    if (!e.message && v.message.trim().length < CONTACT_LIMITS.messageMin) e.message = t('contact.form.errors.min', { count: CONTACT_LIMITS.messageMin })
    if (v.message.length > CONTACT_LIMITS.message) e.message = t('contact.form.errors.max', { count: CONTACT_LIMITS.message })
    if (!v.privacy) e.privacy = t('contact.form.errors.privacy')
    return e
  }

  const details = useMemo<ContactDetails>(() => {
    if (type === 'trademark-research') {
      const { trademark_name, serial_number, applicant_name, trademark_class, gazette_number, research_type, response_format, purpose, deadline } = values
      return { trademark_name, serial_number, applicant_name, trademark_class, gazette_number, research_type, response_format, purpose, deadline }
    }
    if (type === 'data-correction') {
      const { serial_number, trademark_name, gazette_number, source_page, issue_category } = values
      return { serial_number, trademark_name, gazette_number, source_page, issue_category }
    }
    if (type === 'technical-support') {
      const { issue_category, issue_url, browser_info } = values
      return { issue_category, issue_url, browser_info }
    }
    return {}
  }, [type, values])

  const mutation = useMutation({
    mutationFn: () =>
      submitContactRequest({
        inquiryType: type,
        fullName: values.fullName,
        email: values.email,
        organization: values.organization,
        subject: values.subject,
        message: values.message,
        details,
        locale: i18n.language,
        pageUrl: window.location.href,
        honeypot: values.website,
      }),
    onSuccess: (r) => {
      setReceipt(r)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
  })

  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault()
    if (mutation.isPending) return
    const e = validate(values)
    setErrors(e)
    const first = (Object.keys(e) as Field[]).find((k) => e[k])
    if (first) {
      const el = formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)
      el?.focus()
      errorSummaryRef.current?.scrollIntoView({ block: 'nearest' })
      return
    }
    mutation.mutate()
  }

  const reset = () => {
    setValues({ ...EMPTY })
    setErrors({})
    setReceipt(null)
    mutation.reset()
  }

  const failure = mutation.error as ContactError | null
  const failureText = !failure
    ? null
    : failure.code === 'rate_limited'
      ? t('contact.status.rateLimited')
      : failure.code === 'validation'
        ? `${t('contact.form.errors.fix')} ${failure.message}`
        : t('contact.status.failedText')

  const messageLabel =
    type === 'data-correction' ? t('contact.form.correction.description') : type === 'technical-support' ? t('contact.form.support.description') : t('contact.form.message')

  const guidance = t('contact.aside.guidance', { returnObjects: true }) as string[]
  const hasDirectContact = !!(SITE_CONTACT.email || SITE_CONTACT.phone || SITE_CONTACT.address)

  return (
    <div data-testid="contact-page">
      <PageHero eyebrow={t('contact.eyebrow')} title={t('contact.title')} imagePosition="55% 60%" imageOpacity={0.4}>
        <p>{t('contact.intro1')}</p>
        <p>{t('contact.intro2')}</p>
      </PageHero>

      <div className="container-x py-10 md:py-14">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)] lg:gap-10">
          {/* ───────────── Form column ───────────── */}
          <div className="min-w-0">
            {receipt ? (
              <section className="card p-6 md:p-8" aria-live="polite" data-testid="contact-success">
                <span className="icon-circle h-12 w-12">
                  <CheckCircle2 className="h-6 w-6" aria-hidden />
                </span>
                <h2 className="mt-4 font-serif text-[26px] font-semibold text-navy-900">{t('contact.status.successTitle')}</h2>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-700">{t('contact.status.successText')}</p>
                <p className="mt-4 text-[13px] text-ink-500">
                  {t('contact.status.reference')}: <span className="font-mono text-ink-800">{receipt.id.slice(0, 8).toUpperCase()}</span>
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button type="button" className="btn btn-secondary" onClick={reset}>
                    {t('contact.status.another')}
                  </button>
                  <Link to="/search" className="btn btn-primary">
                    <Search className="h-4 w-4" aria-hidden />
                    {t('contact.closing.search')}
                  </Link>
                </div>
              </section>
            ) : (
              <form ref={formRef} className="card p-6 md:p-8" onSubmit={onSubmit} noValidate data-testid="contact-form">
                {/* Category */}
                <fieldset>
                  <legend className="text-[17px] font-semibold text-ink-900">{t('contact.categories.title')}</legend>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2" role="radiogroup">
                    {INQUIRY_TYPES.map((k) => {
                      const Icon = CATEGORY_ICONS[k]
                      const on = k === type
                      return (
                        <label
                          key={k}
                          className={cn(
                            'flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors',
                            on ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-ink-200 bg-white hover:border-ink-300',
                          )}
                          data-testid={`category-${k}`}
                        >
                          <input type="radio" name="inquiryType" value={k} checked={on} onChange={() => setType(k)} className="sr-only" />
                          <span className={cn('icon-circle h-9 w-9', on && 'bg-brand-600 text-white')}>
                            <Icon className="h-4 w-4" aria-hidden />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[14px] font-semibold text-ink-900">{t(`contact.categories.${k}.title`)}</span>
                            <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-600">{t(`contact.categories.${k}.text`)}</span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </fieldset>

                {status.data === false && (
                  <div role="status" className="mt-6 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-[13.5px] text-amber-900" data-testid="contact-unavailable">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                    <div>
                      <p className="font-semibold">{t('contact.status.unavailableTitle')}</p>
                      <p className="mt-1 leading-relaxed">{t('contact.status.unavailableText')}</p>
                    </div>
                  </div>
                )}

                <fieldset className="mt-8" disabled={mutation.isPending || !available}>
                  <legend className="text-[17px] font-semibold text-ink-900">{t('contact.form.title')}</legend>
                  <p className="muted mt-1 text-[12.5px]">{t('contact.form.lead')}</p>

                  <div className="mt-5 grid gap-5 sm:grid-cols-2">
                    <Input name="fullName" label={t('contact.form.fullName')} required value={values.fullName} onChange={(v) => set('fullName', v)} error={errors.fullName} autoComplete="name" maxLength={CONTACT_LIMITS.name} />
                    <Input name="email" type="email" label={t('contact.form.email')} required value={values.email} onChange={(v) => set('email', v)} error={errors.email} autoComplete="email" inputMode="email" />
                    <Input name="organization" label={t('contact.form.organization')} value={values.organization} onChange={(v) => set('organization', v)} error={errors.organization} autoComplete="organization" maxLength={CONTACT_LIMITS.organization} />
                    <Select name="inquiryTypeSelect" label={t('contact.form.inquiryType')} required value={type} onChange={(v) => isInquiryType(v) && setType(v)}>
                      {INQUIRY_TYPES.map((k) => (
                        <option key={k} value={k}>{t(`contact.categories.${k}.title`)}</option>
                      ))}
                    </Select>
                  </div>

                  {/* Category-specific fields */}
                  {type === 'trademark-research' && (
                    <Group title={t('contact.form.sectionResearch')}>
                      <Input name="trademark_name" label={t('contact.form.research.trademarkName')} value={values.trademark_name} onChange={(v) => set('trademark_name', v)} />
                      <Input name="serial_number" label={t('contact.form.research.serial')} value={values.serial_number} onChange={(v) => set('serial_number', v)} dir="ltr" />
                      <Input name="applicant_name" label={t('contact.form.research.applicant')} value={values.applicant_name} onChange={(v) => set('applicant_name', v)} />
                      <Input name="trademark_class" label={t('contact.form.research.class')} value={values.trademark_class} onChange={(v) => set('trademark_class', v)} dir="ltr" />
                      <Input name="gazette_number" label={t('contact.form.research.gazette')} value={values.gazette_number} onChange={(v) => set('gazette_number', v)} dir="ltr" />
                      <Select name="research_type" label={t('contact.form.research.researchType')} value={values.research_type} onChange={(v) => set('research_type', v)} placeholder>
                        {RESEARCH_TYPES.map((k) => (
                          <option key={k} value={k}>{t(`contact.form.research.researchTypes.${k}`)}</option>
                        ))}
                      </Select>
                      <Select name="response_format" label={t('contact.form.research.format')} value={values.response_format} onChange={(v) => set('response_format', v)} placeholder>
                        {FORMATS.map((k) => (
                          <option key={k} value={k}>{t(`contact.form.research.formats.${k}`)}</option>
                        ))}
                      </Select>
                      <Input name="deadline" label={t('contact.form.research.deadline')} value={values.deadline} onChange={(v) => set('deadline', v)} />
                      <Input name="purpose" label={t('contact.form.research.purpose')} value={values.purpose} onChange={(v) => set('purpose', v)} className="sm:col-span-2" />
                    </Group>
                  )}

                  {type === 'data-correction' && (
                    <Group title={t('contact.form.sectionCorrection')}>
                      <Input name="serial_number" label={t('contact.form.correction.serial')} value={values.serial_number} onChange={(v) => set('serial_number', v)} dir="ltr" />
                      <Input name="trademark_name" label={t('contact.form.correction.mark')} value={values.trademark_name} onChange={(v) => set('trademark_name', v)} />
                      <Input name="gazette_number" label={t('contact.form.correction.gazette')} value={values.gazette_number} onChange={(v) => set('gazette_number', v)} dir="ltr" />
                      <Input name="source_page" label={t('contact.form.correction.page')} value={values.source_page} onChange={(v) => set('source_page', v)} dir="ltr" />
                      <Select name="issue_category" label={t('contact.form.correction.issue')} value={values.issue_category} onChange={(v) => set('issue_category', v)} placeholder className="sm:col-span-2">
                        {CORRECTION_ISSUES.map((k) => (
                          <option key={k} value={k}>{t(`contact.form.correction.issues.${k}`)}</option>
                        ))}
                      </Select>
                      <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-500 sm:col-span-2">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span>{t('contact.form.correction.attachNote')}</span>
                      </p>
                    </Group>
                  )}

                  {type === 'technical-support' && (
                    <Group title={t('contact.form.sectionSupport')}>
                      <Select name="issue_category" label={t('contact.form.support.issue')} value={values.issue_category} onChange={(v) => set('issue_category', v)} placeholder>
                        {SUPPORT_ISSUES.map((k) => (
                          <option key={k} value={k}>{t(`contact.form.support.issues.${k}`)}</option>
                        ))}
                      </Select>
                      <Input name="issue_url" label={t('contact.form.support.url')} value={values.issue_url} onChange={(v) => set('issue_url', v)} dir="ltr" inputMode="url" />
                      <Input name="browser_info" label={t('contact.form.support.browser')} value={values.browser_info} onChange={(v) => set('browser_info', v)} className="sm:col-span-2" />
                    </Group>
                  )}

                  <div className="mt-5 grid gap-5">
                    <Input name="subject" label={t('contact.form.subject')} required value={values.subject} onChange={(v) => set('subject', v)} error={errors.subject} maxLength={CONTACT_LIMITS.subject} />
                    <Textarea
                      name="message"
                      label={messageLabel}
                      required
                      value={values.message}
                      onChange={(v) => set('message', v)}
                      error={errors.message}
                      maxLength={CONTACT_LIMITS.message}
                      counter={t('contact.form.chars', { count: values.message.length, max: CONTACT_LIMITS.message })}
                    />
                  </div>

                  {/* Honeypot — invisible to people, tempting for bots */}
                  <div className="hp-field" aria-hidden>
                    <label htmlFor="contact-website">Website</label>
                    <input id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={values.website} onChange={(e) => set('website', e.target.value)} />
                  </div>

                  <div className="mt-6">
                    <label className="flex cursor-pointer items-start gap-3 text-[13.5px] leading-relaxed text-ink-700">
                      <input
                        type="checkbox"
                        name="privacy"
                        checked={values.privacy}
                        onChange={(e) => set('privacy', e.target.checked)}
                        aria-invalid={!!errors.privacy}
                        aria-describedby={errors.privacy ? 'privacy-error' : undefined}
                        className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
                      />
                      <span>
                        <Trans i18nKey="contact.form.privacy" components={{ 1: <Link to="/privacy" className="font-semibold text-brand-600 underline underline-offset-2" /> }} />
                        <span aria-hidden className="text-red-600"> *</span>
                      </span>
                    </label>
                    {errors.privacy && (
                      <p id="privacy-error" className="mt-1.5 text-[12.5px] text-red-700" role="alert">{errors.privacy}</p>
                    )}
                  </div>

                  <div ref={errorSummaryRef}>
                    {Object.values(errors).some(Boolean) && (
                      <p className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-800" role="alert" data-testid="contact-errors">
                        {t('contact.form.errors.fix')}
                      </p>
                    )}
                    {failureText && (
                      <div className="mt-5 flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-[13.5px] text-red-900" role="alert" data-testid="contact-failed">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
                        <div>
                          <p className="font-semibold">{t('contact.status.failedTitle')}</p>
                          <p className="mt-1 leading-relaxed">{failureText}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-6 flex flex-wrap items-center gap-4">
                    <button type="submit" className="btn btn-primary min-w-[180px]" disabled={mutation.isPending || status.isPending || !available} data-testid="contact-submit">
                      {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                      {mutation.isPending ? t('contact.form.submitting') : t('contact.form.submit')}
                    </button>
                    <p className="flex items-center gap-1.5 text-[12.5px] text-ink-500">
                      <ShieldCheck className="h-3.5 w-3.5 text-brand-600" aria-hidden />
                      <Link to="/privacy" className="hover:underline">{t('contact.privacyLink')}</Link>
                    </p>
                  </div>
                </fieldset>
              </form>
            )}

            <p className="mt-5 flex items-start gap-2 text-[13px] leading-relaxed text-ink-600" data-testid="contact-privacy-notice">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
              <span>{t('contact.privacyNotice')}</span>
            </p>
          </div>

          {/* ───────────── Aside ───────────── */}
          <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            <section className="card p-6" aria-labelledby="contact-aside-title">
              <h2 id="contact-aside-title" className="text-[17px] font-semibold text-ink-900">{t('contact.aside.title')}</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-700">{t('contact.aside.operator')}</p>
              <ul className="mt-4 space-y-3 text-[14px]">
                <li className="flex items-start gap-3">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                  <span className="text-ink-700">{SITE_CONTACT.address || t('contact.aside.location')}</span>
                </li>
                {MASNAD_URL && (
                  <li className="flex items-start gap-3">
                    <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                    <a href={MASNAD_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline">
                      {t('contact.aside.website')}
                      <span className="block text-[12px] font-normal text-ink-500" dir="ltr">{MASNAD_URL.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
                    </a>
                  </li>
                )}
                {SITE_CONTACT.email && (
                  <li className="flex items-start gap-3">
                    <Mail className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                    <a href={`mailto:${SITE_CONTACT.email}`} className="font-medium text-brand-600 hover:underline" dir="ltr">{SITE_CONTACT.email}</a>
                  </li>
                )}
                {SITE_CONTACT.phone && (
                  <li className="flex items-start gap-3">
                    <Phone className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                    <a href={`tel:${SITE_CONTACT.phone.replace(/[^\d+]/g, '')}`} className="font-medium text-brand-600 hover:underline" dir="ltr">{SITE_CONTACT.phone}</a>
                  </li>
                )}
              </ul>
              {!hasDirectContact && <p className="muted mt-4 text-[12.5px] leading-relaxed">{t('contact.aside.noDirect')}</p>}
            </section>

            <section className="rounded-xl border border-brand-100 bg-brand-50/60 p-6">
              <h2 className="text-[15px] font-semibold text-ink-900">{t('contact.aside.guidanceTitle')}</h2>
              <ul className="mt-3 space-y-2.5">
                {guidance.map((g) => (
                  <li key={g} className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-ink-700">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                    <span>{g}</span>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>

        {/* Closing */}
        <section aria-labelledby="contact-closing" className="mt-12 flex flex-col items-start justify-between gap-5 rounded-xl bg-navy-900 px-6 py-8 text-white md:mt-16 md:flex-row md:items-center md:px-10">
          <div>
            <h2 id="contact-closing" className="font-serif text-[24px] font-semibold">{t('contact.closing.title')}</h2>
            <p className="mt-1.5 text-[14.5px] text-white/80">{t('contact.closing.text')}</p>
          </div>
          <Link to="/search" className="btn btn-primary shrink-0">
            <Search className="h-4 w-4" aria-hidden />
            {t('contact.closing.search')}
          </Link>
        </section>
      </div>
    </div>
  )
}

/* ------------------------------ form primitives ------------------------------ */

function FieldShell({ id, label, required, optionalText, error, hint, className, children }: { id: string; label: string; required?: boolean; optionalText?: string; error?: string; hint?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-[13px] font-medium text-ink-800">
        {label}
        {required ? <span aria-hidden className="text-red-600"> *</span> : optionalText ? <span className="ms-1.5 text-[11.5px] font-normal text-ink-400">({optionalText})</span> : null}
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

type InputProps = {
  name: Field
  label: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  error?: string
  type?: string
  autoComplete?: string
  inputMode?: 'email' | 'url' | 'text' | 'numeric'
  maxLength?: number
  dir?: 'ltr' | 'rtl'
  className?: string
}
function Input({ name, label, value, onChange, required, error, type = 'text', autoComplete, inputMode, maxLength, dir, className }: InputProps) {
  const { t } = useTranslation()
  const id = `contact-${name}`
  return (
    <FieldShell id={id} label={label} required={required} optionalText={required ? undefined : t('contact.form.optional')} error={error} className={className}>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        aria-required={required || undefined}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        dir={dir}
        className={cn('field', error && 'border-red-400 focus:border-red-500 focus:ring-red-100')}
      />
    </FieldShell>
  )
}

function Textarea({ name, label, value, onChange, required, error, maxLength, counter, className }: { name: Field; label: string; value: string; onChange: (v: string) => void; required?: boolean; error?: string; maxLength?: number; counter?: string; className?: string }) {
  const id = `contact-${name}`
  return (
    <FieldShell id={id} label={label} required={required} error={error} hint={counter} className={className}>
      <textarea
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        aria-required={required || undefined}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${id}-error` : counter ? `${id}-hint` : undefined}
        maxLength={maxLength}
        rows={7}
        className={cn('field min-h-[160px] resize-y', error && 'border-red-400 focus:border-red-500 focus:ring-red-100')}
      />
    </FieldShell>
  )
}

function Select({ name, label, value, onChange, required, placeholder, className, children }: { name: string; label: string; value: string; onChange: (v: string) => void; required?: boolean; placeholder?: boolean; className?: string; children: ReactNode }) {
  const { t } = useTranslation()
  const reactId = useId()
  const id = `contact-${name}-${reactId}`
  return (
    <FieldShell id={id} label={label} required={required} optionalText={required ? undefined : t('contact.form.optional')} className={className}>
      <select id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)} className="field" required={required}>
        {placeholder && <option value="">—</option>}
        {children}
      </select>
    </FieldShell>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-6 rounded-lg border border-ink-200 bg-ink-50/60 p-4 sm:p-5" data-testid="contact-extra-fields">
      <h3 className="text-[14px] font-semibold text-ink-900">{title}</h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  )
}
