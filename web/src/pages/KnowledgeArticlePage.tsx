import { Link, Navigate, useParams } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, BookOpen, Check, Clock, Info, Languages, Lightbulb } from 'lucide-react'
import { InfoBanner, SectionLabel, SidePanel } from '@/components/editorial'
import { ArticleCard } from '@/pages/KnowledgeCenterPage'
import { ARTICLE_BY_SLUG, articleToc, articleWordCount, readingMinutes, type ArticleBlock } from '@/content/knowledge'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { formatDate } from '@/lib/utils'

/** /knowledge-center/:slug — one launch article (static content, English body). */
export function KnowledgeArticlePage() {
  const { slug = '' } = useParams()
  const article = ARTICLE_BY_SLUG[slug]
  const { t, i18n } = useTranslation()
  const lng = i18n.resolvedLanguage ?? 'en'
  const title = article ? t(`knowledge.articles.${article.slug}.title`, { defaultValue: article.title }) : t('knowledge.article.notFound')
  const summary = article ? t(`knowledge.articles.${article.slug}.summary`, { defaultValue: article.summary }) : ''
  useDocumentTitle(`${title} | ${t('knowledge.label')} | TMistan`, summary || undefined)

  if (!article) return <Navigate to="/knowledge-center" replace />

  const toc = articleToc(article)
  const related = article.related.map((s) => ARTICLE_BY_SLUG[s]).filter(Boolean)
  const label = article.label ? t(`knowledge.labels.${article.label}`) : t(`knowledge.categories.${article.category}.title`)
  const englishOnly = !lng.startsWith('en')

  return (
    <div data-testid="article-page">
      <div className="border-b border-ink-200/70 bg-[linear-gradient(135deg,#e6f1eb_0%,#f3f8f5_45%,#fbfcfb_100%)]">
        <div className="container-x py-10 md:py-12">
          <Link to="/knowledge-center" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-700 hover:underline">
            <ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
            {t('knowledge.article.back')}
          </Link>
          <div className="mt-5 max-w-3xl">
            <SectionLabel>{label}</SectionLabel>
            <h1 className="mt-3 font-serif text-[32px] font-semibold leading-[1.12] tracking-[-0.015em] text-navy-900 md:text-[42px]" data-testid="article-title">{title}</h1>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-700">{summary}</p>
            <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-600">
              <div className="inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-brand-600" aria-hidden />
                <dt className="sr-only">{t('knowledge.readTime', { count: readingMinutes(article) })}</dt>
                <dd>{t('knowledge.readTime', { count: readingMinutes(article) })} · {t('knowledge.article.words', { count: articleWordCount(article) })}</dd>
              </div>
              <div className="inline-flex items-center gap-1.5">
                <BookOpen className="h-4 w-4 text-brand-600" aria-hidden />
                <dd>{t('knowledge.article.written', { date: formatDate(article.written, lng) })}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <div className="container-x py-10 md:py-12">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
          <article className="min-w-0" lang="en" dir="ltr" data-testid="article-body">
            {englishOnly && (
              <p className="mb-6 inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-[13px] text-ink-700" dir="auto" lang={lng} data-testid="article-english-only">
                <Languages className="h-4 w-4 text-brand-600" aria-hidden />
                {t('knowledge.article.englishOnly')}
              </p>
            )}
            {toc.length > 0 && (
              <nav className="mb-8 rounded-xl border border-ink-200 bg-white p-5 lg:hidden" aria-label={t('knowledge.article.toc')}>
                <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-500">{t('knowledge.article.toc')}</p>
                <ol className="mt-3 space-y-1.5 text-[14px]">
                  {toc.map((h) => (
                    <li key={h.id}><a href={`#${h.id}`} className="text-brand-700 hover:underline">{h.text}</a></li>
                  ))}
                </ol>
              </nav>
            )}
            <div className="article-body">
              {article.body.map((b, i) => <Block key={i} block={b} />)}
            </div>

            <section className="mt-10 rounded-xl border border-brand-100 bg-brand-50/70 p-6" aria-labelledby="meaning">
              <h2 id="meaning" className="flex items-center gap-2 font-serif text-[20px] font-semibold text-navy-900">
                <Lightbulb className="h-5 w-5 text-brand-600" aria-hidden />
                {t('knowledge.article.meaning')}
              </h2>
              <ul className="mt-4 space-y-2.5">
                {article.meaning.map((m) => (
                  <li key={m} className="flex items-start gap-2.5 text-[14.5px] leading-relaxed text-ink-800">
                    <Check className="mt-1 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            </section>

            <div className="mt-8 flex flex-col gap-4 rounded-xl border border-ink-200 bg-white p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-500">{t('knowledge.article.next')}</p>
                <p className="mt-1 font-serif text-[18px] font-semibold text-navy-900">{article.next.label}</p>
              </div>
              <Link to={article.next.to} className="btn btn-primary shrink-0" data-testid="article-next">
                {article.next.label}
                <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
              </Link>
            </div>

            <InfoBanner Icon={Info} title={t('knowledge.article.disclaimerTitle')} tone="amber" className="mt-8">
              <p>{t('knowledge.article.disclaimer')}</p>
              <p className="mt-1">
                <Trans i18nKey="knowledge.article.policies" components={{ 1: <Link to="/legal/disclaimer" className="font-semibold text-brand-700 underline underline-offset-2" />, 3: <Link to="/data-sources" className="font-semibold text-brand-700 underline underline-offset-2" /> }} />
              </p>
            </InfoBanner>
          </article>

          <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
            {toc.length > 0 && (
              <SidePanel title={t('knowledge.article.toc')} tone="white" className="hidden lg:block">
                <ol className="mt-3 space-y-1.5 text-[13.5px]" dir="ltr">
                  {toc.map((h) => (
                    <li key={h.id}><a href={`#${h.id}`} className="block rounded px-2 py-1 text-ink-700 hover:bg-ink-50 hover:text-brand-700">{h.text}</a></li>
                  ))}
                </ol>
              </SidePanel>
            )}
            {related.length > 0 && (
              <section aria-labelledby="related">
                <h2 id="related" className="font-serif text-[18px] font-semibold text-navy-900">{t('knowledge.article.related')}</h2>
                <ul className="mt-3 space-y-3">
                  {related.map((r) => (
                    <li key={r.slug}><ArticleCard article={r} compact /></li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

function Block({ block }: { block: ArticleBlock }) {
  const { t } = useTranslation()
  switch (block.type) {
    case 'p':
      return <p>{block.text}</p>
    case 'h2':
      return <h2 id={block.id} className="scroll-mt-24">{block.text}</h2>
    case 'ul':
      return (
        <ul>
          {block.items.map((it) => <li key={it}>{it}</li>)}
        </ul>
      )
    case 'ol':
      return (
        <ol>
          {block.items.map((it) => <li key={it}>{it}</li>)}
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
                <span>{it}</span>
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
                <dd className="font-medium text-ink-900">{v}</dd>
              </div>
            ))}
          </dl>
          {block.caption && <p className="border-t border-ink-200 px-5 py-3 text-[12.5px] text-ink-500">{block.caption}</p>}
        </figure>
      )
    case 'note':
      return (
        <div className="not-prose my-7">
          <InfoBanner Icon={Info} title={block.title}>{block.text}</InfoBanner>
        </div>
      )
    case 'figure':
      return (
        <figure className="not-prose my-7">
          <img src={block.src} alt={block.alt} loading="lazy" decoding="async" width={1200} height={750} className="w-full rounded-xl border border-ink-200 shadow-sm" />
          <figcaption className="mt-2 text-center text-[12.5px] text-ink-500">{block.caption}</figcaption>
        </figure>
      )
  }
}
