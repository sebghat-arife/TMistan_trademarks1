/* ---------------------------------------------------------------------------
 * Head metadata model shared by <Seo> (Seo.tsx), the browser and the prerenderer:
 * title, description, robots, canonical, hreflang alternates, Open Graph,
 * Twitter card and JSON-LD.
 *
 * In the browser the tags are written imperatively (every element carries
 * data-seo so the previous page's tags are replaced, never duplicated).
 * During prerendering (scripts/prerender.mjs → src/entry-server.tsx) the same
 * data is collected into `ssrHead` and injected into the static HTML, so
 * crawlers and link previews see the final metadata without running JS.
 * ------------------------------------------------------------------------- */
import { CANONICAL_URL } from '@/lib/site'
import { alternatePaths, localizePath, normalizePath, siteLocale, type SiteLocaleCode } from './locales'

export const DEFAULT_OG_IMAGE = '/brand/og-default.png'
export const SITE_NAME = 'TMistan'
export const TWITTER_CARD = 'summary_large_image'

export type SeoProps = {
  /** Full document title (already includes the brand where wanted). */
  title: string
  description: string
  /**
   * Locale-less route path this page is canonical for ('/services', '/trademark/1427-007').
   * Defaults to the current route. Query strings are never part of a canonical URL.
   */
  path?: string
  /**
   * 'languages' (default): every language version is its own canonical page and the three
   * versions reference each other with hreflang. Use for fully translated pages.
   * 'english': the English URL is canonical for all languages and no hreflang is emitted —
   * for pages whose main content is identical in every language (trademark records, English-only articles).
   */
  canonical?: 'languages' | 'english'
  /** Robots directive, e.g. 'noindex,follow'. Omit for indexable pages. */
  robots?: string
  type?: 'website' | 'article'
  /** Site-relative or absolute image for link previews (1200×630 recommended). */
  image?: string | null
  imageAlt?: string
  publishedTime?: string
  modifiedTime?: string
  /** One or more JSON-LD objects (already complete, with @context). */
  jsonLd?: object | object[]
}

export type HeadTag =
  | { tag: 'meta'; name?: string; property?: string; content: string }
  | { tag: 'link'; rel: string; href: string; hreflang?: string }
  | { tag: 'script'; type: 'application/ld+json'; text: string }

export type HeadState = {
  title: string
  lang: string
  dir: 'ltr' | 'rtl'
  tags: HeadTag[]
}

/** Server-side sink: the last <Seo> rendered during a prerender pass (see entry-server.tsx). */
export const ssrHead: { current: HeadState | null } = { current: null }

export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  return `${CANONICAL_URL}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`
}

export function buildHead(props: SeoProps, lng: SiteLocaleCode, currentPath: string): HeadState {
  const locale = siteLocale(lng)
  const path = normalizePath(props.path ?? currentPath)
  const canonicalMode = props.canonical ?? 'languages'
  const canonicalPath = canonicalMode === 'english' ? localizePath(path, 'en') : localizePath(path, lng)
  const canonicalUrl = absoluteUrl(canonicalPath)
  const image = absoluteUrl(props.image || DEFAULT_OG_IMAGE)
  const description = squeeze(props.description)
  const title = squeeze(props.title)
  const tags: HeadTag[] = [
    { tag: 'meta', name: 'description', content: description },
    ...(props.robots ? [{ tag: 'meta', name: 'robots', content: props.robots } as HeadTag] : []),
    { tag: 'link', rel: 'canonical', href: canonicalUrl },
    { tag: 'meta', property: 'og:site_name', content: SITE_NAME },
    { tag: 'meta', property: 'og:type', content: props.type ?? 'website' },
    { tag: 'meta', property: 'og:title', content: title },
    { tag: 'meta', property: 'og:description', content: description },
    { tag: 'meta', property: 'og:url', content: canonicalUrl },
    { tag: 'meta', property: 'og:image', content: image },
    ...(props.imageAlt ? [{ tag: 'meta', property: 'og:image:alt', content: props.imageAlt } as HeadTag] : []),
    { tag: 'meta', property: 'og:locale', content: locale.ogLocale },
    { tag: 'meta', name: 'twitter:card', content: TWITTER_CARD },
    { tag: 'meta', name: 'twitter:title', content: title },
    { tag: 'meta', name: 'twitter:description', content: description },
    { tag: 'meta', name: 'twitter:image', content: image },
  ]
  if (props.type === 'article') {
    if (props.publishedTime) tags.push({ tag: 'meta', property: 'article:published_time', content: props.publishedTime })
    if (props.modifiedTime) tags.push({ tag: 'meta', property: 'article:modified_time', content: props.modifiedTime })
  }
  if (canonicalMode === 'languages' && !props.robots?.includes('noindex')) {
    for (const alt of alternatePaths(path)) tags.push({ tag: 'link', rel: 'alternate', hreflang: alt.hreflang, href: absoluteUrl(alt.path) })
    for (const other of ['en', 'fa', 'ps'] as const) {
      if (other !== lng) tags.push({ tag: 'meta', property: 'og:locale:alternate', content: siteLocale(other).ogLocale })
    }
  }
  if (props.jsonLd) {
    const items = Array.isArray(props.jsonLd) ? props.jsonLd : [props.jsonLd]
    for (const item of items) tags.push({ tag: 'script', type: 'application/ld+json', text: safeJsonLd(item) })
  }
  return { title, lang: locale.htmlLang, dir: locale.dir, tags }
}

/** Collapse whitespace; metadata must be single-line. */
function squeeze(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** JSON-LD inside <script>: escape sequences that could close the element. */
function safeJsonLd(o: object): string {
  return JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
}

/** Serialise the collected head to HTML (prerender). */
export function headToHtml(h: HeadState): string {
  const out: string[] = [`<title>${esc(h.title)}</title>`]
  for (const t of h.tags) {
    if (t.tag === 'meta') out.push(`<meta ${t.name ? `name="${esc(t.name)}"` : `property="${esc(t.property!)}"`} content="${esc(t.content)}" data-seo>`)
    else if (t.tag === 'link') out.push(`<link rel="${esc(t.rel)}"${t.hreflang ? ` hreflang="${esc(t.hreflang)}"` : ''} href="${esc(t.href)}" data-seo>`)
    else out.push(`<script type="application/ld+json" data-seo>${t.text}</script>`)
  }
  return out.join('\n    ')
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Browser: replace the managed head tags with the given state. */
export function applyHead(h: HeadState): void {
  if (typeof document === 'undefined') return
  document.title = h.title
  const head = document.head
  for (const el of Array.from(head.querySelectorAll('[data-seo]'))) el.remove()
  const frag = document.createDocumentFragment()
  for (const t of h.tags) {
    let el: HTMLElement
    if (t.tag === 'meta') {
      el = document.createElement('meta')
      if (t.name) el.setAttribute('name', t.name)
      if (t.property) el.setAttribute('property', t.property)
      el.setAttribute('content', t.content)
    } else if (t.tag === 'link') {
      el = document.createElement('link')
      el.setAttribute('rel', t.rel)
      if (t.hreflang) el.setAttribute('hreflang', t.hreflang)
      el.setAttribute('href', t.href)
    } else {
      el = document.createElement('script')
      el.setAttribute('type', 'application/ld+json')
      el.textContent = t.text
    }
    el.setAttribute('data-seo', '')
    frag.appendChild(el)
  }
  head.appendChild(frag)
}
