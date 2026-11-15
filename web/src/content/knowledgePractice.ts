/* ---------------------------------------------------------------------------
 * Knowledge Center — third release (2026-11-16): practical research articles
 * that accompany the Guides. Same editorial rules as knowledge.ts and
 * knowledgeLaw.ts (official sources by article number, practice labelled,
 * no status/fee/coverage claims). Bodies use inline links `[label](/path)`.
 * ------------------------------------------------------------------------- */
import type { Article, ArticleBlock } from './knowledge'
import { SRC } from './knowledgeLaw'

const WRITTEN = '2026-11-16'
const sources = (...keys: (keyof typeof SRC)[]): ArticleBlock => ({ type: 'sources', items: keys.map((k) => SRC[k]) })

export const PRACTICE_ARTICLES: Article[] = [
  /* ───────────── A. Reading a record page ───────────── */
  {
    slug: 'how-to-read-a-tmistan-record-page',
    category: 'gazette',
    title: 'How to Read a TMistan Record Page, Field by Field',
    seoTitle: 'How to Read a TMistan Trademark Record Page',
    summary: 'Every field on a record page explained — mark, serial number, applicant, class, goods, application type, dates, source line and recorded changes — with the rule of law behind each one and what it cannot tell you.',
    metaDescription: 'Every field of a TMistan trademark record explained: serial number, applicant, class, goods, notice type, publication date, objection deadline and source.',
    written: WRITTEN,
    thumbnail: '/img/kc/how-to-read-a-tmistan-record-page.jpg',
    featured: false,
    keywords: ['record page', 'fields', 'serial number', 'applicant', 'class', 'publication date', 'objection deadline', 'gazette number', 'recorded changes', 'download record'],
    body: [
      { type: 'p', text: 'A record page shows one publication from the Official Gazette of Afghanistan, structured into fields. This article walks through the page from top to bottom and names the legal rule behind each field, so that you know what the value means — and, just as important, what it does not mean. For the bigger picture of how Gazette entries are organised, see [How to Read Gazette Entries](/knowledge-center/how-to-read-gazette-entries).' },
      { type: 'figure', src: '/img/kc/fig-record-page.jpg', alt: 'A trademark record page in TMistan with its fields and source line', caption: 'A record page: fields on the left, the trademark image and source information alongside.' },
      { type: 'h2', id: 'header', text: 'The header' },
      { type: 'ul', items: [
        '**Mark** — the trademark as published. Where the normalised name differs from the exact wording in the source, “Mark as printed” shows the printed form. Article 4 of the law allows names, words, letters, figures, drawings, seals, pictures and combinations, which is why some marks are a word, some a device and most both.',
        '**Trademark image** — shown when an image accompanied the publication and was matched to the record. A record without an image is usually a word mark or an entry whose image is not among the available source materials.',
        '**TMistan Serial Number** — TMistan’s identifier for this publication, in the form Gazette-number–sequence (for example 1011-002). It identifies the publication, not the mark; the same mark published again later has a different serial.',
      ] },
      { type: 'h2', id: 'facts', text: 'The facts' },
      { type: 'h3', id: 'facts-owner', text: 'Who owns it' },
      { type: 'ul', items: [
        '**Applicant** and **Address** — the owner named in the publication, as Article 18 requires the name, nationality and address of the owner (and the representative, if any) to be published. The address is as printed at the time; later changes are separate notices.',
      ] },
      { type: 'h3', id: 'facts-scope', text: 'What it covers' },
      { type: 'ul', items: [
        '**Class** — the Nice class of the goods or services as published (the “ranking” of Article 18(2)). “N/A” means the source gave a description without a class number; TMistan never infers one. See [Trademark Classification in Afghanistan](/guides/trademark-classification-afghanistan).',
        '**Goods & Services** — the list the mark was published for, as printed. The legal comparison between marks is made on goods and services (Article 8(14)), so this text matters more than the class number.',
      ] },
      { type: 'h3', id: 'facts-notice', text: 'Which notice, and when' },
      { type: 'ul', items: [
        '**Application Type** — the kind of notice: new registration, assignment, change of owner name, change of address, renewal, cancellation or merger. Each is published separately under Article 18; see [Assignments, Owner Changes and Address Changes](/knowledge-center/trademark-assignment-and-ownership-changes).',
        '**Publication Date** — the date of the Gazette issue. Protection itself runs from the filing date (Article 19), which is not always printed; the publication date is the date the record can prove.',
        '**Objection Deadline** — shown when the publication printed one. It is the end of the 30-day window of Article 26 as stated in the source; TMistan does not compute deadlines or know whether an objection was filed. See [Trademark Opposition in Afghanistan](/guides/trademark-opposition-afghanistan).',
      ] },
      { type: 'h2', id: 'source', text: 'The source line' },
      { type: 'p', text: '“Gazette Number — Page” tells you exactly where the entry can be verified: the Official Gazette issue and the page on which it appears. Every value on the page is taken from that place. If you need to rely on a record, go back to the issue; the [Data Sources & Methodology](/data-sources) page explains how issues are processed and what the known limits are.' },
      { type: 'h2', id: 'changes', text: 'Recorded changes' },
      { type: 'p', text: 'On change notices the page shows the previous and new owner or address exactly as published. TMistan does not assert that a change notice and an earlier registration are the same legal mark — to follow a mark’s history, search the mark name and both owner names and compare the goods and class.' },
      { type: 'h2', id: 'actions', text: 'Actions on the page' },
      { type: 'ul', items: [
        '**Download Record** — a printable PDF report of the fields shown, with the source line and a disclaimer; useful for a clearance file.',
        '**Similar records** — text similarity on the mark name, offered as research candidates only.',
        '**Report an issue** — if a value looks wrong, use [Data Corrections](/data-corrections); every request is checked against the source issue.',
      ] },
      { type: 'note', title: 'What the page never shows', text: 'The attorney or agent of record, internal notes, and anything not printed in the Gazette. TMistan also never displays an inferred legal status: “published” is a fact, “registered and in force today” is a conclusion the record cannot support on its own.' },
      sources('law', 'lawWipo'),
    ],
    meaning: [
      'Each field has a statutory origin (Articles 4, 12, 18, 19, 26): knowing it tells you how much weight the value carries.',
      'The serial number identifies a publication; the same mark may have several.',
      'The source line is your route to verification — cite the Gazette number and page, not only the TMistan page.',
    ],
    related: ['how-to-read-gazette-entries', 'glossary-of-afghanistan-trademark-terms', 'trademark-assignment-and-ownership-changes'],
    next: { label: 'Open a record from a search', to: '/' },
  },

  /* ───────────── B. Monitoring ───────────── */
  {
    slug: 'monitoring-new-trademark-publications-afghanistan',
    category: 'searching',
    label: 'bestPractices',
    title: 'Monitoring New Trademark Publications in Afghanistan',
    seoTitle: 'Monitoring New Trademark Publications in Afghanistan',
    summary: 'A practical routine for rights owners and their counsel: how often to check, which searches to run, how to use the class, type and period filters, and what to do when a look-alike appears during the 30-day objection window.',
    metaDescription: 'How to monitor new Official Gazette trademark publications in Afghanistan: cadence for the 30-day objection window, what to search, triage and documentation.',
    written: WRITTEN,
    thumbnail: '/img/kc/monitoring-new-trademark-publications-afghanistan.jpg',
    featured: false,
    keywords: ['trademark watch', 'monitoring', 'new publications', 'objection window', '30 days', 'class filter', 'image search', 'brand protection'],
    body: [
      { type: 'p', text: 'Trademark rights are easiest to defend early. Afghan law gives an interested party 30 days from Gazette publication to object (Article 26), and one year to sue against a registration (Article 30). A monitoring routine turns those deadlines into a calendar instead of a surprise. This article describes a routine that can be run on TMistan in under an hour per cycle.' },
      { type: 'h2', id: 'cadence', text: 'Cadence' },
      { type: 'p', text: 'Because the objection window runs from publication, the review interval should be comfortably shorter than 30 days so that counsel has time to assess and act — in practice every two weeks, or weekly for a large portfolio. TMistan adds records as Gazette issues are processed; the [Data Sources](/data-sources) page states which issues are covered, so compare the newest Gazette number in the database with the previous cycle.' },
      { type: 'h2', id: 'what-to-watch', text: 'What to watch' },
      { type: 'h3', id: 'watch-marks', text: 'Your marks and logos' },
      { type: 'ol', items: [
        '**Your marks, exactly and loosely.** Search each mark with fuzzy matching on; include the Dari and Pashto spellings and common transliterations (see [Searching Dari and Pashto Marks](/knowledge-center/searching-dari-and-pashto-trademarks-scripts-and-transliteration)).',
        '**Your logos.** Run Search by Image on each logo and on its dominant device element alone; look-alikes often change the wording but keep the shape.',
      ] },
      { type: 'h3', id: 'watch-market', text: 'Your classes, partners and competitors' },
      { type: 'ol', items: [
        '**Your classes.** In Advanced Search, set your Nice classes and the most recent publication period and page through everything new — this catches marks you would not have thought to search for.',
        '**Your partners.** Search current and former distributors, agents and licensees as applicants. Article 15 bars a representative from registering the owner’s mark without permission, and such filings are easiest to address inside the objection window.',
        '**Your competitors.** Search their names as applicants to see new filings in your market.',
      ] },
      { type: 'h2', id: 'triage', text: 'Triage a hit' },
      { type: 'p', text: 'For each record that resembles your mark: note the publication date and any printed objection deadline; compare the goods and class with yours (Article 8(14) is framed around identical goods); check the applicant against your records; download the record report; and route the file to counsel the same day. Article 26 sets a chain of short periods — 30 days to object, 15 for the office to forward, 30 for the applicant, 60 to reach the commercial court — so the first days matter most. The full procedure is in [Trademark Opposition in Afghanistan: The 30-Day Window](/knowledge-center/trademark-opposition-in-afghanistan).' },
      { type: 'h2', id: 'international', text: 'The international layer' },
      { type: 'p', text: 'Since 26 June 2018 marks can also reach Afghanistan as Madrid Protocol designations held at WIPO. Add a Madrid Monitor search for designations of AF resembling your marks to each cycle; those registrations are not in TMistan’s national records. See [Afghanistan and the Madrid System](/knowledge-center/madrid-protocol-afghanistan).' },
      { type: 'h2', id: 'documenting', text: 'Documenting the cycle' },
      { type: 'p', text: 'Record the date, the newest Gazette number reviewed, the searches run (terms, scripts, classes, images) and the hits with their serial numbers and source lines. A dated log shows diligence and makes the next cycle faster. Keep the record reports with the log.' },
      { type: 'check', title: 'Monitoring cycle checklist', items: [
        'Newest Gazette number compared with the last cycle.',
        'Each mark searched exactly and with fuzzy matching, in all relevant scripts.',
        'Each logo run through Search by Image.',
        'New publications in your classes reviewed for the period.',
        'Partners and competitors searched as applicants.',
        'Madrid Monitor checked for AF designations.',
        'Hits documented and sent to counsel with dates.',
      ] },
      { type: 'note', title: 'What monitoring on TMistan cannot do', text: 'TMistan is not a watch service: it does not send alerts, it covers only the issues it has processed, and it shows published dates rather than tracking proceedings. It makes the review efficient; the routine and the decisions are yours and your counsel’s.' },
      sources('law', 'madridMonitor'),
    ],
    meaning: [
      'Set the interval by the 30-day objection window, not by convenience.',
      'Class-and-period review catches what name searches miss; image search catches what wording hides.',
      'A dated log with record reports turns monitoring into evidence of diligence.',
    ],
    related: ['trademark-opposition-in-afghanistan', 'how-to-search-trademark-records', 'trademark-search-for-foreign-companies-afghanistan'],
    next: { label: 'Filter the latest publications by class', to: '/' },
  },

  /* ───────────── C. Scripts and transliteration ───────────── */
  {
    slug: 'searching-dari-and-pashto-trademarks-scripts-and-transliteration',
    category: 'searching',
    title: 'Searching Dari and Pashto Trademarks: Scripts, Transliteration and Spelling Variants',
    seoTitle: 'Searching Dari and Pashto Trademarks: Scripts and Spelling',
    summary: 'Why one mark can be printed in Latin, Dari and Pashto script in different issues, how to build a list of spelling variants, when to use fuzzy matching, and how image search helps when the wording differs.',
    metaDescription: 'Search Afghan trademark records across Latin, Dari and Pashto script: build spelling variants, use fuzzy matching and image search, read results in any script.',
    written: WRITTEN,
    thumbnail: '/img/kc/searching-dari-and-pashto-trademarks-scripts-and-transliteration.jpg',
    featured: false,
    keywords: ['Dari', 'Pashto', 'Persian script', 'transliteration', 'spelling variants', 'fuzzy matching', 'search tips', 'multilingual search'],
    body: [
      { type: 'p', text: 'Afghanistan’s Official Gazette publishes trademarks in the form the applicant filed: a Latin-script word, a Dari or Pashto rendering, or both side by side. TMistan stores records exactly as published and does not translate or transliterate them. A search that uses only one script therefore sees only part of the picture. This article explains how to search across scripts reliably.' },
      { type: 'h2', id: 'why', text: 'Why spellings vary' },
      { type: 'ul', items: [
        'Latin-script names are transliterated into Perso-Arabic script by ear, so the same brand can appear with different letters for the same sound (for example alternative letters for “s”, “t” or “z”, or with and without a final silent vowel).',
        'Dari and Pashto share most letters but not all, and Pashto has letters Dari lacks; a name may be written differently depending on the language of the entry.',
        'Short vowels are usually not written in Perso-Arabic script, so a Latin “Nilo” and “Nelo” may collapse into the same written form — or diverge when a long vowel is chosen.',
        'Latin spellings themselves vary across issues (“Al-Noor”, “Alnoor”, “Al Nur”), as do hyphens, spaces and the Arabic definite article.',
      ] },
      { type: 'h2', id: 'variants', text: 'Build a variant list before you search' },
      { type: 'p', text: 'Write the mark in Latin script; then in Dari and Pashto script as a local speaker would write it (ask one if you can); then the plausible alternatives for ambiguous consonants and long vowels; then the forms with and without articles, spaces and hyphens. Five to ten variants is normal for a short word. Keep the list — you will reuse it for monitoring (see [Monitoring New Trademark Publications](/knowledge-center/monitoring-new-trademark-publications-afghanistan)).' },
      { type: 'h2', id: 'techniques', text: 'Techniques on TMistan' },
      { type: 'h3', id: 'techniques-text', text: 'Text searches' },
      { type: 'ol', items: [
        '**Exact search in each script.** Run each variant on its own; results come from the mark name, the printed form, the applicant and the goods text.',
        '**Fuzzy matching.** Turn it on in Advanced Search to tolerate one- or two-letter differences within the same script. It does not bridge scripts — a Latin query will not find a Dari spelling — so it complements the variant list rather than replacing it.',
        '**Search the distinctive element.** A coined word or an unusual syllable alone finds compound marks and marks with added descriptive words.',
        '**Search the applicant.** Companies tend to keep one spelling of their own name across filings; the applicant field finds the whole portfolio regardless of how each mark was written.',
      ] },
      { type: 'h3', id: 'techniques-image', text: 'Image search and filters' },
      { type: 'ol', items: [
        '**Search by Image.** When the wording differs but the device is the same, visual similarity finds what text cannot. Text recognised in the image is also matched against mark names.',
        '**Filter by class.** Apply your Nice classes to each pass to keep the review manageable, then remove the filter once for a broader look.',
      ] },
      { type: 'example', title: 'One brand, several published forms (illustrative)', rows: [
        ['Latin', '“Al-Noor” · “Alnoor” · “Al Nur”'],
        ['Dari / Pashto', 'The name written with alternative letters for the same consonant, with or without the article'],
        ['Device', 'The same emblem with different wording — found by Search by Image'],
      ], caption: 'Illustrative patterns, not a statement about any particular registered mark.' },
      { type: 'h2', id: 'reading', text: 'Reading results in another script' },
      { type: 'p', text: 'The interface is available in English, Dari and Pashto, but the records keep the script of the publication. If you cannot read a script, compare the image and the applicant name, use the class and goods text, and ask a local professional to confirm any match that matters. Records show the mark “as printed” precisely so that spelling differences are visible rather than hidden.' },
      { type: 'note', title: 'Similarity across scripts is a legal question', text: 'Whether a Dari rendering of a Latin mark is “similar” under Article 8(14) — visually, phonetically or conceptually — is for a professional to assess. TMistan surfaces the candidates; it does not decide.' },
      sources('law'),
    ],
    meaning: [
      'Search every script the market will see; fuzzy matching helps within a script, not between scripts.',
      'A written variant list makes searches repeatable and monitoring consistent.',
      'Applicant and image searches find marks whose wording you would never have guessed.',
    ],
    related: ['how-to-search-trademark-records', 'how-to-check-if-a-trademark-is-taken-in-afghanistan', 'preliminary-trademark-search'],
    next: { label: 'Try a search with fuzzy matching', to: '/' },
  },

  /* ───────────── D. Geographical names ───────────── */
  {
    slug: 'geographical-names-in-afghan-trademark-law',
    category: 'law',
    title: 'Geographical Names and Indications in Afghan Trademark Law',
    seoTitle: 'Geographical Names in Afghan Trademark Law (Arts. 8, 23, 24)',
    summary: 'What the 2009 law says about place names in trademarks: when a geographical name cannot be registered, the duties of an owner whose mark includes a famous place, the ban on deceptive use, and how to research place-name marks.',
    metaDescription: 'Geographical names in Afghan trademark law: misleading place names barred by Article 8, duties under Articles 23–24, deceptive use (Article 31), research tips.',
    written: WRITTEN,
    thumbnail: '/img/kc/geographical-names-in-afghan-trademark-law.jpg',
    featured: false,
    keywords: ['geographical names', 'geographical indication', 'place names', 'Article 23', 'Article 24', 'misleading origin', 'Afghanistan trademark law'],
    body: [
      { type: 'p', text: 'Place names are common in trademarks — a city, a valley, a region known for a product. Afghanistan’s Law on Trade Marks Registration addresses them in four places: the list of unregistrable signs, two articles on production in and use of famous geographical areas, and the list of violations. WIPO Lex notes that the law also covers geographical indications. This article sets out the provisions as translated and what they mean for research.' },
      { type: 'note', title: 'Educational summary, not legal advice', text: 'The article summarises the official English translation of the law (Official Gazette No. 995, 2009). The Dari and Pashto texts are authoritative and practice may differ. Confirm anything you rely on with a qualified professional.' },
      { type: 'h2', id: 'registrability', text: 'Registrability (Article 8)' },
      { type: 'p', text: 'Among the signs that may not be used or registered, Article 8 lists geographical names whose use may cause confusion as to the origin of the goods (item 8), and marks that may mislead the public or contain false or deceptive information about origin or source (item 10). A place name is therefore not banned as such; it is banned when it would confuse or deceive about where the goods come from. The full list is in [What Can and Cannot Be Registered](/knowledge-center/what-can-be-registered-as-a-trademark-in-afghanistan).' },
      { type: 'h2', id: 'famous-areas', text: 'Production in a famous geographical area (Article 23)' },
      { type: 'ul', items: [
        'When a famous geographical location is registered as part of a trademark, the owner must produce the goods, or deliver the services, in that location (Article 23(1)).',
        'No one may, to deceive people, use or introduce materials, products or services in a way that does not correspond to their actual geographical sign (Article 23(2)).',
        'Producers in a location with special fame may not use a trademark in a manner implying that goods or services were produced in that famous location when they were not (Article 23(3)).',
      ] },
      { type: 'h2', id: 'famous-names', text: 'Use of famous names (Article 24)' },
      { type: 'p', text: 'Persons may use famous geographical names that are used in commercial terms for branding materials, products or services, unless the naming is deceptive within the meaning of the violations article. In other words, a well-known place name can be part of a brand when it does not mislead.' },
      { type: 'h2', id: 'violations', text: 'Deceptive use as a violation (Article 31)' },
      { type: 'p', text: 'Using marks of famous geographical locations on goods or services in a manner that deceives people is one of the violations for which compensation is payable (Article 31(1)(H)), with doubled damages or six to twelve months’ imprisonment for repeated violations (Article 31(2)). Using any of the signs listed in Article 8 is likewise a violation (Article 31(1)(E)). The remedies are described in [Trademark Infringement in Afghanistan](/knowledge-center/trademark-infringement-and-penalties-afghanistan).' },
      { type: 'h2', id: 'research', text: 'Researching place-name marks' },
      { type: 'p', text: 'Search the place name on its own and combined with the product word, in Latin, Dari and Pashto script; many published marks pair a region with a product. Read the goods text and the applicant’s address: a mark that includes a famous location registered to an owner elsewhere raises exactly the question Article 23 addresses — but the record cannot answer it, because the record shows the publication, not where the goods are made. Note such records for professional review rather than drawing conclusions.' },
      { type: 'h3', id: 'research-questions', text: 'Questions a place-name record raises' },
      { type: 'example', title: 'Questions a place-name record raises', rows: [
        ['Mark includes a famous location', 'Does the owner produce there? (Art. 23(1))'],
        ['Owner address elsewhere', 'Possible, legitimate or not — the record cannot tell'],
        ['Goods are typical of the place', 'Confusion as to origin is the Article 8(8) concern'],
      ], caption: 'TMistan shows what was published; the assessment is legal.' },
      sources('law', 'lawWipo'),
    ],
    meaning: [
      'A place name in a mark is not itself a problem; confusion or deception about origin is.',
      'Marks containing famous locations carry a production duty under Article 23 that no publication record can verify.',
      'Search place names in all three scripts and read the goods and address fields together.',
    ],
    related: ['what-can-be-registered-as-a-trademark-in-afghanistan', 'trademark-infringement-and-penalties-afghanistan', 'afghanistan-trademark-law-overview'],
    next: { label: 'Search a place name in the records', to: '/' },
  },
]
