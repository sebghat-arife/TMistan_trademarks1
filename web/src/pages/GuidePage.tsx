import { Link, useParams } from 'react-router-dom'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { Trans, useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, ChevronDown, Info, Languages, Wrench } from 'lucide-react'
import { InfoBanner, SectionLabel, SidePanel } from '@/components/editorial'
import { Blocks, Inline } from '@/components/content/ContentBlocks'
import { ArticleCard } from '@/pages/KnowledgeCenterPage'
import { GuideCard } from '@/components/GuideCard'
import { ARTICLE_BY_SLUG, inlineToText } from '@/content/knowledge'
import { SRC } from '@/content/knowledgeLaw'
import { GUIDE_BY_SLUG } from '@/content/guides'
import { Seo } from '@/seo/Seo'
import { breadcrumbList, faqPage, article as articleLd } from '@/seo/jsonld'
import { localizePath, type SiteLocaleCode } from '@/seo/locales'

/** /guides/:slug — one educational landing page (English body; title/lead translated; English URL canonical). */
export function GuidePage() {
  const { slug = '' } = useParams()
  const guide = GUIDE_BY_SLUG[slug]
  const { t, i18n } = useTranslation()
  const lng = (i18n.resolvedLanguage ?? 'en') as SiteLocaleCode

  // Unknown slug: a real "not found" page (noindex) rather than a soft redirect to the hub.
  if (!guide) return <NotFoundPage />

  const path = `/guides/${guide.slug}`
  const title = t(`guides.items.${guide.slug}.title`, { defaultValue: guide.title })
  const description = t(`guides.items.${guide.slug}.description`, { defaultValue: guide.metaDescription })
  const lead = t(`guides.items.${guide.slug}.lead`, { defaultValue: guide.lead })
  const englishOnly = !lng.startsWith('en')
  const articles = guide.articles.map((s) => ARTICLE_BY_SLUG[s]).filter(Boolean)
  const related = guide.guides.map((s) => GUIDE_BY_SLUG[s]).filter(Boolean)
  const toc = guide.body.filter((b): b is Extract<typeof b, { type: 'h2' }> => b.type === 'h2')

  const jsonLd = [
    faqPage({ lng, url: path, name: `${guide.seoTitle} | TMistan`, description: guide.metaDescription, faqs: guide.faqs.map((f) => ({ q: f.q, a: inlineToText(f.a) })) }),
    articleLd({
      lng,
      url: path,
      headline: guide.title,
      description: guide.metaDescription,
      image: '/brand/og-default.png',
      datePublished: guide.written,
      dateModified: guide.updated ?? guide.written,
      authorName: 'TMistan',
      keywords: [guide.title, 'Afghanistan', 'trademark'],
      section: 'Guides',
    }),
    breadcrumbList([
      { name: t('seo.breadcrumbHome'), path: localizePath('/', lng) },
      { name: t('guides.label'), path: localizePath('/guides', lng) },
      { name: title, path },
    ]),
  ]

  return (
    <div data-testid="guide-page">
      <Seo
        title={`${guide.seoTitle} | TMistan`}
        description={description}
        path={path}
        canonical="english"
        type="article"
        publishedTime={guide.written}
        modifiedTime={guide.updated ?? guide.written}
        jsonLd={jsonLd}
      />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <div className="split-hero">
        <div className="container-x relative py-10 md:py-14">
          <Link to="/guides" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-700 hover:underline">
            <ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
            {t('guides.back')}
          </Link>
          <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)] lg:items-start">
            <div className="max-w-3xl">
              <SectionLabel>{t('guides.label')}</SectionLabel>
              <h1 className="mt-3 font-serif text-[32px] font-semibold leading-[1.12] tracking-[-0.015em] text-navy-900 md:text-[42px]" data-testid="guide-title">{title}</h1>
              <p className="mt-4 text-[16px] leading-relaxed text-ink-700">{lead}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link to={guide.cta.to} className="btn btn-primary" data-testid="guide-cta">
                  {guide.cta.label}
                  <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                </Link>
                {guide.secondary && (
                  <Link to={guide.secondary.to} className="btn btn-secondary">{guide.secondary.label}</Link>
                )}
              </div>
              <ul className="mt-6 flex flex-wrap gap-2" aria-label={t('guides.audience')}>
                {guide.audience.map((a) => (
                  <li key={a} className="rounded-full border border-ink-200 bg-white px-3 py-1 text-[12.5px] text-ink-700">{a}</li>
                ))}
              </ul>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1" aria-label={t('guides.keyFacts')} dir="ltr" lang="en">
              {guide.facts.map((f) => (
                <div key={f.label} className="rounded-xl border border-ink-200 bg-white p-4">
                  <dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-500">{f.label}</dt>
                  <dd className="mt-1 font-serif text-[20px] font-semibold leading-tight text-navy-900">{f.value}</dd>
                  {f.note && <dd className="mt-1 text-[12.5px] leading-relaxed text-ink-600">{f.note}</dd>}
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>

      <div className="container-x py-10 md:py-12">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
          <article className="min-w-0" lang="en" dir="ltr" data-testid="guide-body">
            {englishOnly && (
              <p className="mb-6 inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-[13px] text-ink-700" dir="auto" lang={lng} data-testid="guide-english-only">
                <Languages className="h-4 w-4 text-brand-600" aria-hidden />
                {t('knowledge.article.englishOnly')}
              </p>
            )}
            <div className="article-body">
              <Blocks blocks={guide.body} />
            </div>

            {/* ── How TMistan helps ─────────────────────────────────── */}
            <section className="mt-10 rounded-xl border border-ink-200 bg-white p-6" aria-labelledby="guide-tools">
              <h2 id="guide-tools" className="flex items-center gap-2 font-serif text-[20px] font-semibold text-navy-900">
                <Wrench className="h-5 w-5 text-brand-600" aria-hidden />
                {t('guides.tools')}
              </h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {guide.tools.map((tool) => (
                  <li key={tool.title}>
                    <Link to={tool.to} className="block h-full rounded-lg border border-ink-200 bg-ivory-50 p-4 transition-colors hover:border-brand-300 hover:bg-white">
                      <span className="block text-[14.5px] font-semibold text-navy-900">{tool.title}</span>
                      <span className="mt-1 block text-[13px] leading-relaxed text-ink-600">{tool.text}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            {/* ── FAQ ───────────────────────────────────────────────── */}
            <section className="mt-10" aria-labelledby="guide-faq" data-testid="guide-faq">
              <h2 id="guide-faq" className="font-serif text-[22px] font-semibold text-navy-900">{t('guides.faq')}</h2>
              <div className="mt-4 divide-y divide-ink-200 rounded-xl border border-ink-200 bg-white">
                {guide.faqs.map((f) => (
                  <details key={f.q} className="group px-5 py-4">
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-[15px] font-semibold text-navy-900 [&::-webkit-details-marker]:hidden">
                      <h3 className="text-[15px] font-semibold">{f.q}</h3>
                      <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 transition-transform group-open:rotate-180" aria-hidden />
                    </summary>
                    <p className="mt-3 text-[14.5px] leading-relaxed text-ink-700"><Inline text={f.a} /></p>
                  </details>
                ))}
              </div>
            </section>

            {/* ── Sources ───────────────────────────────────────────── */}
            <section className="mt-9 rounded-xl border border-ink-200 bg-ink-50 p-5" aria-labelledby="guide-sources">
              <h2 id="guide-sources" className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-700">{t('knowledge.article.sources')}</h2>
              <ol className="mt-3 list-decimal space-y-2 ps-5 text-[13.5px] leading-relaxed text-ink-700">
                {guide.sources.map((k) => (
                  <li key={k}>
                    <a href={SRC[k].href} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800">{SRC[k].label}</a>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-[12.5px] text-ink-500">{t('knowledge.article.sourcesNote')}</p>
            </section>

            <InfoBanner Icon={Info} title={t('knowledge.article.disclaimerTitle')} tone="amber" className="mt-8">
              <p>{t('knowledge.article.disclaimer')}</p>
              <p className="mt-1">
                <Trans i18nKey="knowledge.article.policies" components={{ 1: <Link to="/legal/disclaimer" className="font-semibold text-brand-700 underline underline-offset-2" />, 3: <Link to="/data-sources" className="font-semibold text-brand-700 underline underline-offset-2" /> }} />
              </p>
            </InfoBanner>
          </article>

          <aside className="space-y-6 lg:sticky lg:top-(--hdr-sticky) lg:self-start">
            {toc.length > 0 && (
              <SidePanel title={t('knowledge.article.toc')} tone="white">
                <ol className="mt-3 space-y-1.5 text-[13.5px]" dir="ltr">
                  {toc.map((h) => (
                    <li key={h.id}><a href={`#${h.id}`} className="block rounded px-2 py-1 text-ink-700 hover:bg-ink-50 hover:text-brand-700">{h.text}</a></li>
                  ))}
                  <li><a href="#guide-faq" className="block rounded px-2 py-1 text-ink-700 hover:bg-ink-50 hover:text-brand-700">{t('guides.faq')}</a></li>
                </ol>
              </SidePanel>
            )}
            {articles.length > 0 && (
              <section aria-labelledby="guide-articles">
                <h2 id="guide-articles" className="font-serif text-[18px] font-semibold text-navy-900">{t('guides.goDeeper')}</h2>
                <ul className="mt-3 space-y-3">
                  {articles.map((a) => <li key={a.slug}><ArticleCard article={a} compact /></li>)}
                </ul>
              </section>
            )}
            {related.length > 0 && (
              <section aria-labelledby="guide-related">
                <h2 id="guide-related" className="font-serif text-[18px] font-semibold text-navy-900">{t('guides.relatedGuides')}</h2>
                <ul className="mt-3 grid gap-3">
                  {related.map((g) => <li key={g.slug}><GuideCard guide={g} compact /></li>)}
                </ul>
              </section>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
