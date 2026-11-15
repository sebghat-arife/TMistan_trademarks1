/* ---------------------------------------------------------------------------
 * Guides — educational landing pages (/guides/<slug>), second SEO phase (2026-11-16).
 *
 * A guide is a "pillar" page: an orientation for one research question, with
 * key facts, a structured explanation, FAQs (also emitted as FAQPage JSON-LD),
 * the TMistan features that help, and links to the Knowledge Center articles
 * that go deeper. Guides and articles are deliberately not copies of each
 * other: a guide answers "what is this and what do I do", the articles explain
 * the law and the method in detail.
 *
 * Editorial rules are those of knowledge.ts / knowledgeLaw.ts: legal statements
 * cite the official English translation of the Law on Trade Marks Registration
 * (Official Gazette No. 995, 2009) by article number, treaty dates come from
 * WIPO Lex, practice is labelled as practitioner information, and nothing
 * claims a fee, a processing time beyond the statutory ones, a government
 * relationship or the current status of any mark. Bodies are English; the
 * title, meta description and lead are translated in the locale files
 * (guides.<slug>), and the English URL is canonical for every language.
 * ------------------------------------------------------------------------- */
import type { ArticleBlock } from './knowledge'
import { SRC } from './knowledgeLaw'
import { GUIDE_META_BY_SLUG, type GuideIcon, type GuideMeta } from './guidesMeta'

export type GuideFact = { label: string; value: string; note?: string }
export type GuideFaq = { q: string; a: string }

export type Guide = {
  slug: string
  /** H1. */
  title: string
  /** Search-result title without the brand suffix (added by the page). */
  seoTitle: string
  metaDescription: string
  /** Hero paragraph. */
  lead: string
  written: string
  updated?: string
  /** Lucide icon name used on the hub page (kept to a small, verified set). */
  icon: GuideIcon
  /** Who the page is written for (rendered as chips). */
  audience: string[]
  /** Key-facts strip at the top (3–4 items). */
  facts: GuideFact[]
  body: ArticleBlock[]
  /** TMistan features that help with this question. */
  tools: { title: string; text: string; to: string }[]
  faqs: GuideFaq[]
  /** Knowledge Center article slugs to read next. */
  articles: string[]
  /** Related guides. */
  guides: string[]
  cta: { label: string; to: string }
  secondary?: { label: string; to: string }
  sources: (keyof typeof SRC)[]
}

const WRITTEN = '2026-11-16'

const LEGAL_NOTE: ArticleBlock = {
  type: 'note',
  title: 'Orientation, not legal advice',
  text: 'This guide summarises the official English translation of Afghanistan’s Law on Trade Marks Registration (Official Gazette No. 995, 2009) and public WIPO information. The Dari and Pashto texts are authoritative, the law and its regulations may have been amended, and registry practice can differ from the statute. TMistan is a research platform developed by Masnad Law Firm; it is not a government body and does not register trademarks.',
}

/** Slug, titles, meta description and icon live in guidesMeta.ts (light module shared with the home page). */
function meta(slug: string): GuideMeta {
  const m = GUIDE_META_BY_SLUG[slug]
  if (!m) throw new Error(`guidesMeta.ts has no entry for guide "${slug}"`)
  return m
}

