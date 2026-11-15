/* ---------------------------------------------------------------------------
 * schema.org JSON-LD builders. Only facts that are true for TMistan are
 * expressed: TMistan is a trademark research platform developed by Masnad Law
 * Firm; it is not a government agency or an official registry, so no
 * GovernmentOrganization / official-registry types are used and nothing
 * (ratings, awards, reviews) is invented.
 * ------------------------------------------------------------------------- */
import { CANONICAL_URL, MASNAD_URL } from '@/lib/site'
import { absoluteUrl, DEFAULT_OG_IMAGE } from './head'
import { siteLocale, type SiteLocaleCode } from './locales'

const CONTEXT = 'https://schema.org'

export const ORG_ID = `${CANONICAL_URL}/#organization`
export const MASNAD_ID = `${CANONICAL_URL}/#masnad-law-firm`
export const WEBSITE_ID = `${CANONICAL_URL}/#website`

/** Masnad Law Firm — the developer and publisher of TMistan. */
export function masnadOrganization() {
  return {
    '@type': 'LegalService',
    '@id': MASNAD_ID,
    name: 'Masnad Law Firm',
    ...(MASNAD_URL ? { url: MASNAD_URL } : {}),
    areaServed: { '@type': 'Country', name: 'Afghanistan' },
  }
}

/** TMistan as the publishing organisation (brand of Masnad Law Firm). */
export function tmistanOrganization(description: string) {
  return {
    '@type': 'Organization',
    '@id': ORG_ID,
    name: 'TMistan',
    url: `${CANONICAL_URL}/`,
    logo: { '@type': 'ImageObject', url: absoluteUrl('/brand/logo.png') },
    description,
    parentOrganization: { '@id': MASNAD_ID },
  }
}

export function webSite(lng: SiteLocaleCode, name: string, description: string) {
  return {
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    url: `${CANONICAL_URL}/`,
    name,
    description,
    inLanguage: siteLocale(lng).hreflang,
    publisher: { '@id': ORG_ID },
  }
}

/** The graph emitted on the home page: site + both organisations. */
export function homeGraph(lng: SiteLocaleCode, siteName: string, description: string, orgDescription: string) {
  return {
    '@context': CONTEXT,
    '@graph': [webSite(lng, siteName, description), tmistanOrganization(orgDescription), masnadOrganization()],
  }
}

export type Crumb = { name: string; path: string }

export function breadcrumbList(crumbs: Crumb[]) {
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: absoluteUrl(c.path),
    })),
  }
}

type PageType = 'WebPage' | 'AboutPage' | 'ContactPage' | 'CollectionPage' | 'FAQPage' | 'ItemPage'

export function webPage(opts: {
  type?: PageType
  lng: SiteLocaleCode
  url: string
  name: string
  description: string
  image?: string | null
  dateModified?: string
  datePublished?: string
  extra?: Record<string, unknown>
}) {
  return {
    '@context': CONTEXT,
    '@type': opts.type ?? 'WebPage',
    url: absoluteUrl(opts.url),
    name: opts.name,
    description: opts.description,
    inLanguage: siteLocale(opts.lng).hreflang,
    isPartOf: { '@id': WEBSITE_ID },
    publisher: { '@id': ORG_ID },
    ...(opts.image ? { primaryImageOfPage: { '@type': 'ImageObject', url: absoluteUrl(opts.image) } } : {}),
    ...(opts.datePublished ? { datePublished: opts.datePublished } : {}),
    ...(opts.dateModified ? { dateModified: opts.dateModified } : {}),
    ...(opts.extra ?? {}),
  }
}

export function faqPage(opts: { lng: SiteLocaleCode; url: string; name: string; description: string; faqs: { q: string; a: string }[] }) {
  return webPage({
    type: 'FAQPage',
    lng: opts.lng,
    url: opts.url,
    name: opts.name,
    description: opts.description,
    extra: {
      mainEntity: opts.faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  })
}

export function article(opts: {
  lng: SiteLocaleCode
  url: string
  headline: string
  description: string
  image?: string | null
  datePublished: string
  dateModified: string
  authorName: string
  wordCount?: number
  keywords?: string[]
  section?: string
}) {
  return {
    '@context': CONTEXT,
    '@type': 'Article',
    mainEntityOfPage: absoluteUrl(opts.url),
    url: absoluteUrl(opts.url),
    headline: opts.headline,
    description: opts.description,
    image: [absoluteUrl(opts.image || DEFAULT_OG_IMAGE)],
    datePublished: opts.datePublished,
    dateModified: opts.dateModified,
    inLanguage: 'en',
    author: { '@type': 'Organization', name: opts.authorName, '@id': ORG_ID },
    publisher: { '@id': ORG_ID },
    isPartOf: { '@id': WEBSITE_ID },
    ...(opts.wordCount ? { wordCount: opts.wordCount } : {}),
    ...(opts.keywords?.length ? { keywords: opts.keywords.join(', ') } : {}),
    ...(opts.section ? { articleSection: opts.section } : {}),
  }
}

/** A published trademark record page. No schema.org type exists for trademarks; the page is an ItemPage about a named Thing. */
export function trademarkRecordPage(opts: {
  lng: SiteLocaleCode
  url: string
  name: string
  description: string
  serial: string
  image?: string | null
  publicationDate?: string | null
  updatedAt?: string | null
  applicant?: string | null
  classes?: number[] | null
}) {
  return webPage({
    type: 'ItemPage',
    lng: opts.lng,
    url: opts.url,
    name: opts.name,
    description: opts.description,
    image: opts.image,
    dateModified: opts.updatedAt ?? undefined,
    extra: {
      mainEntity: {
        '@type': 'Thing',
        name: opts.name,
        identifier: [{ '@type': 'PropertyValue', propertyID: 'TMistan Serial Number', value: opts.serial }],
        ...(opts.image ? { image: absoluteUrl(opts.image) } : {}),
        description: opts.description,
        ...(opts.applicant ? { subjectOf: { '@type': 'CreativeWork', name: 'Official Gazette of Afghanistan trademark publication', ...(opts.publicationDate ? { datePublished: opts.publicationDate } : {}) } } : {}),
      },
    },
  })
}
