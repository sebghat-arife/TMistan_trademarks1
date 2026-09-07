import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TrademarkSearchResult } from '@/lib/database.types'
import { cn, formatDate, gazettePath, splitHighlight, trademarkPath } from '@/lib/utils'
import { TrademarkImage } from './TrademarkImage'

export function Highlight({ text, query }: { text: string | null | undefined; query?: string | null }) {
  if (!text) return null
  return (
    <>
      {splitHighlight(text, query).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-brand-100 px-0.5 text-inherit">
            {p.part}
          </mark>
        ) : (
          <span key={i}>{p.part}</span>
        ),
      )}
    </>
  )
}

/** "25" or "25, 35" — the mock-up prints classes as plain text. */
export function classText(classes: number[] | null, raw: string | null | undefined): string {
  if (classes && classes.length) return classes.join(', ')
  return raw?.trim() || '—'
}

/* ── Card ──────────────────────────────────────────────────────────────── */

export function TrademarkCard({ r, query, className }: { r: TrademarkSearchResult; query?: string; className?: string }) {
  const { t } = useTranslation()
  const name = r.mark_name ?? t('fields.unnamed')
  return (
    <Link
      to={trademarkPath(r.serial_number, r.official_gazette_number)}
      className={cn('card group flex flex-col p-4 no-underline transition-shadow hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)]', className)}
    >
      <TrademarkImage
        bucket={r.primary_image_bucket}
        path={r.primary_image_path}
        thumbnailPath={r.primary_thumbnail_path}
        alt={name}
        fallbackLabel={r.mark_name ?? r.serial_number}
        className="h-[104px] w-full rounded-md !bg-white"
        imgClassName="max-h-[88px]"
        plain
      />
      <div className="bidi-auto mt-3 truncate text-[15px] font-bold uppercase tracking-wide text-brand-600">{name}</div>
      <dl className="mt-2 space-y-1 text-[13px] leading-snug">
        <Row label={t('fields.serial')} mono>{r.serial_number}</Row>
        <Row label={t('fields.class')}>{classText(r.class_numbers, r.trademark_class)}</Row>
        <Row label={t('fields.gazette')}>{r.official_gazette_number}</Row>
        <Row label={t('fields.applicant')}>
          <span className="bidi-auto line-clamp-2"><Highlight text={r.applicant_name ?? '—'} query={query} /></span>
        </Row>
      </dl>
    </Link>
  )
}

function Row({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 text-ink-500">{label}:</dt>
      <dd className={cn('min-w-0 text-ink-800', mono && 'tabular-nums')}>{children}</dd>
    </div>
  )
}

export function ResultGrid({ results, query, columns = 4 }: { results: TrademarkSearchResult[]; query?: string; columns?: 4 | 5 }) {
  return (
    <ul className={cn('grid grid-cols-2 gap-4 md:grid-cols-3', columns === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-5')}>
      {results.map((r) => (
        <li key={r.id} className="flex">
          <TrademarkCard r={r} query={query} className="w-full" />
        </li>
      ))}
    </ul>
  )
}

/* ── Table ─────────────────────────────────────────────────────────────── */

export function ResultTable({ results, query, compact }: { results: TrademarkSearchResult[]; query?: string; compact?: boolean }) {
  const { t, i18n } = useTranslation()
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[720px] text-[14px]">
        <thead>
          <tr className="border-b border-ink-200 text-start [&>th]:px-4 [&>th]:py-3 [&>th]:text-start [&>th]:text-[13px] [&>th]:font-semibold [&>th]:text-ink-800">
            <th className="w-32">{t('fields.serialNumber')}</th>
            <th>{t('fields.mark')}</th>
            <th>{t('fields.applicant')}</th>
            <th className="w-20">{t('fields.class')}</th>
            {compact ? <th className="w-16">{t('fields.page')}</th> : <><th className="w-24">{t('fields.gazette')}</th><th className="w-36">{t('fields.publicationDate')}</th></>}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {results.map((r) => (
            <tr key={r.id} className="hover:bg-brand-50/50">
              <td className="px-4 py-3 tabular-nums text-ink-800">
                <Link to={trademarkPath(r.serial_number, r.official_gazette_number)} className="hover:text-brand-600">{r.serial_number}</Link>
              </td>
              <td className="px-4 py-3">
                <Link to={trademarkPath(r.serial_number, r.official_gazette_number)} className="flex items-center gap-3 text-ink-900 hover:text-brand-600">
                  {!compact && (
                    <TrademarkImage bucket={r.primary_image_bucket} path={r.primary_image_path} thumbnailPath={r.primary_thumbnail_path} alt="" className="h-9 w-12 shrink-0 rounded border border-ink-200 !bg-white" plain />
                  )}
                  <span className="bidi-auto font-medium">{r.mark_name ? <Highlight text={r.mark_name} query={query} /> : <span className="text-ink-400">{t('fields.unnamed')}</span>}</span>
                </Link>
              </td>
              <td className="bidi-auto px-4 py-3 text-ink-700"><Highlight text={r.applicant_name} query={query} /></td>
              <td className="px-4 py-3 tabular-nums text-ink-800">{classText(r.class_numbers, r.trademark_class)}</td>
              {compact ? (
                <td className="px-4 py-3 tabular-nums text-ink-800">{r.source_page ?? '—'}</td>
              ) : (
                <>
                  <td className="px-4 py-3"><Link to={gazettePath(r.official_gazette_number)} className="text-ink-800 hover:text-brand-600">{r.official_gazette_number}</Link></td>
                  <td className="px-4 py-3 tabular-nums text-ink-700">{formatDate(r.publication_date, i18n.resolvedLanguage)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── Pagination (numbered, green active square) ────────────────────────── */

export function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const { t } = useTranslation()
  if (pages <= 1) return null
  const items: (number | '…')[] = []
  const push = (n: number | '…') => items[items.length - 1] !== n && items.push(n)
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) push(i)
    else push('…')
  }
  return (
    <nav className="mt-8 flex items-center justify-center gap-1.5" aria-label="Pagination">
      <PageBtn disabled={page <= 1} onClick={() => onPage(page - 1)} label={t('search.prev')}>‹</PageBtn>
      {items.map((it, i) =>
        it === '…' ? (
          <span key={`e${i}`} className="px-1 text-ink-400">…</span>
        ) : (
          <PageBtn key={it} active={it === page} onClick={() => onPage(it)} label={t('search.page', { page: it, pages })}>{it}</PageBtn>
        ),
      )}
      <PageBtn disabled={page >= pages} onClick={() => onPage(page + 1)} label={t('search.next')}>›</PageBtn>
    </nav>
  )
}

function PageBtn({ children, active, disabled, onClick, label }: { children: React.ReactNode; active?: boolean; disabled?: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-[14px] font-medium transition-colors disabled:opacity-40',
        active ? 'bg-brand-600 text-white' : 'text-ink-700 hover:bg-ink-100',
      )}
    >
      {children}
    </button>
  )
}