export const GUIDES: Guide[] = [
  /* ───────────── 1. Trademark search in Afghanistan ───────────── */
  {
    ...meta('trademark-search-afghanistan'),
    lead: 'TMistan lets anyone search trademark records published in the Official Gazette of Afghanistan — by mark name, applicant, serial number, Nice class, Gazette number or by uploading an image. This guide explains what the search covers, how to get reliable results in English, Dari and Pashto, and what a result does and does not tell you.',
    written: WRITTEN,
    audience: ['Business owners', 'Trademark attorneys', 'Brand and IP teams', 'Researchers'],
    facts: [
      { label: 'Source of the records', value: 'Official Gazette of Afghanistan', note: 'Registered marks and later changes must be published in the Gazette (Art. 18).' },
      { label: 'Search modes', value: 'Text, filters and image', note: 'Keyword with fuzzy matching, class and Gazette filters, Search by Image.' },
      { label: 'Languages', value: 'English · Dari · Pashto', note: 'Records are shown as published and are never machine-translated.' },
      { label: 'Cost', value: 'Free', note: 'Searching and downloading a record report costs nothing.' },
    ],
    body: [
      { type: 'h2', id: 'what-you-search', text: 'What you are searching' },
      { type: 'p', text: 'Under the Law on Trade Marks Registration, the owner of a registered trademark must present it for publication in the Official Gazette within 15 days of registration, together with the goods or services, their class, the owner’s name and address and any later changes (Article 18). Those publications are the raw material of TMistan: each Gazette entry becomes one structured record with a mark name, an image where one was printed, the applicant, the class, the goods and services, the publication date and the exact Gazette number and page it came from. How the records are built — and which issues are covered so far — is described on the [Data Sources & Methodology](/data-sources) page.' },
      { type: 'p', text: 'A search therefore answers the question “what has been published?”. It does not answer “is this mark registered and in force today?” — the register itself is kept by the national office, and events such as oppositions, cancellations or lapses are visible only if they were published and captured. Keep this distinction in mind throughout; it is explained further in [What a Search Can and Cannot Tell You](/knowledge-center/what-a-search-can-and-cannot-tell-you).' },
      { type: 'h2', id: 'how-to-search', text: 'How to search' },
      { type: 'h3', text: 'By name' },
      { type: 'p', text: 'Type the mark in the search box on the [home page](/). Results come from the mark name, the printed form of the mark, the applicant name and the goods text. Fuzzy matching (in Advanced Search) tolerates spelling differences and transliterations — useful because the same word is often printed in Latin, Dari and Pashto script in different issues.' },
      { type: 'h3', text: 'By applicant, class or Gazette' },
      { type: 'p', text: 'Advanced Search adds filters for the Nice class (with the number of published records per class), the application type (new registration, assignment, renewal and the other notice types), the Gazette number and the publication period. Searching an applicant name shows a company’s published portfolio; filtering by class shows how crowded a market is.' },
      { type: 'h3', text: 'By image' },
      { type: 'p', text: 'Switch to Search by Image and upload a logo. The image is analysed in your browser; text recognised in it is matched against mark names and its visual features are compared with the images indexed from the records. Results are ranked by similarity level and can be narrowed to your classes. The method and its limits are documented in [How to Search Trademark Records](/knowledge-center/how-to-search-trademark-records).' },
      { type: 'h2', id: 'reading-results', text: 'Reading a result' },
      { type: 'p', text: 'Open any result to see the record page: the mark and its image, the applicant and address, the class and goods, the application type, the publication date, any objection deadline printed with the entry and the source line “Gazette Number — Page”. Every value is shown exactly as published; where the source gave nothing, the field reads N/A. The record can be downloaded as a printable report with the source reference and a disclaimer. The fields are explained one by one in [How to Read Gazette Entries](/knowledge-center/how-to-read-gazette-entries) and the [Glossary](/knowledge-center/glossary-of-afghanistan-trademark-terms).' },
      { type: 'h2', id: 'three-languages', text: 'Searching in three languages' },
      { type: 'p', text: 'The interface is available in English, Dari and Pashto, and the search accepts any script. Records themselves are not translated: a mark printed in Dari is found by its Dari spelling (or a close variant with fuzzy matching on), a Latin-script mark by its Latin spelling. When you clear a name for the Afghan market, search the spelling your customers will see and the obvious transliterations — the [clearance method](/knowledge-center/how-to-check-if-a-trademark-is-taken-in-afghanistan) walks through the passes.' },
      { type: 'h2', id: 'limits', text: 'Limits to keep in mind' },
      { type: 'ul', items: [
        'Coverage grows issue by issue; the database is not a complete register and TMistan never claims it is.',
        'A record shows the publication, not today’s legal status.',
        'Marks protected by use or as well-known marks (Article 9) need not appear in any publication.',
        'Since 26 June 2018 marks can also reach Afghanistan through the Madrid Protocol; international registrations are searched at WIPO, not on TMistan.',
        'Similarity scores are research aids, not legal determinations.',
      ] },
      LEGAL_NOTE,
    ],
    tools: [
      { title: 'Keyword search with fuzzy matching', text: 'Name, applicant, printed mark and goods text, in any script.', to: '/' },
      { title: 'Class and Gazette filters', text: 'Narrow to the classes and issues that matter to you.', to: '/' },
      { title: 'Search by Image', text: 'Find visually similar published marks from a logo.', to: '/?mode=image' },
      { title: 'Download Record', text: 'A printable report with the source reference.', to: '/knowledge-center/how-to-read-gazette-entries' },
    ],
    faqs: [
      { q: 'Is the trademark search on TMistan free?', a: 'Yes. Searching the published records, opening record pages and downloading a record report are free. Tailored research by Masnad Law Firm is a separate service described on the Services page; scope, timeline and any fees are confirmed by the firm for each inquiry.' },
      { q: 'Does a search on TMistan show whether a trademark is registered in Afghanistan?', a: 'It shows whether a matching publication exists in the Gazette issues TMistan has processed. Publication follows registration under Article 18 of the law, but the current status of a mark — renewed, opposed, cancelled or lapsed — can only be confirmed with the national registry or a qualified professional.' },
      { q: 'Can I search in Dari or Pashto?', a: 'Yes. The interface is available in both languages and the search accepts any script. Records are displayed as published; they are not translated.' },
      { q: 'How do I search for a logo?', a: 'Use Search by Image on the home page. Upload the logo; it is analysed in your browser and compared with the images indexed from published records. Results are candidates to review, not legal findings.' },
      { q: 'Why is a field shown as N/A?', a: 'The source publication did not provide that value. TMistan never fills gaps with guesses.' },
    ],
    articles: ['how-to-search-trademark-records', 'how-to-read-gazette-entries', 'what-a-search-can-and-cannot-tell-you', 'how-to-check-if-a-trademark-is-taken-in-afghanistan'],
    guides: ['trademark-availability-search', 'trademark-clearance-research', 'trademark-classification-afghanistan'],
    cta: { label: 'Start searching', to: '/' },
    secondary: { label: 'Data Sources & Methodology', to: '/data-sources' },
    sources: ['law', 'wipolex', 'madridMonitor'],
  },

  /* ───────────── 2. Trademark registration in Afghanistan ───────────── */
  {
    ...meta('trademark-registration-afghanistan'),
    lead: 'Afghanistan registers trademarks under the Law on Trade Marks Registration published in Official Gazette No. 995 (2009). This guide sets out the statutory path — application, examination, registration, publication, objection period and term — with article references, and explains how to research the published records before you file.',
    written: WRITTEN,
    audience: ['Afghan businesses', 'Foreign applicants', 'Trademark attorneys', 'Start-ups'],
    facts: [
      { label: 'Governing law', value: 'OG No. 995 (1 Sept 2009)', note: '5 chapters, 36 articles; amended in 2015 according to practitioner sources.' },
      { label: 'Examination decision', value: '30 days', note: 'From receipt of the application (Art. 11); 15 days to cure or appeal.' },
      { label: 'Objection window', value: '30 days', note: 'After publication in the Official Gazette (Art. 26).' },
      { label: 'Term', value: '10 years, renewable', note: 'Renewal requested six months before expiry (Art. 20).' },
    ],
    body: [
      { type: 'h2', id: 'who-can-apply', text: 'Who can apply and where' },
      { type: 'p', text: 'Anyone seeking the exclusive use of a sign to distinguish goods of their own production, manufacture or selection, or goods they trade in, may apply (Article 6). Domestic and foreign commercial, industrial, telecommunications, agricultural, professional and service organisations benefit from the law once their marks are registered under it (Article 7). Applications are filed personally or through a legal representative (Article 10) with the Central Registration Office (Trademarks Registration Section) — described by practitioners today as the ACBR-IP office under the Ministry of Industry and Commerce. TMistan has no connection with that office.' },
      { type: 'h2', id: 'what-can-be-registered', text: 'What can be registered' },
      { type: 'p', text: 'A trademark may consist of names, words, signatures, letters, figures, drawings, titles, seals, pictures, inscriptions, advertisements, symbols or any combination (Article 4). Article 8 lists fifteen categories that may not be used or registered — national flags and state emblems, religious symbols, pictures of national leaders, non-distinctive or generic signs, misleading marks and marks identical or similar to registered marks for identical goods, among others. The full list is in [What Can and Cannot Be Registered](/knowledge-center/what-can-be-registered-as-a-trademark-in-afghanistan).' },
      { type: 'h2', id: 'steps', text: 'The statutory steps' },
      { type: 'ol', items: [
        '**Search first.** Article 8(14) bars marks identical or similar to registered marks for identical goods, and Article 11(3) requires the office to reject an application for a mark already registered to someone else. A search of the [published records](/) and of WIPO’s international register shows what is already there.',
        '**File the application** with the particulars of Article 12: applicant name, occupation, address and citizenship (and the representative’s), the goods or services, an explanation of the mark’s elements and payment of the fee set by the Council of Ministers (Article 34).',
        '**Examination.** The office reviews form, nature and compatibility with the law and decides within 30 days (Article 11). A refusal must state reasons; the applicant has 15 days to remedy and resubmit or to appeal to the commercial court.',
        '**Registration and publication.** Within 15 days of registration the owner submits the mark for publication in the Official Gazette at their own cost (Article 18). This is the publication TMistan captures.',
        '**Objection period.** For 30 days after publication, a person who claims the mark or owns a confusingly similar one may object (Articles 25–26); see [Trademark Opposition in Afghanistan](/guides/trademark-opposition-afghanistan).',
        '**Protection and renewal.** Protection runs from the filing date (Article 19); the registration lasts ten years and is renewable on a request made six months before expiry (Article 20).',
      ] },
      { type: 'h2', id: 'priority', text: 'Priority for foreign applicants' },
      { type: 'p', text: 'An applicant who first filed in a state that treats Afghanistan reciprocally may file in Afghanistan within six months and have priority determined by the foreign filing date (Article 10). Afghanistan has been party to the Paris Convention since 14 May 2017 and to the Madrid Protocol since 26 June 2018, so an international registration designating Afghanistan is an alternative route — see [Trademark Protection for Foreign Businesses](/guides/trademark-protection-foreign-businesses).' },
      { type: 'h2', id: 'after', text: 'After registration' },
      { type: 'p', text: 'Transfers are valid only once registered (Article 17), changes to the goods must be registered separately (Article 13), and each change is published like the original registration (Article 18). Ownership ends on failure to renew, on transfer, on a court’s annulment or when three consecutive years of non-use are proved before a commercial court (Article 22). These later events appear in TMistan as separate notice types; see [Trademark Renewal and Ownership Changes](/guides/trademark-renewal-and-ownership-changes).' },
      { type: 'h2', id: 'what-tmistan-does', text: 'What TMistan does — and does not — do' },
      { type: 'p', text: 'TMistan does not file, register or represent. It makes the published records searchable so that applicants, attorneys and researchers can see what exists before filing and follow what is published afterwards. Masnad Law Firm, which develops the platform, offers tailored research reports through the [Services](/services) page; filing itself is a matter for a qualified representative.' },
      LEGAL_NOTE,
    ],
    tools: [
      { title: 'Pre-filing search', text: 'Check the published records by name, class and image before you apply.', to: '/' },
      { title: 'Class picker with counts', text: 'See how many published marks exist in each Nice class.', to: '/' },
      { title: 'Research services', text: 'Availability and similar-mark reports prepared by Masnad Law Firm.', to: '/services' },
    ],
    faqs: [
      { q: 'Which law governs trademark registration in Afghanistan?', a: 'The Law on Trade Marks Registration, published in Official Gazette (Extraordinary Issue) No. 995 on 1 September 2009 — five chapters and thirty-six articles. Practitioner sources report an amendment in 2015 and registration rules issued in 2018; TMistan has not verified the amended texts.' },
      { q: 'How long does the office take to examine an application?', a: 'The law requires a decision within 30 days of receipt (Article 11). Statutory periods are not a promise of actual processing time; TMistan does not publish processing statistics.' },
      { q: 'How much does registration cost?', a: 'Fees are set by the Council of Ministers under Article 34. TMistan does not quote fee amounts; ask the registry or a representative for the current schedule.' },
      { q: 'Can a foreign company register a trademark in Afghanistan?', a: 'Yes. The law applies to domestic and foreign organisations alike once their marks are registered (Article 7); applications may be filed through a legal representative (Article 10), and since 2018 Afghanistan can also be designated under the Madrid Protocol.' },
      { q: 'Does TMistan register trademarks?', a: 'No. TMistan is a research platform developed by Masnad Law Firm. It searches and documents published records; it has no connection with the national registry.' },
    ],
    articles: ['trademark-registration-process-afghanistan', 'afghanistan-trademark-law-overview', 'what-can-be-registered-as-a-trademark-in-afghanistan', 'trademark-renewal-and-validity-afghanistan'],
    guides: ['afghanistan-trademark-law-and-regulations', 'trademark-opposition-afghanistan', 'trademark-protection-foreign-businesses'],
    cta: { label: 'Search before you file', to: '/' },
    secondary: { label: 'Research services', to: '/services' },
    sources: ['law', 'lawWipo', 'wipolex', 'axiom'],
  },

  /* ───────────── 3. Availability search ───────────── */
  {
    ...meta('trademark-availability-search'),
    lead: 'Before you print packaging or register a company name, find out whether someone has already published the same or a similar trademark in Afghanistan. An availability search is the fast, first-pass check; this guide shows how to do it on TMistan in a few minutes and how to read the outcome honestly.',
    written: WRITTEN,
    audience: ['Founders and SMEs', 'Marketing teams', 'Designers', 'Advisers'],
    facts: [
      { label: 'What it answers', value: 'Is there an obvious conflict?', note: 'A knock-out check — not a full clearance opinion.' },
      { label: 'Legal yardstick', value: 'Art. 8(14)', note: 'Identical/similar marks for identical goods cannot be registered.' },
      { label: 'Time needed', value: '10–20 minutes', note: 'Name, variants, classes and image on TMistan.' },
      { label: 'Also check', value: 'WIPO Madrid Monitor', note: 'International registrations designating AF since 2018.' },
    ],
    body: [
      { type: 'h2', id: 'availability-vs-clearance', text: 'Availability search versus clearance research' },
      { type: 'p', text: 'An availability (or “knock-out”) search looks for obvious obstacles: the same word, a near-identical spelling or an identical logo already published for the same kind of goods. It is quick and you can do it yourself. Clearance research goes further — phonetic and conceptual similarity, related goods, ownership history, the international register, documented conclusions — and is usually done by a professional before a significant investment. Use this guide for the first; see [Trademark Clearance Research](/guides/trademark-clearance-research) for the second.' },
      { type: 'h2', id: 'steps', text: 'A ten-minute availability check' },
      { type: 'ol', items: [
        'Write down the exact name, the logo and the goods or services, and identify their Nice classes using [Choosing Nice Classes](/knowledge-center/nice-classes-for-common-goods-and-services).',
        'Search the exact name on the [home page](/). Scan the results for the same word in your classes.',
        'Repeat with fuzzy matching on, and with the name in Dari or Pashto script if customers will see it that way.',
        'Search the distinctive part of the name alone (a coined word, an unusual spelling).',
        'If you have a logo, run Search by Image and look at the top candidates.',
        'Open every close record and compare the goods, class, applicant and publication date; download the ones that matter.',
        'Check WIPO’s Madrid Monitor for international registrations designating Afghanistan (AF).',
      ] },
      { type: 'h2', id: 'outcomes', text: 'What the outcome means' },
      { type: 'h3', text: 'No close match' },
      { type: 'p', text: 'Encouraging, not conclusive. TMistan’s coverage grows issue by issue; marks protected through use or as well-known marks (Article 9) need not be published; and records show publication, not current status. A clean knock-out search is the green light for proper clearance, not a substitute for it.' },
      { type: 'h3', text: 'A close match in your class' },
      { type: 'p', text: 'A serious signal. Article 8(14) prevents registration of a mark identical or similar to a registered mark for identical goods or services, and Article 11(3) requires the office to refuse an application for a mark already registered to a third person. Whether a given match is “similar” in the legal sense is a professional judgement; take the record to an adviser before changing course or proceeding.' },
      { type: 'h3', text: 'A match in an unrelated class' },
      { type: 'p', text: 'Often not an obstacle, because trademark rights are tied to goods and services — but related goods and well-known marks complicate the picture. Note the record and include it in any clearance review.' },
      { type: 'h2', id: 'mistakes', text: 'Common mistakes' },
      { type: 'ul', items: [
        'Searching only the Latin spelling of a name that will be marketed in Dari or Pashto.',
        'Ignoring the class filter — or relying on it alone when the goods text is more precise.',
        'Treating an old publication as a dead mark: a ten-year term is renewable and renewals are not always captured.',
        'Forgetting the international register: since 26 June 2018 a mark can reach Afghanistan through a Madrid designation that never appears in national publications on TMistan.',
      ] },
      LEGAL_NOTE,
    ],
    tools: [
      { title: 'Exact and fuzzy name search', text: 'Catch spelling variants and transliterations.', to: '/' },
      { title: 'Search by Image', text: 'Compare a logo with the images indexed from published records.', to: '/?mode=image' },
      { title: 'Availability report', text: 'A documented search by Masnad Law Firm when the stakes justify it.', to: '/services' },
    ],
    faqs: [
      { q: 'Can I check trademark availability in Afghanistan for free?', a: 'Yes. TMistan’s search of the published Gazette records is free. It answers whether an obvious conflict has been published; it does not replace a professional clearance opinion.' },
      { q: 'What if the name is free on TMistan?', a: 'Treat it as a good first sign. Coverage is not complete, unregistered and well-known marks may not be published, and international designations are held at WIPO. Proceed to clearance research before investing.' },
      { q: 'What if I find the same name in a different class?', a: 'Trademark rights are tied to goods and services, so a different class is often not a bar — but related goods and well-known marks can still matter. Record the finding and ask a professional if in doubt.' },
      { q: 'Should I search in Dari and Pashto as well?', a: 'Yes, whenever customers will see the mark in those scripts. Records are stored as published, so a Dari spelling is found by its Dari form; fuzzy matching helps with variants.' },
    ],
    articles: ['how-to-check-if-a-trademark-is-taken-in-afghanistan', 'preliminary-trademark-search', 'what-can-be-registered-as-a-trademark-in-afghanistan', 'understanding-trademark-classes'],
    guides: ['trademark-clearance-research', 'trademark-search-afghanistan', 'nice-classification-explained'],
    cta: { label: 'Check a name now', to: '/' },
    secondary: { label: 'Clearance research guide', to: '/guides/trademark-clearance-research' },
    sources: ['law', 'madridMonitor', 'nice'],
  },

  /* ───────────── 4. Clearance research ───────────── */
  {
    ...meta('trademark-clearance-research'),
    lead: 'Clearance research is the systematic assessment of whether a mark can be adopted and registered without conflicting with earlier rights. This guide describes a defensible method for Afghanistan — what to search, how to judge similarity under the local law, which second sources to consult and how to document the work — for attorneys, IP teams and advisers.',
    written: WRITTEN,
    audience: ['Trademark attorneys', 'In-house IP counsel', 'Brand protection teams', 'IP consultants'],
    facts: [
      { label: 'Conflict rule', value: 'Art. 8(14) · Art. 11(3)', note: 'Identical/similar marks for identical goods; previously registered marks.' },
      { label: 'Well-known marks', value: 'Used in 2+ countries', note: 'Protected without local registration (Arts. 3, 9).' },
      { label: 'Second source', value: 'WIPO international register', note: 'Designations of AF since 26 June 2018.' },
      { label: 'Output', value: 'Documented report', note: 'Records with Gazette number and page, dated, with reasoning.' },
    ],
    body: [
      { type: 'h2', id: 'scope', text: 'Define the scope' },
      { type: 'p', text: 'Record the mark in every form in which it will be used — word, stylised word, logo, the Dari and Pashto renderings — and the goods and services with their Nice classes. Note the launch markets and timing: a filing elsewhere within the last six months may support a priority claim in Afghanistan (Article 10), which changes the relevant date.' },
      { type: 'h2', id: 'legal-yardstick', text: 'The legal yardstick' },
      { type: 'p', text: 'Afghan law frames conflict narrowly in its text: Article 8(14) excludes marks for identical goods or services that are identical or similar to registered marks, and Article 11(3) obliges the office to refuse an application for a mark previously registered to a third person. Two further rules widen the net: well-known marks — defined simply as marks used in two or more countries — are protected without registration and must be refused protection against (Articles 3 and 9), and Article 21 presumes ownership in the first user unless the contrary is proved. A clearance opinion for Afghanistan therefore looks beyond registered marks for identical goods to prior users and internationally used brands.' },
      { type: 'h2', id: 'dimensions', text: 'Search dimensions' },
      { type: 'h3', text: 'Visual, phonetic and conceptual' },
      { type: 'p', text: 'Search the exact word; spelling variants and truncations; phonetic equivalents across Latin, Dari and Pashto scripts (fuzzy matching helps, but build your own variant list too); translations and transliterations of meaningful words; and, for device marks, Search by Image on the logo and on its dominant element alone.' },
      { type: 'h3', text: 'Goods and services' },
      { type: 'p', text: 'Run the core searches without a class filter first, then with the target classes, then with neighbouring classes (complementary goods, retail of the goods, the services in which the goods are used). The goods-and-services text on each record is searchable and often more precise than the class number; see [Trademark Classification in Afghanistan](/guides/trademark-classification-afghanistan) for how classes appear in Afghan publications.' },
      { type: 'h3', text: 'Ownership history' },
      { type: 'p', text: 'For each close mark, search the applicant and look for assignment, name-change, address-change, renewal and cancellation notices. A transfer is valid only once registered (Article 17), and change notices are published like registrations (Article 18), so the chain of notices indicates who currently claims the mark as of the last publication.' },
      { type: 'h2', id: 'second-sources', text: 'Second sources' },
      { type: 'ul', items: [
        'WIPO Madrid Monitor and the Global Brand Database for international registrations designating Afghanistan (AF) since 26 June 2018, and for the applicant’s own international portfolio.',
        'The national registry, through a representative, for the current status of the marks that matter — TMistan documents publications, not the register.',
        'Market evidence of use for unregistered marks (Articles 9 and 21), which no database shows.',
      ] },
      { type: 'h2', id: 'assess', text: 'Assess and document' },
      { type: 'p', text: 'For every candidate, record the TMistan serial number, the Gazette number and page, the mark, owner, class and goods, the publication date and any objection deadline; download the record report; and note your similarity reasoning on each of the three dimensions and on the relationship between the goods. State the date of the search, the scripts and variants searched, the classes covered and the known limits of the sources — coverage, status, unpublished rights. A report that is explicit about what it did not check is more useful than one that implies completeness.' },
      { type: 'check', title: 'Clearance file checklist', items: [
        'Mark forms, goods/services, classes and relevant dates recorded.',
        'Word, variant, script and image searches run with and without class filters.',
        'Ownership chain traced for each close mark.',
        'WIPO international register checked for AF designations.',
        'Record reports downloaded with Gazette number and page.',
        'Limits of the sources and date of the search stated in the report.',
      ] },
      LEGAL_NOTE,
    ],
    tools: [
      { title: 'Advanced Search', text: 'Fuzzy matching, class, notice-type, Gazette and date filters.', to: '/' },
      { title: 'Search by Image', text: 'Visual similarity and recognised text from a logo.', to: '/?mode=image' },
      { title: 'Record reports', text: 'Printable PDF of each record with its source reference.', to: '/knowledge-center/how-to-read-gazette-entries' },
      { title: 'Similar-mark research', text: 'Commissioned reports prepared by Masnad Law Firm.', to: '/services' },
    ],
    faqs: [
      { q: 'How is clearance research different from an availability search?', a: 'An availability search is a quick knock-out check for obvious conflicts. Clearance research assesses visual, phonetic and conceptual similarity across related goods, traces ownership, consults the international register and documents the reasoning — the basis for a professional opinion.' },
      { q: 'What is the legal test for conflict in Afghanistan?', a: 'The law excludes marks identical or similar to registered marks for identical goods or services (Article 8(14)) and requires refusal of marks previously registered to third persons (Article 11(3)). Well-known marks are protected without registration (Article 9) and ownership is presumed in the first user (Article 21).' },
      { q: 'Can TMistan confirm that a mark is still in force?', a: 'No. TMistan documents Gazette publications. Current status must be confirmed with the national registry, usually through a representative.' },
      { q: 'Do I need to check WIPO as well?', a: 'Yes. Since 26 June 2018 Afghanistan can be designated under the Madrid Protocol; those international registrations are held at WIPO and are not part of TMistan’s national records.' },
    ],
    articles: ['how-to-check-if-a-trademark-is-taken-in-afghanistan', 'well-known-marks-afghanistan', 'first-use-and-ownership-afghanistan', 'trademark-assignment-and-ownership-changes'],
    guides: ['trademark-availability-search', 'trademark-research-international-companies', 'trademark-classification-afghanistan'],
    cta: { label: 'Open Advanced Search', to: '/' },
    secondary: { label: 'Commission a research report', to: '/services' },
    sources: ['law', 'wipolex', 'madridMonitor', 'gbd'],
  },

  /* ───────────── 5. Opposition ───────────── */
  {
    ...meta('trademark-opposition-afghanistan'),
    lead: 'Publication of a trademark in the Official Gazette opens a 30-day window in which the owner of an earlier or confusingly similar mark may object. This guide explains the statutory procedure, the deadlines at each step and how to watch new publications so that the window is not missed.',
    written: WRITTEN,
    audience: ['Rights owners', 'Trademark attorneys', 'Distributors and licensees', 'Brand protection teams'],
    facts: [
      { label: 'Objection deadline', value: '30 days', note: 'After publication in the Official Gazette (Art. 26(1)).' },
      { label: 'Office forwards objection', value: '15 days', note: 'Copy sent to the applicant (Art. 26(2)).' },
      { label: 'Court route', value: '60 days', note: 'Objector may sue in the commercial court if the applicant does not withdraw within 30 days (Art. 26(3)).' },
      { label: 'Suit against a registration', value: '1 year', note: 'Later objections are not heard (Art. 30).' },
    ],
    body: [
      { type: 'h2', id: 'who', text: 'Who may object' },
      { type: 'p', text: 'Article 25 gives the right of objection to a person who alleges that the published trademark is their own, and to a person whose trademark the published mark resembles so closely that users could mistake one for the other. The procedure also applies to the registration of transfers and changes (Article 27).' },
      { type: 'h2', id: 'timeline', text: 'The timeline' },
      { type: 'ol', items: [
        'Within **30 days** of publication in the Official Gazette, the objector or their representative files a written objection with the Central Registration Office (Article 26(1)).',
        'Within **15 days** of receipt, the office sends a copy to the owner of the objected mark (Article 26(2)).',
        'The applicant has **30 days** to withdraw. If they do not, the objector may file a complaint with the commercial court within **60 days**; meanwhile the registration process is recorded as delayed (Article 26(3)).',
        'If the objector does not appear or pursue the complaint, the mark is registered to the applicant and the objector cannot recover the fee (Article 26(4)).',
        'The commercial court approves or cancels the registration (Article 28); proof of continuous use by the objector leads to registration in the objector’s name (Article 29). A suit against a registered mark must be brought within **one year** (Article 30).',
      ] },
      { type: 'h2', id: 'grounds', text: 'What an objection rests on' },
      { type: 'p', text: 'The law’s grounds are ownership of the mark and confusing similarity (Article 25). Supporting arguments typically draw on the prohibited-sign list of Article 8 — in particular item 14 on identical or similar marks for identical goods — on the protection of well-known marks used in two or more countries (Articles 3 and 9), on the first-user presumption of Article 21 and on continuous use (Article 29). Evidence of use is central: publication records show what was published, not who used what first.' },
      { type: 'h2', id: 'monitoring', text: 'Monitoring: the practical side' },
      { type: 'p', text: 'Because the window runs from publication, rights owners watch new Gazette issues for marks similar to their own. On TMistan, filter by your Nice classes and the most recent publication period, search your mark and its variants in all three scripts, and run Search by Image on your logo. Where a record shows an objection deadline, it is the date printed in the publication. TMistan does not record whether an objection was filed; see [Trademark Opposition in Afghanistan: The 30-Day Window](/knowledge-center/trademark-opposition-in-afghanistan) for the full article.' },
      { type: 'example', title: 'Reading a record during the window', rows: [
        ['Publication Date', 'Start of the 30-day period under Article 26(1)'],
        ['Objection Deadline', 'The date printed with the entry'],
        ['Gazette Number — Page', 'Where to verify the entry in the source issue'],
        ['Application Type', 'New registration, or a transfer/change to which Article 27 applies'],
      ], caption: 'TMistan shows the published dates; it does not compute deadlines or track proceedings.' },
      LEGAL_NOTE,
    ],
    tools: [
      { title: 'Filter by class and period', text: 'Review the latest publications in the classes you own.', to: '/' },
      { title: 'Search by Image', text: 'Catch look-alike logos that use different wording.', to: '/?mode=image' },
      { title: 'Gazette history research', text: 'Masnad Law Firm can compile publications relevant to a dispute.', to: '/services' },
    ],
    faqs: [
      { q: 'How long do I have to oppose a trademark in Afghanistan?', a: '30 days from publication of the mark in the Official Gazette (Article 26(1)). If the applicant does not withdraw within 30 days of being notified, the objector has 60 days to file with the commercial court.' },
      { q: 'Who can file an objection?', a: 'A person who claims the published mark as their own, or whose mark is so similar that users could confuse the two (Article 25).' },
      { q: 'What does “Objection Deadline” on a TMistan record mean?', a: 'It is the deadline printed in the source publication for objections. TMistan displays it as published and does not know whether an objection was filed.' },
      { q: 'Can a registered trademark still be challenged after the window?', a: 'The law allows a lawsuit against a registered trademark within one year; later objections are not heard (Article 30). Other grounds, such as non-use cancellation after three years (Article 22), follow their own rules. Seek professional advice.' },
    ],
    articles: ['trademark-opposition-in-afghanistan', 'first-use-and-ownership-afghanistan', 'well-known-marks-afghanistan', 'how-to-read-gazette-entries'],
    guides: ['trademark-registration-afghanistan', 'afghanistan-trademark-law-and-regulations', 'trademark-search-afghanistan'],
    cta: { label: 'Review recent publications', to: '/' },
    secondary: { label: 'Read the detailed article', to: '/knowledge-center/trademark-opposition-in-afghanistan' },
    sources: ['law', 'lawWipo', 'axiom'],
  },

  /* ───────────── 6. Renewal & ownership changes ───────────── */
  {
    ...meta('trademark-renewal-and-ownership-changes'),
    lead: 'A registered trademark in Afghanistan lasts ten years, must be renewed on a strict timetable and can change hands only through a registered, published transfer. This guide brings together the rules on renewal, assignment, name and address changes, cancellation and non-use, and shows how each event appears as a notice type in TMistan.',
    written: WRITTEN,
    audience: ['Trademark owners', 'Portfolio managers', 'Buyers and licensees', 'Attorneys'],
    facts: [
      { label: 'Term', value: '10 years', note: 'Renewable on request (Art. 20(1)).' },
      { label: 'Renewal request', value: '6 months before expiry', note: 'No change to the mark or goods at renewal (Art. 20(2)–(3)).' },
      { label: 'Transfer', value: 'Valid only when registered', note: 'Art. 17; published like a registration (Art. 18).' },
      { label: 'Non-use', value: '3 consecutive years', note: 'Court may withdraw the registration on request (Art. 22(4)).' },
    ],
    body: [
      { type: 'h2', id: 'renewal', text: 'Renewal' },
      { type: 'p', text: 'A registration is valid for ten years and can be renewed at the owner’s request; the request must be submitted six months before expiry, and neither the mark nor its list of goods may be altered at renewal (Article 20). The English text of the law does not provide a grace period after expiry, and failure to request renewal in time is listed among the events that end ownership (Article 22(3)). Practitioner sources describe practice as variable; do not assume a grace period. Details and the computation of the term are discussed in [How Long Does a Trademark Last in Afghanistan?](/knowledge-center/trademark-renewal-and-validity-afghanistan).' },
      { type: 'h2', id: 'transfers', text: 'Assignments and other transfers' },
      { type: 'p', text: 'Transfer means any action by which ownership moves from one person to another — sale, donation, inheritance (Article 3). A transfer is valid only when it is registered separately at the Central Registration Office (Article 17), and registered changes must be presented for Gazette publication within 15 days, like the original registration (Article 18). Objections to the registration of a transfer follow the same procedure as objections to a mark (Article 27). A buyer who never records the assignment may be unable to rely on it.' },
      { type: 'h2', id: 'changes', text: 'Name, address and goods changes' },
      { type: 'p', text: 'Changes in the commercial specifications of goods or services must be registered separately or they are not valid; the owner may remove goods or services from the list, while other changes to the mark or its goods require a new application (Article 13). Changes of the owner’s name or address are published as separate notices, which is why TMistan contains “Change of Owner Name”, “Change of Address” and combined notices alongside assignments and mergers.' },
      { type: 'h2', id: 'ending', text: 'How ownership ends' },
      { type: 'ul', items: [
        'The owner gives up the trade, industry, agriculture or services to which the mark relates (Article 22(1)).',
        'The rights are sold or otherwise transferred (Article 22(2)).',
        'No renewal request is made in the six months before expiry (Article 22(3)).',
        'Three consecutive years of non-use are proved and, on an interested person’s request, a commercial court withdraws the registration — unless the owner shows a logical justification (Article 22(4)).',
        'An authorised court annuls the registration (Article 22(5)).',
      ] },
      { type: 'h2', id: 'records', text: 'How these events appear on TMistan' },
      { type: 'p', text: 'Each published notice is a separate record with its own serial number and an Application Type: new registration, assignment, change of owner name, change of address, name-and-address change, renewal, cancellation or merger. Change notices show the previous and new owner or address under “Recorded Changes”. To assemble a mark’s history, search the mark name (fuzzy matching on) and the names of both the previous and the new owner, then compare goods and classes — TMistan does not assert that two notices concern the same legal mark. Only new-registration records with complete data are offered to search engines; change notices remain searchable on the platform. See [Assignments, Owner Changes and Address Changes](/knowledge-center/trademark-assignment-and-ownership-changes).' },
      { type: 'check', title: 'Assessing an older mark', items: [
        'Count ten years from the publication for the earliest expiry horizon.',
        'Look for renewal, assignment, name-change and address-change notices for the same mark and owners.',
        'Treat “no renewal record” as status unknown, not as lapsed — not every change is captured.',
        'Confirm the current position with the registry or a qualified professional.',
      ] },
      LEGAL_NOTE,
    ],
    tools: [
      { title: 'Filter by notice type', text: 'Show only renewals, assignments or address changes.', to: '/' },
      { title: 'Applicant search', text: 'Follow a portfolio across old and new owner names.', to: '/' },
      { title: 'Gazette history reports', text: 'Masnad Law Firm compiles a mark’s published history on request.', to: '/services' },
    ],
    faqs: [
      { q: 'How long is a trademark registration valid in Afghanistan?', a: 'Ten years, renewable at the owner’s request; the request must be filed six months before expiry (Article 20).' },
      { q: 'Is there a grace period for late renewal?', a: 'The English text of the law does not provide one, and failure to request renewal in time is a ground on which ownership ends (Article 22(3)). Practice may vary; confirm with the registry or a professional.' },
      { q: 'Does an assignment need to be registered?', a: 'Yes. A transfer is valid only when registered separately at the Central Registration Office (Article 17), and the change is then published in the Official Gazette (Article 18).' },
      { q: 'Can a trademark be cancelled for non-use?', a: 'If non-use for three consecutive years is proved, a commercial court may withdraw the registration on an interested person’s request unless the owner justifies the non-use (Article 22(4)). This requires a request and a court decision.' },
      { q: 'Why does the same mark appear several times on TMistan?', a: 'Each Gazette publication is a separate record: the original registration, and later any assignment, renewal, name or address change. The most recent notice usually names the owner as of that publication.' },
    ],
    articles: ['trademark-renewal-and-validity-afghanistan', 'trademark-assignment-and-ownership-changes', 'first-use-and-ownership-afghanistan', 'how-to-read-gazette-entries'],
    guides: ['trademark-registration-afghanistan', 'afghanistan-trademark-law-and-regulations', 'trademark-search-afghanistan'],
    cta: { label: 'Search a mark’s history', to: '/' },
    sources: ['law', 'lawWipo', 'axiom'],
  },

  /* ───────────── 7. Classification in Afghanistan ───────────── */
  {
    ...meta('trademark-classification-afghanistan'),
    lead: 'Every trademark publication in Afghanistan states the goods or services and their class. This guide explains what the law requires, how the Nice Classification is used in Afghan practice, how classes appear — and sometimes do not appear — in the published records, and how to use the class filter on TMistan.',
    written: WRITTEN,
    audience: ['Applicants', 'Attorneys and paralegals', 'Researchers', 'Data users'],
    facts: [
      { label: 'Legal basis', value: 'Art. 18(2)(5)', note: 'Publication must state the ranking (class) of goods or services.' },
      { label: 'System used', value: 'Nice Classification', note: 'Per practitioner sources; Afghanistan is not listed as a Nice Agreement party on WIPO Lex.' },
      { label: 'Filing practice', value: 'Single-class applications', note: 'Practitioner information — confirm with a representative.' },
      { label: 'On TMistan', value: 'Class filter with counts', note: 'Classes as published; “N/A” where the source gave none.' },
    ],
    body: [
      { type: 'h2', id: 'law', text: 'What the law says' },
      { type: 'p', text: 'The Law on Trade Marks Registration does not itself set out a classification. It requires the register to record the name, description and nature of the goods, products or services (Article 12) and the Gazette publication to include the list of goods, products and services and their “ranking” (Article 18(2)). The conflict rule of Article 8(14) is framed around identical goods or services, so classification is the practical tool for deciding which earlier marks are relevant — but the legal comparison is between the goods, not between class numbers.' },
      { type: 'h2', id: 'nice-in-practice', text: 'The Nice Classification in Afghan practice' },
      { type: 'p', text: 'Practitioner summaries report that the Afghan office applies the Nice Classification — WIPO’s international classification of 34 classes of goods and 11 classes of services — and that applications are filed per class. WIPO Lex does not list Afghanistan among the parties to the Nice Agreement itself, so the classification is used as a tool rather than under treaty obligation. The classification is explained from the ground up in [Nice Classification Explained](/guides/nice-classification-explained).' },
      { type: 'h2', id: 'in-records', text: 'How classes appear in published records' },
      { type: 'ul', items: [
        'Most entries carry a class number together with a goods description; TMistan stores both and shows the class as published.',
        'Some older or unusual entries give only a textual description. TMistan then shows the description and “N/A” for the class number — it never infers a class.',
        'A single mark may be published separately for several classes, each publication with its own serial number.',
        'Change notices (assignment, address change) repeat the class of the underlying mark as printed in the notice.',
      ] },
      { type: 'h2', id: 'tmistan', text: 'Using classes on TMistan' },
      { type: 'p', text: 'The class picker in Advanced Search lists the classes present in the database with the number of published records in each — a quick view of where activity concentrates. Combine a class with a keyword to focus on real competitors; search the goods text when a class is broad (classes 9 and 35, for example) and you care about a specific product; and look at neighbouring classes when the goods are related. Record pages show the class next to the goods text, and only records with at least one class and a goods description are offered to search engines.' },
      { type: 'example', title: 'Class on a record page', rows: [
        ['Class', '30'],
        ['Goods & Services', 'Tea, coffee, rice, confectionery — as published'],
        ['Why both matter', 'Article 8(14) compares goods; the class is the index'],
      ], caption: 'Compare goods text, not just class numbers, when publications are decades apart — the classification is revised regularly.' },
      LEGAL_NOTE,
    ],
    tools: [
      { title: 'Class picker with counts', text: 'Published records per Nice class, updated with the database.', to: '/' },
      { title: 'Goods-and-services text search', text: 'Find specific products inside broad classes.', to: '/' },
      { title: 'Class article', text: 'Understanding Trademark Classes — the basics with examples.', to: '/knowledge-center/understanding-trademark-classes' },
    ],
    faqs: [
      { q: 'Does Afghanistan use the Nice Classification?', a: 'Practitioner sources report that the office applies the Nice Classification and that applications are filed per class. Afghanistan is not listed as a party to the Nice Agreement on WIPO Lex; the law itself requires only that the goods and their “ranking” be published (Article 18).' },
      { q: 'Can one application cover several classes?', a: 'Practitioner sources describe single-class filings in Afghanistan, which is consistent with marks being published separately per class in the Gazette. Confirm current practice with a representative.' },
      { q: 'Why does a TMistan record show class N/A?', a: 'The source publication gave a goods description without a class number. TMistan shows what was published and does not assign a class itself.' },
      { q: 'Is a mark in another class always safe?', a: 'Not necessarily. The legal comparison is between goods and services; related goods, well-known marks and the overall impression can matter. Use the class as an index, not as the test.' },
    ],
    articles: ['understanding-trademark-classes', 'nice-classes-for-common-goods-and-services', 'how-to-read-gazette-entries', 'how-to-search-trademark-records'],
    guides: ['nice-classification-explained', 'trademark-search-afghanistan', 'trademark-clearance-research'],
    cta: { label: 'Open the class picker', to: '/' },
    secondary: { label: 'Nice Classification explained', to: '/guides/nice-classification-explained' },
    sources: ['law', 'nice', 'wipolex', 'axiom'],
  },

  /* ───────────── 8. Nice Classification explained ───────────── */
  {
    ...meta('nice-classification-explained'),
    lead: 'The Nice Classification is the international system that sorts every product and service into one of 45 classes for trademark purposes. This guide explains where it comes from, how the classes are organised, how to choose the right ones for a business, and why the same word can be registered by different owners in different classes.',
    written: WRITTEN,
    audience: ['Applicants', 'Marketing and product teams', 'Students', 'Researchers'],
    facts: [
      { label: 'Classes', value: '45', note: '34 for goods (1–34), 11 for services (35–45).' },
      { label: 'Administered by', value: 'WIPO', note: 'Established by the Nice Agreement (1957); revised regularly.' },
      { label: 'Purpose', value: 'Indexing goods and services', note: 'An administrative tool — not the legal test of similarity.' },
      { label: 'In Afghanistan', value: 'Used in practice', note: 'Per practitioner sources; see the classification guide.' },
    ],
    body: [
      { type: 'h2', id: 'what', text: 'What it is' },
      { type: 'p', text: 'The Nice Classification, established by the Nice Agreement of 1957 and administered by the World Intellectual Property Organization, is the classification of goods and services applied for the registration of marks in most of the world. It consists of a list of classes with explanatory notes and an alphabetical list of goods and services indicating the class of each. WIPO publishes a new edition or version regularly, so the scope of a class can shift over time.' },
      { type: 'h2', id: 'structure', text: 'How the classes are organised' },
      { type: 'p', text: 'Goods are grouped mainly by material, function or purpose and services by field of activity. Classes 1–34 are goods — from chemicals (class 1) and pharmaceuticals (class 5) through clothing (class 25) and foodstuffs (classes 29–31) to tobacco (class 34). Classes 35–45 are services — advertising and retail (35), finance (36), construction (37), telecommunications (38), transport (39), education and entertainment (41), scientific and technological services including software design (42), food and lodging (43), medical and beauty services (44) and legal and security services (45).' },
      { type: 'example', title: 'One business, several classes', rows: [
        ['A tea brand', 'Class 30 (tea) · Class 35 (retail of tea) · Class 43 (tea house)'],
        ['A clothing label', 'Class 25 (clothing) · Class 18 (bags) · Class 35 (retail)'],
        ['A software company', 'Class 9 (downloadable software) · Class 42 (software as a service, design)'],
        ['A pharmacy chain', 'Class 5 (pharmaceuticals) · Class 35 (retail) · Class 44 (pharmacy advice)'],
      ], caption: 'Indicative examples. The authoritative scope of each class is the current edition published by WIPO.' },
      { type: 'h2', id: 'choosing', text: 'Choosing classes' },
      { type: 'ol', items: [
        'List what you actually sell or will sell under the mark within a realistic horizon — not every conceivable product.',
        'Find the class of each item in WIPO’s alphabetical list or class headings; note that the class of a product can depend on its material or purpose.',
        'Add the services that accompany the goods (retail, repair, training) where they are offered under the same mark.',
        'Check the published records in those classes on TMistan to see how crowded they are and whether conflicts exist — see [Choosing Nice Classes](/knowledge-center/nice-classes-for-common-goods-and-services) for examples of common goods.',
      ] },
      { type: 'h2', id: 'why-it-matters', text: 'Why it matters — and what it does not decide' },
      { type: 'p', text: 'Trademark rights are tied to goods and services. The classification is how offices and databases index them: it determines how an application is filed and fees are counted, and it lets a search focus on the marks that matter. It is not, however, the legal test of conflict. In Afghanistan the law compares marks for identical goods or services (Article 8(14)); goods in different classes can still be related, and goods in the same class can be unrelated. Use the class to find candidates and the goods text to judge them.' },
      { type: 'h2', id: 'editions', text: 'Editions and older records' },
      { type: 'p', text: 'Because WIPO revises the classification, a record published years ago reflects the edition of its time. When comparing publications from different periods, read the goods text rather than trusting that the same class number means the same scope.' },
    ],
    tools: [
      { title: 'Class filter', text: 'Browse published records by class with per-class counts.', to: '/' },
      { title: 'Goods text search', text: 'Search the actual products within a class.', to: '/' },
      { title: 'Classification in Afghanistan', text: 'How classes appear in Afghan publications.', to: '/guides/trademark-classification-afghanistan' },
    ],
    faqs: [
      { q: 'How many classes are there in the Nice Classification?', a: '45: classes 1–34 for goods and 35–45 for services.' },
      { q: 'Who maintains the Nice Classification?', a: 'The World Intellectual Property Organization (WIPO), under the Nice Agreement of 1957. New editions and versions are published regularly.' },
      { q: 'Can two companies own the same word as a trademark?', a: 'Often yes, for unrelated goods or services — trademark rights are tied to goods and services. Well-known marks and related goods are the main exceptions; the assessment is legal, not merely numerical.' },
      { q: 'Which class is software in?', a: 'Downloadable software is typically class 9; software provided as a service and software design are typically class 42. Always confirm against the current edition.' },
    ],
    articles: ['nice-classes-for-common-goods-and-services', 'understanding-trademark-classes', 'what-is-a-trademark'],
    guides: ['trademark-classification-afghanistan', 'trademark-availability-search', 'trademark-registration-afghanistan'],
    cta: { label: 'Browse records by class', to: '/' },
    sources: ['nice', 'law', 'axiom'],
  },

  /* ───────────── 9. Foreign businesses — protection ───────────── */
  {
    ...meta('trademark-protection-foreign-businesses'),
    lead: 'Foreign brands have long appeared in Afghanistan’s published trademark records, and the law treats domestic and foreign owners alike once their marks are registered. This guide explains the routes to protection — national filing, priority claims and the Madrid Protocol — the special rules on well-known marks and agents, and what enforcement looks like under the statute.',
    written: WRITTEN,
    audience: ['Foreign companies', 'Exporters and franchisors', 'Trademark attorneys', 'Licensing teams'],
    facts: [
      { label: 'Equal treatment', value: 'Art. 7', note: 'Domestic and foreign organisations benefit once registered.' },
      { label: 'Priority', value: '6 months', note: 'From a first filing in a reciprocating state (Art. 10); Paris Convention since 14 May 2017.' },
      { label: 'Madrid Protocol', value: 'In force 26 June 2018', note: 'Afghanistan (AF) can be designated in international applications.' },
      { label: 'Well-known marks', value: 'Protected without registration', note: 'Defined as marks used in two or more countries (Arts. 3, 9).' },
    ],
    body: [
      { type: 'h2', id: 'routes', text: 'Three routes to protection' },
      { type: 'h3', text: '1. National filing through a representative' },
      { type: 'p', text: 'Applications may be filed personally or through a legal representative (Article 10), and the law’s benefits extend to foreign organisations once their marks are registered (Article 7). The statutory path — examination within 30 days, publication, a 30-day objection window, a ten-year renewable term — is summarised in [Trademark Registration in Afghanistan](/guides/trademark-registration-afghanistan).' },
      { type: 'h3', text: '2. National filing with a priority claim' },
      { type: 'p', text: 'An applicant who first filed in a state that treats Afghanistan reciprocally may, within six months, file a similar application in Afghanistan and have priority determined by the foreign filing date (Article 10). Afghanistan acceded to the Paris Convention with effect from 14 May 2017, which adds the Convention’s six-month trademark priority and national-treatment rules.' },
      { type: 'h3', text: '3. An international registration designating Afghanistan' },
      { type: 'p', text: 'The Madrid Protocol entered into force for Afghanistan on 26 June 2018. A company with a home application or registration can designate Afghanistan in an international application filed through its home office; the designation is examined under Afghan law and, once protected, has the effect of a national registration. International registrations are searched in WIPO’s Madrid Monitor — they are not part of TMistan’s national Gazette records. See [Afghanistan and the Madrid System](/knowledge-center/madrid-protocol-afghanistan).' },
      { type: 'h2', id: 'special-rules', text: 'Rules that matter to foreign owners' },
      { type: 'ul', items: [
        '**Well-known marks.** A mark used in two or more countries is a well-known mark (Article 3); its owner enjoys the law’s rights without local registration and the office must reject similar applications from anyone but the owner or the owner’s representative (Article 9).',
        '**Agents and representatives.** A representative or advocate cannot register the owner’s mark in their own name without permission (Article 15) — the classic distributor problem.',
        '**First use.** Ownership is presumed in the first user unless the contrary is proved in court (Article 21); continuous use proved by an objector leads to registration in the objector’s name (Article 29).',
        '**Non-use.** Three consecutive years of unjustified non-use expose a registration to withdrawal by a commercial court on request (Article 22(4)).',
      ] },
      { type: 'h2', id: 'enforcement', text: 'Enforcement under the statute' },
      { type: 'p', text: 'Chapter Four treats counterfeiting a registered mark, deliberate use of an imitated mark, affixing another’s mark to goods and dealing in goods bearing a fake mark as violations giving rise to compensation, with doubled damages or six to twelve months’ imprisonment for repeat violations (Article 31). A harmed owner may demand that the use stop and claim compensation (Article 32), and a court may order confiscation of goods, proceeds and tools and closure of premises (Article 33). See [Trademark Infringement in Afghanistan](/knowledge-center/trademark-infringement-and-penalties-afghanistan).' },
      { type: 'h2', id: 'before-you-file', text: 'Before you file' },
      { type: 'p', text: 'Search the published records for your mark in Latin, Dari and Pashto script, search your company name as applicant to find earlier publications in your own name — including those filed by former distributors — and run Search by Image on your logo. Then check WIPO’s international register and have a local professional verify the records against the register. The research workflow is set out in [Trademark Research for International Companies](/guides/trademark-research-international-companies).' },
      LEGAL_NOTE,
    ],
    tools: [
      { title: 'Search your brand in three scripts', text: 'Latin, Dari and Pashto spellings with fuzzy matching.', to: '/' },
      { title: 'Applicant search', text: 'Find publications in your own name or a distributor’s.', to: '/' },
      { title: 'Research services', text: 'Availability, similar-mark and Gazette-history reports by Masnad Law Firm.', to: '/services' },
    ],
    faqs: [
      { q: 'Can a foreign company own a trademark in Afghanistan?', a: 'Yes. The law’s benefits extend to foreign organisations once their marks are registered (Article 7); applications may be filed through a legal representative (Article 10).' },
      { q: 'Can I extend my international registration to Afghanistan?', a: 'Yes, since 26 June 2018 Afghanistan can be designated under the Madrid Protocol. The designation is examined under Afghan law.' },
      { q: 'Is my well-known brand protected without registering in Afghanistan?', a: 'The law protects well-known marks — defined as marks used in two or more countries — without local registration and obliges the office to refuse similar applications (Articles 3 and 9). Enforcement of that protection is a matter for professional advice.' },
      { q: 'My distributor registered my mark in its own name. What does the law say?', a: 'A representative or advocate cannot register the owner’s mark without permission (Article 15), and well-known-mark and first-use rules may apply. The objection and court procedures of Articles 25–30 are the statutory tools; consult a qualified professional promptly because of the deadlines.' },
    ],
    articles: ['trademark-search-for-foreign-companies-afghanistan', 'madrid-protocol-afghanistan', 'afghanistan-ip-treaties', 'well-known-marks-afghanistan'],
    guides: ['trademark-research-international-companies', 'trademark-registration-afghanistan', 'trademark-opposition-afghanistan'],
    cta: { label: 'Search your brand', to: '/' },
    secondary: { label: 'Research services', to: '/services' },
    sources: ['law', 'wipolex', 'madrid', 'madridMonitor'],
  },

  /* ───────────── 10. International companies — research ───────────── */
  {
    ...meta('trademark-research-international-companies'),
    lead: 'International companies rarely need a single search; they need a repeatable way to know what has been published in Afghanistan about their brands, their competitors and their former partners. This guide sets out that workflow — audit, conflict check, monitoring and documentation — using TMistan together with WIPO’s international register.',
    written: WRITTEN,
    audience: ['In-house counsel', 'Brand protection managers', 'Law firms', 'Licensing and franchise teams'],
    facts: [
      { label: 'National records', value: 'TMistan', note: 'Gazette publications: marks, owners, classes, changes.' },
      { label: 'International records', value: 'WIPO Madrid Monitor', note: 'Designations of AF since 26 June 2018.' },
      { label: 'Objection window', value: '30 days from publication', note: 'Monitoring cadence should respect Art. 26.' },
      { label: 'Report basis', value: 'Gazette number and page', note: 'Every record carries its verifiable source line.' },
    ],
    body: [
      { type: 'h2', id: 'audit', text: '1. Portfolio audit' },
      { type: 'p', text: 'Search each of your marks and each company name (current and former) as applicant. Capture every publication: registrations, renewals, assignments, name and address changes. Compare the result with your internal records — publications you did not expect often trace back to local partners, and publications you expected but cannot find may simply fall in Gazette issues not yet processed (coverage is described on the [Data Sources](/data-sources) page). Download the record report for each item; it carries the Gazette number and page for verification.' },
      { type: 'h2', id: 'conflicts', text: '2. Conflict and look-alike check' },
      { type: 'p', text: 'For your key marks, run the clearance dimensions described in [Trademark Clearance Research](/guides/trademark-clearance-research): exact and fuzzy word searches, Dari and Pashto transliterations, dominant elements alone, Search by Image on the logo, with and without class filters. Pay particular attention to applicants in your distribution chain — the law bars a representative from registering the owner’s mark without permission (Article 15) and protects well-known marks used in two or more countries without local registration (Articles 3 and 9) — and to publications still within the 30-day objection window of Article 26.' },
      { type: 'h2', id: 'monitoring', text: '3. Monitoring' },
      { type: 'p', text: 'Because objections run from publication, set a cadence that fits the 30-day window: review the latest publications in your classes, search your marks and variants, and run image searches for your logos. Note the publication date and any printed objection deadline for each hit and route it to counsel immediately. TMistan shows published dates but does not track proceedings; the article on [monitoring new publications](/knowledge-center/monitoring-new-trademark-publications-afghanistan) describes a practical routine.' },
      { type: 'h2', id: 'international', text: '4. The international layer' },
      { type: 'p', text: 'Since 26 June 2018 marks can reach Afghanistan through Madrid designations held at WIPO. Audit your own designations of AF and search Madrid Monitor and the Global Brand Database for third-party designations resembling your marks. Keep the national and international findings in one file; neither source alone is complete.' },
      { type: 'h2', id: 'documentation', text: '5. Documentation' },
      { type: 'p', text: 'Record the date and scope of each search, the scripts and variants used, the classes covered and the known limits — coverage, publication versus status, unpublished rights. Attach the record reports. A dated, explicit file is what makes later decisions (to oppose, to file, to license) defensible.' },
      { type: 'h2', id: 'help', text: 'When to commission research' },
      { type: 'p', text: 'Masnad Law Firm, which develops TMistan, prepares tailored reports — availability and similar-mark research, Gazette history of a mark or portfolio, record verification against the source issue — through the [Services](/services) page. The platform itself remains free to search.' },
      LEGAL_NOTE,
    ],
    tools: [
      { title: 'Applicant and mark search', text: 'Audit a portfolio across owner names and scripts.', to: '/' },
      { title: 'Class, type and period filters', text: 'Monitor the newest publications in your classes.', to: '/' },
      { title: 'Search by Image', text: 'Detect look-alike logos regardless of wording.', to: '/?mode=image' },
      { title: 'Commissioned reports', text: 'Portfolio, history and verification reports by Masnad Law Firm.', to: '/services' },
    ],
    faqs: [
      { q: 'How can an international company check what has been published about its brand in Afghanistan?', a: 'Search each mark and each current and former company name as applicant on TMistan, capture every notice type, download the record reports and compare with internal records. Then check WIPO’s Madrid Monitor for international designations of AF.' },
      { q: 'How often should we monitor Afghan trademark publications?', a: 'Often enough to act within the 30-day objection window that runs from Gazette publication (Article 26). Review the latest publications in your classes and search your marks and logos on that cadence.' },
      { q: 'Can TMistan tell us the legal status of our Afghan registrations?', a: 'No. TMistan documents Gazette publications. Status must be confirmed with the national registry, usually through a local representative.' },
      { q: 'Does TMistan offer research services?', a: 'Masnad Law Firm, which develops TMistan, offers tailored research reports through the Services page. Searching the platform is free.' },
    ],
    articles: ['trademark-search-for-foreign-companies-afghanistan', 'monitoring-new-trademark-publications-afghanistan', 'madrid-protocol-afghanistan', 'trademark-assignment-and-ownership-changes'],
    guides: ['trademark-protection-foreign-businesses', 'trademark-clearance-research', 'trademark-opposition-afghanistan'],
    cta: { label: 'Audit your marks', to: '/' },
    secondary: { label: 'Commission a report', to: '/services' },
    sources: ['law', 'wipolex', 'madridMonitor', 'gbd'],
  },

  /* ───────────── 11. Law & regulations ───────────── */
  {
    ...meta('afghanistan-trademark-law-and-regulations'),
    lead: 'Afghanistan’s trademark system rests on the Law on Trade Marks Registration of 2009, the regulations issued under it and a set of WIPO-administered treaties joined between 2005 and 2021. This guide maps the framework — what each chapter covers, which articles researchers meet most often and where the authoritative texts are — and links to detailed articles on each topic.',
    written: WRITTEN,
    audience: ['Lawyers and law students', 'IP professionals', 'Policy researchers', 'Business owners'],
    facts: [
      { label: 'Principal statute', value: 'Law on Trade Marks Registration', note: 'Official Gazette (Extraordinary Issue) No. 995, 1 September 2009; Decree No. 111 of 27 August 2009.' },
      { label: 'Structure', value: '5 chapters · 36 articles', note: 'General provisions; ownership and registration; objections; penalties; fees and final provisions.' },
      { label: 'Treaties', value: 'Paris 2017 · Madrid 2018', note: 'Plus WIPO Convention 2005, Singapore Treaty 2017, Berne 2018, Marrakesh 2018, WCT/WPPT 2021.' },
      { label: 'Amendments', value: '2015 · rules 2018', note: 'Reported by practitioners; texts not verified by TMistan.' },
    ],
    body: [
      { type: 'h2', id: 'statute', text: 'The statute' },
      { type: 'p', text: 'The Law on Trade Marks Registration was approved by the Lower House on 11 May 2009 and the Upper House on 31 May 2009, promulgated by Presidential Decree No. 111 of 27 August 2009 and published in Official Gazette (Extraordinary Issue) No. 995 of 1 September 2009. WIPO Lex records it under 2008, the year of its adoption in draft. An official English translation was deposited during Afghanistan’s WTO accession and is the text summarised on TMistan; the Dari and Pashto texts are authoritative.' },
      { type: 'h2', id: 'chapters', text: 'Chapter by chapter' },
      { type: 'ol', items: [
        '**General provisions (Articles 1–8)** — purpose, definitions (trademark; well-known mark as a mark used in two or more countries; transfer; use), the forms a mark may take, who may apply, and the fifteen categories of signs that may not be used or registered. Detail: [What Can and Cannot Be Registered](/knowledge-center/what-can-be-registered-as-a-trademark-in-afghanistan).',
        '**Ownership and registration (Articles 9–24)** — well-known marks, filing and six-month priority, examination within 30 days, the content of the register, changes, agents, transfers, Gazette publication within 15 days, protection from filing, the ten-year term, first-user ownership, termination of ownership, geographical names. Detail: [How Trademark Registration Works](/knowledge-center/trademark-registration-process-afghanistan).',
        '**Objections (Articles 25–30)** — standing, the 30-day window after publication, the office and court steps, the court’s decision, continuous use, the one-year limit. Detail: [Trademark Opposition in Afghanistan](/knowledge-center/trademark-opposition-in-afghanistan).',
        '**Penalties (Articles 31–33)** — violations, compensation, doubled damages or imprisonment for repeat violations, confiscation and closure. Detail: [Trademark Infringement and Penalties](/knowledge-center/trademark-infringement-and-penalties-afghanistan).',
        '**Fees and final provisions (Articles 34–36)** — fees set by the Council of Ministers, regulations, entry into force.',
      ] },
      { type: 'h2', id: 'key-articles', text: 'Articles researchers meet most often' },
      { type: 'example', title: 'Quick reference', rows: [
        ['Art. 3', 'Definitions — trademark; well-known mark; transfer; use'],
        ['Art. 8', 'Signs that may not be used or registered (15 categories)'],
        ['Art. 9', 'Well-known marks protected without registration'],
        ['Art. 10', 'Filing; six-month priority from a reciprocating state'],
        ['Art. 11', 'Examination and decision within 30 days'],
        ['Art. 17', 'Transfer valid only when registered'],
        ['Art. 18', 'Gazette publication within 15 days; required contents'],
        ['Art. 19–20', 'Protection from filing; ten-year term; renewal six months before expiry'],
        ['Art. 21–22', 'First-user presumption; how ownership ends (incl. three years’ non-use)'],
        ['Art. 25–26', 'Objection within 30 days of publication'],
        ['Art. 30', 'One-year limit for suits against a registration'],
        ['Art. 31–33', 'Violations, compensation, confiscation, closure'],
      ], caption: 'Article numbers follow the official English translation reproduced in WTO document WT/ACC/AFG/5/Add.1.' },
      { type: 'h2', id: 'regulations', text: 'Regulations and amendments' },
      { type: 'p', text: 'Article 35 authorises regulations under the law and Article 34 leaves fee amounts to the Council of Ministers. Practitioner sources report an amendment of the law in March 2015 and intellectual-property registration rules of October 2018. TMistan has not verified those texts and does not summarise them; treat any point that may have changed since 2009 as something to confirm with the registry or a professional. The full overview is in [Afghanistan’s Law on Trade Marks Registration: An Overview](/knowledge-center/afghanistan-trademark-law-overview).' },
      { type: 'h2', id: 'treaties', text: 'International framework' },
      { type: 'p', text: 'According to WIPO Lex, Afghanistan is party to the WIPO Convention (in force 13 December 2005), the Paris Convention and the Singapore Treaty on the Law of Trademarks (both 14 May 2017), the Berne Convention (2 June 2018), the Madrid Protocol (26 June 2018), the Marrakesh Treaty (26 October 2018) and the WIPO Copyright and Performances and Phonograms Treaties (9 February 2021). It is not listed as a party to the Nice Agreement, although the Nice Classification is used in practice. See [Afghanistan’s Membership of International IP Treaties](/knowledge-center/afghanistan-ip-treaties).' },
      { type: 'h2', id: 'texts', text: 'Where to read the texts' },
      { type: 'ul', items: [
        'Official English translation of the Law on Trade Marks Registration — WTO accession document WT/ACC/AFG/5/Add.1 (PDF, linked below).',
        'WIPO Lex — legislation record for the Trademark Registration Law and the Afghanistan member profile with treaty dates.',
        'Official Gazette issues — the primary source of the records on TMistan; the Data Sources page explains how they are processed.',
      ] },
      LEGAL_NOTE,
    ],
    tools: [
      { title: 'Knowledge Center — law series', text: 'Fifteen sourced articles on the law and procedure.', to: '/knowledge-center?all=1&topic=law' },
      { title: 'Glossary', text: 'Statutory and record terms defined in one place.', to: '/knowledge-center/glossary-of-afghanistan-trademark-terms' },
      { title: 'Legal information about TMistan', text: 'Terms, privacy, disclaimer and IP notice for the platform.', to: '/legal' },
    ],
    faqs: [
      { q: 'What is the main trademark law in Afghanistan?', a: 'The Law on Trade Marks Registration, published in Official Gazette (Extraordinary Issue) No. 995 on 1 September 2009 — five chapters and thirty-six articles.' },
      { q: 'Is the law available in English?', a: 'An official English translation was deposited during Afghanistan’s WTO accession (document WT/ACC/AFG/5/Add.1). The Dari and Pashto texts are authoritative.' },
      { q: 'Has the law been amended?', a: 'Practitioner sources report an amendment in March 2015 and registration rules issued in October 2018. TMistan has not verified the amended texts and summarises only the 2009 translation.' },
      { q: 'Which international treaties apply to trademarks in Afghanistan?', a: 'The Paris Convention and the Singapore Treaty (in force 14 May 2017) and the Madrid Protocol (in force 26 June 2018), according to WIPO Lex; Afghanistan has been a WIPO member since 2005.' },
    ],
    articles: ['afghanistan-trademark-law-overview', 'trademark-registration-process-afghanistan', 'afghanistan-ip-treaties', 'glossary-of-afghanistan-trademark-terms'],
    guides: ['trademark-registration-afghanistan', 'trademark-opposition-afghanistan', 'trademark-renewal-and-ownership-changes'],
    cta: { label: 'Read the law series', to: '/knowledge-center?all=1&topic=law' },
    secondary: { label: 'Search the records', to: '/' },
    sources: ['law', 'lawWipo', 'wipolex', 'axiom'],
  },
]

