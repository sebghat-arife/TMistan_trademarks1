/* ---------------------------------------------------------------------------
 * Guide metadata (slug, titles, meta description, icon) — deliberately separate from
 * the guide bodies in guides.ts so pages that only list guides (home page, asides)
 * do not pull ~85 kB of editorial content into their bundle.
 * ------------------------------------------------------------------------- */
export type GuideIcon = 'Search' | 'FileText' | 'ShieldCheck' | 'Scale' | 'Tag' | 'Globe' | 'RefreshCw' | 'Layers' | 'Briefcase' | 'BookOpen' | 'Gavel'

export type GuideMeta = {
  slug: string
  /** H1 and card title (English). */
  title: string
  /** <title> without the brand suffix. */
  seoTitle: string
  /** Meta description, also the card text (≤ 160 characters). */
  metaDescription: string
  icon: GuideIcon
}

export const GUIDE_META: GuideMeta[] = [
  {
    slug: 'trademark-search-afghanistan',
    title: 'Trademark Search in Afghanistan',
    seoTitle: 'Trademark Search in Afghanistan – Search Published Records Free',
    metaDescription: 'Search Afghanistan trademark records from the Official Gazette by name, applicant, Nice class, Gazette number or image — free. What it covers and its limits.',
    icon: 'Search',
  },
  {
    slug: 'trademark-registration-afghanistan',
    title: 'Trademark Registration in Afghanistan',
    seoTitle: 'Trademark Registration in Afghanistan – Process, Law and Timeline',
    metaDescription: 'How trademark registration works in Afghanistan under the 2009 law: who may apply, 30-day examination, Gazette publication, objection window, ten-year term.',
    icon: 'FileText',
  },
  {
    slug: 'trademark-availability-search',
    title: 'Trademark Availability Search',
    seoTitle: 'Trademark Availability Search Afghanistan – Is Your Name Free?',
    metaDescription: 'A quick, structured way to check whether a brand name or logo is already published as a trademark in Afghanistan — by name, variants, class and image.',
    icon: 'ShieldCheck',
  },
  {
    slug: 'trademark-clearance-research',
    title: 'Trademark Clearance Research in Afghanistan',
    seoTitle: 'Trademark Clearance Research in Afghanistan – Professional Method',
    metaDescription: 'A professional method for clearing a trademark for Afghanistan: scope, similarity, class strategy, ownership history, the International Register, documentation.',
    icon: 'Scale',
  },
  {
    slug: 'trademark-opposition-afghanistan',
    title: 'Trademark Opposition in Afghanistan',
    seoTitle: 'Trademark Opposition in Afghanistan – Deadlines and Procedure',
    metaDescription: 'How to oppose a trademark in Afghanistan: who may object, the 30-day window after Gazette publication, office and court stages (Articles 25–30), monitoring.',
    icon: 'Gavel',
  },
  {
    slug: 'trademark-renewal-and-ownership-changes',
    title: 'Trademark Renewal and Ownership Changes in Afghanistan',
    seoTitle: 'Trademark Renewal and Ownership Changes in Afghanistan',
    metaDescription: 'The ten-year term and six-month renewal rule, how assignments, name and address changes and mergers are recorded, and how each notice appears in TMistan.',
    icon: 'RefreshCw',
  },
  {
    slug: 'trademark-classification-afghanistan',
    title: 'Trademark Classification in Afghanistan',
    seoTitle: 'Trademark Classification in Afghanistan – Classes in Records',
    metaDescription: 'How goods and services are classified in Afghan trademark publications: the Article 18 “ranking”, Nice classes in practice, single-class filings, class filters.',
    icon: 'Tag',
  },
  {
    slug: 'nice-classification-explained',
    title: 'Nice Classification Explained',
    seoTitle: 'Nice Classification Explained – 45 Trademark Classes',
    metaDescription: 'What the Nice Classification is, how its 34 goods and 11 service classes are organised, how editions change and how to choose classes — with Afghan examples.',
    icon: 'Layers',
  },
  {
    slug: 'trademark-protection-foreign-businesses',
    title: 'Trademark Protection for Foreign Businesses in Afghanistan',
    seoTitle: 'Trademark Protection in Afghanistan for Foreign Businesses',
    metaDescription: 'How a foreign company protects its trademark in Afghanistan: national filing through an agent, six-month priority, Madrid Protocol designations, famous marks.',
    icon: 'Globe',
  },
  {
    slug: 'trademark-research-international-companies',
    title: 'Trademark Research in Afghanistan for International Companies',
    seoTitle: 'Afghanistan Trademark Research for International Companies',
    metaDescription: 'A research workflow for international brand owners and counsel: portfolio audit in published Afghan records, distributor and look-alike checks, monitoring.',
    icon: 'Briefcase',
  },
  {
    slug: 'afghanistan-trademark-law-and-regulations',
    title: 'Afghanistan Trademark Law and Regulations',
    seoTitle: 'Afghanistan Trademark Law and Regulations – Overview',
    metaDescription: 'Afghanistan’s trademark legal framework: the Law on Trade Marks Registration (Gazette No. 995, 2009), its chapters and key articles, regulations, WIPO treaties.',
    icon: 'BookOpen',
  },
]

export const GUIDE_META_BY_SLUG: Record<string, GuideMeta> = Object.fromEntries(GUIDE_META.map((m) => [m.slug, m]))
