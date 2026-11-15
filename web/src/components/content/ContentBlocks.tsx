/* ---------------------------------------------------------------------------
 * Renderer for the static editorial content model (ArticleBlock) shared by
 * the Knowledge Center articles and the Guides landing pages.
 *
 * Inline links: `[label](/path)` → router <Link>; `[label](https://…)` →
 * external link (new tab). Everything else is rendered as plain text — the
 * content files are code, not user input, but we still never inject HTML.
 * ------------------------------------------------------------------------- */
import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, Info } from 'lucide-react'
import { InfoBanner } from '@/components/editorial'
import type { ArticleBlock } from '@/content/knowledge'

/** `[label](target)` links and `**strong**` runs. */
const INLINE_TOKEN = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g

/** Render text with inline links and bold runs. Returns the plain string when there is no markup. */
export function Inline({ text }: { text: string }): ReactNode {
  if (!text.includes('](') && !text.includes('**')) return text
  const parts: ReactNode[] = []
  let last = 0
  let i = 0
  for (const m of text.matchAll(INLINE_TOKEN)) {
    const [raw, label, target, strong] = m
    const start = m.index ?? 0
    if (start > last) parts.push(<Fragment key={i++}>{text.slice(last, start)}</Fragment>)
    if (strong !== undefined) {
      parts.push(<strong key={i++} className="font-semibold text-ink-900">{strong}</strong>)
    } else {
      const external = /^https?:\/\//i.test(target)
      parts.push(
        external ? (
          <a key={i++} href={target} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800">{label}</a>
        ) : (
          <Link key={i++} to={target} className="font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800">{label}</Link>
        ),
      )
    }
    last = start + raw.length
  }
  if (last < text.length) parts.push(<Fragment key={i++}>{text.slice(last)}</Fragment>)
  return <>{parts}</>
}

export function Block({ block }: { block: ArticleBlock }) {
  const { t } = useTranslation()
  switch (block.type) {
    case 'p':
      return <p><Inline text={block.text} /></p>
    case 'h2':
      return <h2 id={block.id} className="scroll-mt-(--hdr-sticky)">{block.text}</h2>
    case 'h3':
      return <h3 id={block.id} className="scroll-mt-(--hdr-sticky)">{block.text}</h3>
    case 'ul':
      return (
        <ul>
          {block.items.map((it) => <li key={it}><Inline text={it} /></li>)}
        </ul>
      )
    case 'ol':
      return (
        <ol>
          {block.items.map((it) => <li key={it}><Inline text={it} /></li>)}
        </ol>
      )
    case 'check':
      return (
        <section className="not-prose my-7 rounded-xl border border-ink-200 bg-white p-5" aria-label={t('knowledge.article.checklist')}>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-700">{t('knowledge.article.checklist')}</p>
          <h3 className="mt-1 font-serif text-[18px] font-semibold text-navy-900">{block.title}</h3>
          <ul className="mt-3 space-y-2">
            {block.items.map((it) => (
              <li key={it} className="flex items-start gap-2.5 text-[14.5px] leading-relaxed text-ink-800">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-brand-300 bg-brand-50 text-brand-700" aria-hidden>
                  <Check className="h-3.5 w-3.5" />
                </span>
                <span><Inline text={it} /></span>
              </li>
            ))}
          </ul>
        </section>
      )
    case 'example':
      return (
        <figure className="not-prose my-7 overflow-hidden rounded-xl border border-ink-200 bg-white">
          <figcaption className="border-b border-ink-200 bg-ink-50 px-5 py-3">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-700">{t('knowledge.article.example')}</p>
            <p className="mt-0.5 font-serif text-[16px] font-semibold text-navy-900">{block.title}</p>
          </figcaption>
          <dl className="divide-y divide-ink-100">
            {block.rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 px-5 py-2.5 text-[14px]">
                <dt className="text-ink-500">{k}</dt>
                <dd className="font-medium text-ink-900"><Inline text={v} /></dd>
              </div>
            ))}
          </dl>
          {block.caption && <p className="border-t border-ink-200 px-5 py-3 text-[12.5px] text-ink-500"><Inline text={block.caption} /></p>}
        </figure>
      )
    case 'note':
      return (
        <div className="not-prose my-7">
          <InfoBanner Icon={Info} title={block.title}><Inline text={block.text} /></InfoBanner>
        </div>
      )
    case 'figure':
      return (
        <figure className="not-prose my-7">
          <img src={block.src} alt={block.alt} loading="lazy" decoding="async" width={1200} height={750} className="w-full rounded-xl border border-ink-200 shadow-sm" />
          <figcaption className="mt-2 text-center text-[12.5px] text-ink-500">{block.caption}</figcaption>
        </figure>
      )
    case 'sources':
      return (
        <section className="not-prose mt-9 rounded-xl border border-ink-200 bg-ink-50 p-5" aria-labelledby="article-sources">
          <h2 id="article-sources" className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-700">{t('knowledge.article.sources')}</h2>
          <ol className="mt-3 list-decimal space-y-2 ps-5 text-[13.5px] leading-relaxed text-ink-700">
            {block.items.map((src) => (
              <li key={src.href}>
                <a href={src.href} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800">{src.label}</a>
                <span className="ms-1 text-ink-400" aria-hidden>↗</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[12.5px] text-ink-500">{t('knowledge.article.sourcesNote')}</p>
        </section>
      )
  }
}

export function Blocks({ blocks }: { blocks: ArticleBlock[] }) {
  return <>{blocks.map((b, i) => <Block key={i} block={b} />)}</>
}