export const GUIDE_BY_SLUG: Record<string, Guide> = Object.fromEntries(GUIDES.map((g) => [g.slug, g]))

/** Guide most relevant to a Knowledge Center category (shown on article pages as "Start with the guide"). */
/** Per-article override of the "Start with the guide" aside (falls back to GUIDE_FOR_CATEGORY). */
export const GUIDE_FOR_ARTICLE: Record<string, string> = {
  'how-to-read-gazette-entries': 'trademark-search-afghanistan',
  'how-to-read-a-tmistan-record-page': 'trademark-search-afghanistan',
  'trademark-assignment-and-ownership-changes': 'trademark-renewal-and-ownership-changes',
  'monitoring-new-trademark-publications-afghanistan': 'trademark-opposition-afghanistan',
  'trademark-opposition-in-afghanistan': 'trademark-opposition-afghanistan',
  'trademark-renewal-and-validity-afghanistan': 'trademark-renewal-and-ownership-changes',
  'madrid-protocol-afghanistan': 'trademark-protection-foreign-businesses',
  'afghanistan-ip-treaties': 'trademark-protection-foreign-businesses',
  'trademark-search-for-foreign-companies-afghanistan': 'trademark-research-international-companies',
  'well-known-marks-afghanistan': 'trademark-protection-foreign-businesses',
  'how-to-check-if-a-trademark-is-taken-in-afghanistan': 'trademark-availability-search',
  'preliminary-trademark-search': 'trademark-availability-search',
  'nice-classes-for-common-goods-and-services': 'nice-classification-explained',
  'trademark-registration-process-afghanistan': 'trademark-registration-afghanistan',
  'what-can-be-registered-as-a-trademark-in-afghanistan': 'trademark-registration-afghanistan',
}

export const GUIDE_FOR_CATEGORY: Record<string, string> = {
  fundamentals: 'trademark-registration-afghanistan',
  searching: 'trademark-search-afghanistan',
  gazette: 'trademark-renewal-and-ownership-changes',
  classes: 'trademark-classification-afghanistan',
  law: 'afghanistan-trademark-law-and-regulations',
  limits: 'trademark-clearance-research',
}
