/* ---------------------------------------------------------------------------
 * Knowledge Center — launch articles.
 *
 * Static editorial content (no database). Bodies are English; titles and
 * summaries are translated in the locale files (knowledge.articles.<slug>).
 * Every feature described here exists in the current UI; screenshots are
 * taken from the real interface (see the kc/ section of web/public/img/CREDITS.md).
 * Reading times are computed from the word count — never hand-written.
 * ------------------------------------------------------------------------- */

export type KnowledgeCategory = 'fundamentals' | 'searching' | 'gazette' | 'classes' | 'limits'
export const KNOWLEDGE_TOPICS: KnowledgeCategory[] = ['searching', 'gazette', 'classes', 'limits']
export const KNOWLEDGE_CATEGORIES: KnowledgeCategory[] = ['fundamentals', ...KNOWLEDGE_TOPICS]

export type ArticleBlock =
  | { type: 'p'; text: string }
  | { type: 'h2'; id: string; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'check'; title: string; items: string[] }
  | { type: 'example'; title: string; rows: [string, string][]; caption?: string }
  | { type: 'note'; title: string; text: string }
  | { type: 'figure'; src: string; alt: string; caption: string }

export type Article = {
  slug: string
  category: KnowledgeCategory
  /** Optional card label overriding the category (e.g. "Best practices"). Translated under knowledge.labels. */
  label?: 'bestPractices'
  title: string
  summary: string
  /** Date the text was written (real authoring date). */
  written: string
  thumbnail: string
  featured: boolean
  body: ArticleBlock[]
  /** "What this means for your search" */
  meaning: string[]
  related: string[]
  next: { label: string; to: string }
  keywords: string[]
}

const WRITTEN = '2026-10-13'

export const ARTICLES: Article[] = [
  /* ───────────────────────────── 1. What is a trademark ───────────────────────────── */
  {
    slug: 'what-is-a-trademark',
    category: 'fundamentals',
    title: 'What Is a Trademark?',
    summary: 'The basics every researcher should know before opening a search: what a trademark protects, the forms it can take, and why published records matter.',
    written: WRITTEN,
    thumbnail: '/img/kc/what-is-a-trademark.jpg',
    featured: false,
    keywords: ['trademark', 'brand', 'logo', 'word mark', 'goods', 'services', 'applicant', 'publication'],
    body: [
      { type: 'p', text: 'A trademark is a sign that a business uses to distinguish its goods or services from those of other businesses. The sign can be a word, a name, letters or numbers, a logo, a drawing, a particular arrangement of colours, or a combination of these. What matters is that customers recognise the sign and connect it with a particular source.' },
      { type: 'p', text: 'Trademark rights are tied to specific goods and services. The same word can therefore be a trademark for two unrelated businesses — one selling paint, one running a restaurant — without the two necessarily conflicting. This is why every published record names not only the mark but also the goods or services it covers and the class those goods or services belong to.' },
      { type: 'h2', id: 'forms', text: 'The forms a trademark can take' },
      { type: 'ul', items: [
        'Word marks — a word, name or slogan written in standard characters. Protection is about the word itself, not a specific typeface.',
        'Figurative marks — a logo, drawing or stylised lettering. The visual appearance is the protected element.',
        'Combined marks — a word together with a design element. These are the most common entries in the records TMistan displays.',
        'Other signs — for example a distinctive packaging shape or colour combination. These are rarer in published records.',
      ] },
      { type: 'p', text: 'In the records available on TMistan, a trademark image is shown where one accompanies the record. A record without an image is usually a word mark or an entry whose image is not among the source materials available to the platform.' },
      { type: 'h2', id: 'not-a-trademark', text: 'What a trademark is not' },
      { type: 'ul', items: [
        'A trade name (the name under which a business operates) is not automatically a trademark, although the same word may be registered as one.',
        'A domain name or social-media handle does not create trademark rights by itself.',
        'A patent protects an invention and copyright protects an original work; neither does what a trademark does, even though a single product can involve all three.',
      ] },
      { type: 'h2', id: 'lifecycle', text: 'From application to published record' },
      { type: 'p', text: 'Although procedures differ from country to country, most trademark systems follow a similar path: an applicant files an application describing the mark and the goods or services; the responsible office examines it; the application is published so that others can see it and, where the law allows, object within a stated period; and, if no obstacle remains, the mark is registered and later renewed.' },
      { type: 'p', text: 'The entries on TMistan come from the stage where trademark records are published in the Official Gazette of Afghanistan. A record therefore documents that something was published — the mark, the applicant, the class and the goods or services as they appeared in that issue. Where the source states an objection deadline it is shown with the record; where it does not, nothing is assumed.' },
      { type: 'note', title: 'Published is not the same as registered', text: 'A published application may later be opposed, withdrawn, refused, amended or allowed to lapse. TMistan shows what was published and any recorded changes it has data for; it does not show the current legal status of a mark. See “What a Trademark Search Can and Cannot Tell You”.' },
      { type: 'h2', id: 'who', text: 'Who appears in a record' },
      { type: 'p', text: 'Each record names an applicant — the person or company that filed the application — and, where available, the applicant’s address. Later records may document a change of owner or of address; TMistan lists these under “Recorded Changes” on the record page when they exist in its data. Representatives who filed on the applicant’s behalf are not shown publicly.' },
      { type: 'check', title: 'Before you start searching', items: [
        'Write down the exact mark you are interested in, including alternative spellings and transliterations (Latin, Dari and Pashto).',
        'List the goods or services it would cover — this points you to the right classes.',
        'Decide what you need to learn: whether a similar mark was published, who applied for it, or what a specific gazette entry says.',
        'Remember that a search result is a research finding, not a legal conclusion.',
      ] },
    ],
    meaning: [
      'Search for the mark and for the goods or services separately — a similar name in a different class may or may not matter to your situation.',
      'Expect published applications as well as later changes; the record tells you what appeared in the Gazette, not whether the mark is in force today.',
      'Note the applicant’s name: searching by applicant often reveals related marks that a name search alone would miss.',
    ],
    related: ['understanding-trademark-classes', 'how-to-search-trademark-records', 'what-a-search-can-and-cannot-tell-you'],
    next: { label: 'Start a search', to: '/' },
  },

  /* ───────────────────────────── 2. How to search ───────────────────────────── */
  {
    slug: 'how-to-search-trademark-records',
    category: 'searching',
    title: 'How to Search Trademark Records in TMistan',
    summary: 'A step-by-step guide to using the search features and filters effectively.',
    written: WRITTEN,
    thumbnail: '/img/kc/how-to-search-trademark-records.jpg',
    featured: true,
    keywords: ['search', 'keyword', 'filters', 'advanced search', 'fuzzy', 'sort', 'grid', 'table', 'image search', 'serial number'],
    body: [
      { type: 'p', text: 'TMistan searches trademark records published in the Official Gazette of Afghanistan. This guide walks through the search page as it works today: the keyword box, the advanced filters, the result views and the image search. Every feature mentioned here is available on the Search page.' },
      { type: 'figure', src: '/img/kc/fig-search-results.jpg', alt: 'The TMistan search page showing the keyword box and a list of results', caption: 'The Search page: keyword box at the top, results and filters below.' },
      { type: 'h2', id: 'keyword', text: 'Step 1 — Start with a keyword' },
      { type: 'p', text: 'Open Search and type what you know into the search box. The keyword search looks across the main fields of each record, so you can enter:' },
      { type: 'ul', items: [
        'a trademark name — for example Edifier;',
        'an applicant name or part of it;',
        'a serial number such as 1022-073, or an Official Gazette number such as 1022;',
        'a word that appears in the goods and services description.',
      ] },
      { type: 'p', text: 'Press Search (or Enter). The results summary tells you how many records matched and repeats your query, so you always know which search you are looking at.' },
      { type: 'h2', id: 'advanced', text: 'Step 2 — Narrow the search with Advanced Search' },
      { type: 'p', text: 'Below the search box, “Advanced search” opens a panel with one field per record attribute. Use it when a keyword brings back too much, or when you want to search a single field precisely:' },
      { type: 'ul', items: [
        'Trademark name, Serial number, Applicant’s name and Goods & services — text fields that match within that field only.',
        'Class — pick one or more Nice classes (1–45); the picker shows how many published records exist per class.',
        'Official Gazette number and Publication date (from/to) — limit the results to particular issues or a period.',
        'Application type — for example a new trademark application or a renewal, as named in the source.',
        'Application number and Registration number — available where the database has been updated with these fields; otherwise the panel marks them “Not available yet”.',
        'Fuzzy matching — also matches similar spellings (COCA-COLA ≈ COCACOLA). Turn it on when you are unsure how a mark was written.',
      ] },
      { type: 'figure', src: '/img/kc/fig-advanced-search.jpg', alt: 'The Advanced Search panel with its fields', caption: 'Advanced Search: one field per record attribute, plus fuzzy matching.' },
      { type: 'p', text: 'Active filters appear as chips above the results. Remove a single chip, or use “Clear all” to return to a plain keyword search. Filters are kept in the page address, so you can bookmark a search or send the link to a colleague.' },
      { type: 'h2', id: 'results', text: 'Step 3 — Read and organise the results' },
      { type: 'ul', items: [
        'Grid or table — switch between cards with the trademark image and a compact table of the key fields.',
        'Sort by — Relevance (default for keyword searches), Newest first, Oldest first, Mark A→Z / Z→A or Serial Number.',
        'Per page — choose how many records to show; page controls appear at the bottom.',
        'Each result shows the mark, applicant, class and the gazette it was published in. Click a card or a row to open the full record.',
      ] },
      { type: 'h2', id: 'record', text: 'Step 4 — Open the record' },
      { type: 'p', text: 'The record page shows every field available for the entry — mark name, serial number, applicant and address, class, goods and services, application type, publication date, the Gazette number and the source page — together with the trademark image where one is on file and any recorded changes. “Download Record” generates a printable PDF of the record (the Trademark Publication Report) with its source reference and disclaimer. How to read these fields is explained in “How to Read Official Gazette Entries”.' },
      { type: 'h2', id: 'image', text: 'Searching by image' },
      { type: 'p', text: 'Switch the search mode to “Search by Image” to look for visually similar trademark images. Choose or drag in an image of the logo (PNG, JPEG, WebP, GIF or BMP). The image is analysed in your browser — it is not uploaded or stored — and compared with the images indexed from published records. Results show a similarity level; you can restrict them to near-identical images (“Exact match”) or refine them by class, gazette number or application type.' },
      { type: 'note', title: 'Similarity is an indicator, not a finding', text: 'Image similarity scores are computed from visual features. They help you find candidates to look at; they do not establish that two marks are legally confusingly similar.' },
      { type: 'h2', id: 'language', text: 'A note on languages' },
      { type: 'p', text: 'The interface is available in English, Dari and Pashto, but record content is shown exactly as published and is not translated. A mark published in Latin letters must be searched in Latin letters; a mark published in Dari or Pashto script must be searched in that script. When in doubt, search both and enable fuzzy matching.' },
      { type: 'check', title: 'Quick checklist', items: [
        'Keyword first, then narrow with Advanced Search.',
        'Try alternative spellings and transliterations; enable fuzzy matching.',
        'Filter by class to focus on relevant goods or services.',
        'Open each candidate record and note its serial number and source line.',
        'Use “Download Record” to keep a copy of what you found.',
      ] },
    ],
    meaning: [
      'A keyword search is a good start; a thorough search combines several passes — name, applicant, class and image.',
      'Because filters live in the page address, you can repeat the same search later and compare the results.',
      'A result confirms that a record exists in TMistan’s data; it does not by itself establish the mark’s legal status.',
    ],
    related: ['preliminary-trademark-search', 'how-to-read-gazette-entries', 'understanding-trademark-classes'],
    next: { label: 'Open the search', to: '/' },
  },

  /* ───────────────────────────── 3. Reading a gazette entry ───────────────────────────── */
  {
    slug: 'how-to-read-gazette-entries',
    category: 'gazette',
    title: 'How to Read Official Gazette Entries',
    summary: 'Learn how to interpret Gazette numbers, publication dates and source references.',
    written: WRITTEN,
    thumbnail: '/img/kc/how-to-read-gazette-entries.jpg',
    featured: true,
    keywords: ['gazette', 'official gazette', 'OG', 'serial number', 'source page', 'publication date', 'N/A', 'record', 'solar hijri'],
    body: [
      { type: 'p', text: 'Every TMistan record is a structured version of an entry published in the Official Gazette of Afghanistan. Understanding how the fields map back to the printed publication lets you verify a record against its source and judge how much weight to give it.' },
      { type: 'h2', id: 'gazette', text: 'The Official Gazette and its issues' },
      { type: 'p', text: 'The Official Gazette is published in numbered issues. Trademark entries appear inside an issue, each on one or more pages. TMistan keeps two references for every record: the Gazette Number (the issue) and the Source Page (the page or pages within that issue). Together they tell you where to look in the original publication.' },
      { type: 'h2', id: 'serial', text: 'Serial numbers' },
      { type: 'p', text: 'The serial number identifies a record within a gazette issue. It has the form issue–position: 1022-073 is the 73rd entry published in Official Gazette 1022. Serial numbers are the quickest way to cite a record or to find it again — type one into the search box and the record is returned directly.' },
      { type: 'h2', id: 'fields', text: 'The fields of a record' },
      { type: 'ul', items: [
        'Mark Name — the trademark wording as published. For purely figurative marks this may be a description or may be N/A.',
        'Applicant and Address — the person or company that filed, as recorded in the source.',
        'Class — the Nice class (or classes) stated in the entry. See “Understanding Trademark Classes”.',
        'Goods and Services — the description of goods or services covered, as published.',
        'Application Type — the kind of entry as named in the source, for example a new trademark application or a renewal.',
        'Publication Date — the date of the issue. Dates recorded in the Solar Hijri calendar are shown converted to the Gregorian calendar in English, with the original Solar Hijri date in brackets.',
        'Objection Deadline — shown only when the source states one.',
        'Recorded Changes — new and previous owner or address, where a later entry recorded a change.',
        'Images — the mark as it appears in the available source material, where an image is on file.',
      ] },
      { type: 'example', title: 'Example — a real record as shown in TMistan', caption: 'Record 1022-073 as it appears on TMistan at the time of writing. Its Source Information reads “OG 1022 — Page 15-16”.', rows: [
        ['Mark Name', 'Edifier'],
        ['Serial Number', '1022-073'],
        ['Applicant', 'BEIJING EDIFIER TECHNOLOGY CO LTD'],
        ['Class', '9'],
        ['Goods and Services', 'Audio, electronic and technology goods'],
        ['Application Type', 'New trademark application'],
        ['Publication Date', '20 May 2010 (1389/02/30 SH)'],
        ['Gazette Number', '1022'],
        ['Source Page', '15-16'],
      ] },
      { type: 'figure', src: '/img/kc/fig-record-page.jpg', alt: 'A trademark record page in TMistan with its fields and source line', caption: 'A record page: fields on the left, the trademark image and source information alongside.' },
      { type: 'h2', id: 'source-line', text: 'Reading the source line' },
      { type: 'p', text: 'Each record page carries a single source line under the heading “Source Information”, in the form “OG <number> — Page <n>”. “OG” stands for Official Gazette. The page value is reproduced as recorded, so it may be a single page, a range such as 15-16, or absent when the source does not state it (“OG 1022”). In search results the same information appears as the Gazette Number and Page columns. When you need certainty about an entry, this line is your pointer to the original publication.' },
      { type: 'h2', id: 'na', text: 'What “N/A” means' },
      { type: 'p', text: 'A field shown as N/A was not available in the source material TMistan has for that record. It does not mean the information does not exist elsewhere — for instance in a later issue, in the office’s own file or in a document not among the platform’s sources. Treat N/A as “not available here”, never as “none”.' },
      { type: 'h2', id: 'images', text: 'Images and what they prove' },
      { type: 'p', text: 'Images are associated with records through the available image files and their record references. Where an image is shown, it represents the mark as it appears in the available source material; where none is on file, the record says so. An image association is a data-matching step, not an independent confirmation of authenticity or registration.' },
      { type: 'h2', id: 'download', text: 'Keeping a copy' },
      { type: 'p', text: '“Download Record” produces a Trademark Publication Report — a clean PDF of the record with its fields, image (where available), source line, the date it was generated and the platform disclaimer. Keep it with your research notes; when you later cite the entry, quote the serial number and source line rather than the PDF alone.' },
      { type: 'check', title: 'Verifying an entry', items: [
        'Note the serial number and the source line (OG number and page).',
        'Compare the mark, applicant, class and goods or services with the original issue when a decision depends on them.',
        'Check “Recorded Changes” for later ownership or address entries.',
        'If something in the record looks wrong, submit a Data Correction Request with the serial number and what you observed.',
      ] },
    ],
    meaning: [
      'A record is a pointer to a publication: the serial number and source line let you — or your adviser — find the original entry.',
      'Dates and page references are reproduced as recorded; when they look unusual, check the source rather than assuming an error.',
      'An N/A value is a gap in the available data, not evidence of absence.',
    ],
    related: ['understanding-trademark-classes', 'what-a-search-can-and-cannot-tell-you', 'how-to-search-trademark-records'],
    next: { label: 'Read about our data sources', to: '/data-sources' },
  },

  /* ───────────────────────────── 4. Classes ───────────────────────────── */
  {
    slug: 'understanding-trademark-classes',
    category: 'classes',
    title: 'Understanding Trademark Classes',
    summary: 'Get familiar with the class system and how goods and services are categorised.',
    written: WRITTEN,
    thumbnail: '/img/kc/understanding-trademark-classes.jpg',
    featured: true,
    keywords: ['class', 'classes', 'nice classification', 'goods', 'services', 'class 9', 'class 35', 'filter'],
    body: [
      { type: 'p', text: 'Trademark records group goods and services into numbered classes. The classes used in the records TMistan displays follow the international Nice Classification, which has 45 classes: classes 1 to 34 cover goods and classes 35 to 45 cover services. A class number is a shorthand for a broad family of products or activities.' },
      { type: 'h2', id: 'why', text: 'Why classes matter' },
      { type: 'p', text: 'Trademark rights attach to goods and services, not to a word in the abstract. Two identical marks in unrelated classes can coexist; two similar marks in the same class for similar goods are far more likely to be in conflict. Knowing the class of the goods or services you care about therefore tells you where to focus a search — and which results you can usually set aside.' },
      { type: 'h2', id: 'examples', text: 'Some familiar classes' },
      { type: 'ul', items: [
        'Class 3 — cosmetics, perfumery and cleaning preparations.',
        'Class 5 — pharmaceuticals and other preparations for medical use.',
        'Class 9 — electronic and scientific apparatus, audio equipment, computers and software.',
        'Class 25 — clothing, footwear and headwear.',
        'Class 29 and Class 30 — processed foods (29) and staple foods such as coffee, tea, rice, flour and confectionery (30).',
        'Class 32 — beers, mineral waters and non-alcoholic beverages.',
        'Class 35 — advertising, business management and retail services.',
        'Class 41 — education, training and entertainment services.',
        'Class 42 — scientific and technological services, including software design and development.',
        'Class 43 — services for providing food and drink, and temporary accommodation.',
      ] },
      { type: 'p', text: 'These short descriptions are reminders, not definitions. The scope of a class is set by its full heading and the alphabetical list of goods and services that accompanies it; the goods and services actually covered by a record are those listed in the record itself.' },
      { type: 'h2', id: 'record', text: 'Classes in a TMistan record' },
      { type: 'p', text: 'The Class field shows the number stated in the published entry; an entry can name more than one class. The Goods and Services field reproduces the description that was published. Read the two together: the class tells you the family, the description tells you what was actually claimed. The example record 1022-073, for instance, is in Class 9 for “Audio, electronic and technology goods”.' },
      { type: 'h2', id: 'filter', text: 'Filtering a search by class' },
      { type: 'p', text: 'In Advanced Search, the Class field opens a picker with all 45 classes. Each class shows the number of published records currently in TMistan’s data for that class, which is a useful indication of how much there is to review. Select one or several classes, press Done, and the chips above the results show the active class filter. The class filter works in combination with any keyword or other filter.' },
      { type: 'figure', src: '/img/kc/fig-class-picker.jpg', alt: 'The class picker in Advanced Search showing classes with record counts', caption: 'The class picker lists all 45 Nice classes with the number of published records per class.' },
      { type: 'h2', id: 'related', text: 'Related classes' },
      { type: 'p', text: 'Goods and the services connected with them are often in different classes — for example, computer hardware (Class 9) and software development services (Class 42), or clothing (Class 25) and retail services for clothing (Class 35). A careful search covers the class of the goods or services themselves and the classes that are commercially close to them.' },
      { type: 'check', title: 'Choosing classes for a search', items: [
        'Start from the goods or services, not from the class number you expect.',
        'Include the classes of goods or services that are commercially connected.',
        'Run the search without a class filter at least once — classification in the source can be broader or narrower than you expect.',
        'Read the Goods and Services field of each candidate record; the class number alone is not enough.',
      ] },
    ],
    meaning: [
      'Filtering by class makes a result list manageable, but a similar mark in a neighbouring class can still be relevant.',
      'The description in the record, not the class number, defines what a published entry covers.',
      'Record counts per class help you estimate how much reviewing a thorough search will take.',
    ],
    related: ['how-to-search-trademark-records', 'preliminary-trademark-search', 'how-to-read-gazette-entries'],
    next: { label: 'Search by class', to: '/' },
  },

  /* ───────────────────────────── 5. Preliminary search ───────────────────────────── */
  {
    slug: 'preliminary-trademark-search',
    category: 'searching',
    label: 'bestPractices',
    title: 'How to Conduct a Preliminary Trademark Search',
    summary: 'Practical tips to help you find the relevant and accurate information.',
    written: WRITTEN,
    thumbnail: '/img/kc/preliminary-trademark-search.jpg',
    featured: true,
    keywords: ['preliminary search', 'clearance', 'tips', 'best practices', 'variants', 'transliteration', 'fuzzy', 'applicant', 'image search'],
    body: [
      { type: 'p', text: 'A preliminary search is a structured look through published records before a decision — adopting a new brand, filing an application, or responding to a mark you have come across. It will not replace a professional clearance opinion, but done carefully it shows you what has been published and gives your adviser a solid starting point. The steps below use only the features available on TMistan.' },
      { type: 'h2', id: 'define', text: '1. Define what you are searching for' },
      { type: 'ul', items: [
        'The mark: its exact spelling, and how it would be written in Latin letters, Dari and Pashto.',
        'The goods or services, and the classes they fall into (see “Understanding Trademark Classes”).',
        'What would count as a problem for you: an identical mark, a similar-sounding one, a similar logo, or any mark by a particular company.',
      ] },
      { type: 'h2', id: 'exact', text: '2. Search the exact mark' },
      { type: 'p', text: 'Enter the mark in the keyword box and review every result, not only the first page. Then repeat the search with “Trademark name” in Advanced Search to restrict the match to the mark field itself. Open each candidate record and note its serial number.' },
      { type: 'h2', id: 'variants', text: '3. Search variants' },
      { type: 'p', text: 'Marks are often published in forms you did not expect. Search:' },
      { type: 'ul', items: [
        'spelling variants and common misspellings;',
        'the mark split into or joined from several words (COCA COLA, COCACOLA, COCA-COLA);',
        'transliterations in Dari and Pashto script, and translations where the mark has a meaning;',
        'the distinctive part of the mark on its own, without descriptive words such as “company” or “products”.',
      ] },
      { type: 'p', text: 'Turn on Fuzzy matching in Advanced Search to catch similar spellings automatically, then review the extra results critically — fuzzy matching finds more, including marks that are not relevant.' },
      { type: 'h2', id: 'applicant', text: '4. Search by applicant' },
      { type: 'p', text: 'If a competitor or a known company is of interest, search its name in the Applicant’s name field. Company names also vary between entries (abbreviations, “Co.”, “Ltd”, transliterations), so try the shortest distinctive part of the name.' },
      { type: 'h2', id: 'class', text: '5. Review the relevant classes' },
      { type: 'p', text: 'Filter your searches by the classes you identified, and separately browse each class with no keyword to see what is published there. Scanning the grid view of a class is an effective way to spot similar-looking logos.' },
      { type: 'h2', id: 'image', text: '6. Use image search for logos' },
      { type: 'p', text: 'For a figurative mark, switch to “Search by Image” and upload a clear image of the logo on a plain background. Review the visually similar records and refine them by class if the list is long. Treat similarity scores as a way to find candidates, not as a conclusion.' },
      { type: 'figure', src: '/img/kc/fig-image-search.jpg', alt: 'The Search by Image mode with the upload area', caption: 'Search by Image analyses the picture in your browser and lists visually similar published images.' },
      { type: 'h2', id: 'document', text: '7. Document what you found' },
      { type: 'p', text: 'For every relevant record, note the serial number, mark, applicant, class, publication date and source line, and download the Trademark Publication Report. Record the searches you ran as well (keywords, filters, date) — the address bar of the search page contains your filters and can be saved as a link.' },
      { type: 'h2', id: 'limits', text: '8. Know the limits' },
      { type: 'p', text: 'TMistan covers the records available in its database; coverage depends on the source materials collected. A record shows what was published, not the mark’s current status. Before relying on your findings, read “What a Trademark Search Can and Cannot Tell You” and consult a qualified professional for a legal opinion.' },
      { type: 'check', title: 'Preliminary search checklist', items: [
        'Exact mark searched in the keyword box and in the Trademark name field.',
        'Spelling variants, split/joined forms and transliterations searched; fuzzy matching tried.',
        'Applicant names of interest searched.',
        'Relevant and neighbouring classes reviewed, including a browse of each class in grid view.',
        'Image search run for figurative marks.',
        'Findings documented with serial numbers, source lines and downloaded reports.',
        'Limits understood; professional advice sought before a decision.',
      ] },
    ],
    meaning: [
      'Several short, targeted searches reveal more than one broad search — plan them and record them.',
      'Variants and transliterations are where most relevant marks hide; fuzzy matching and image search help, but reviewing results critically is still your job.',
      'Your documented findings are the useful output: they let a professional advise you without repeating the groundwork.',
    ],
    related: ['how-to-search-trademark-records', 'understanding-trademark-classes', 'what-a-search-can-and-cannot-tell-you'],
    next: { label: 'Run your first search', to: '/' },
  },

  /* ───────────────────────────── 6. Limits ───────────────────────────── */
  {
    slug: 'what-a-search-can-and-cannot-tell-you',
    category: 'limits',
    title: 'What a Trademark Search Can and Cannot Tell You',
    summary: 'Understand what TMistan includes, what it doesn’t, and how to use the information responsibly.',
    written: WRITTEN,
    thumbnail: '/img/kc/what-a-search-can-and-cannot-tell-you.jpg',
    featured: false,
    keywords: ['limits', 'coverage', 'status', 'registration', 'disclaimer', 'legal advice', 'verification', 'correction'],
    body: [
      { type: 'p', text: 'TMistan is an independent research platform operated by Masnad Law Firm. It makes published trademark records easier to find and read. Used well, it answers many questions quickly; used carelessly, it can suggest certainty that the data does not support. This article sets out both sides.' },
      { type: 'h2', id: 'can', text: 'What a search can tell you' },
      { type: 'ul', items: [
        'Whether a record matching your keyword, filters or image exists in TMistan’s data, and what that record says.',
        'The mark, applicant, class, goods and services, application type and publication details as published.',
        'Where the entry was published — the Official Gazette number and source page — so you can consult the original.',
        'Recorded changes of owner or address that exist in the platform’s data.',
        'How many published records exist per class in the data, as a measure of activity in that class.',
      ] },
      { type: 'h2', id: 'cannot', text: 'What a search cannot tell you' },
      { type: 'ul', items: [
        'That no conflicting mark exists. Coverage depends on the source materials available to the platform; an absence in TMistan is not an absence in the official record.',
        'The current legal status of a mark — whether an application was opposed, refused, registered, renewed, assigned or cancelled after publication — unless a later change was published and is part of the data.',
        'Whether a mark is valid, enforceable or infringed. Those are legal questions that depend on facts the records do not contain.',
        'That two marks are, or are not, confusingly similar. Text and image similarity on TMistan are computational indicators to help you find candidates.',
        'Anything the source did not state. A field shown as N/A is unavailable in the data, not confirmed to be empty.',
      ] },
      { type: 'figure', src: '/img/kc/fig-data-sources.jpg', alt: 'The Data Sources and Methodology page of TMistan', caption: 'The Data Sources & Methodology page explains where records come from and how they are processed.' },
      { type: 'h2', id: 'why', text: 'Why these limits exist' },
      { type: 'p', text: 'Records are transcribed from published issues and organised into structured fields. Source materials can be incomplete, unclear or difficult to read; images are associated with records by matching data, not by independent verification; and later events are only visible when a later publication recorded them and is in the data. The Data Sources & Methodology page describes this process and its quality controls in detail.' },
      { type: 'h2', id: 'responsibly', text: 'Using the information responsibly' },
      { type: 'ol', items: [
        'Treat every result as a research finding to be verified, not as a conclusion.',
        'Cite records by serial number and source line, and consult the original Gazette issue when a decision depends on an entry.',
        'Do not present a search result, a record or a report as proof that a mark is registered, owned by someone or free to use.',
        'Where a decision has legal or commercial consequences, obtain advice from a qualified professional who can check the official register and current status.',
        'Respect the rights of others: marks, logos and names displayed on TMistan belong to their respective owners.',
      ] },
      { type: 'h2', id: 'wrong', text: 'If a record looks wrong' },
      { type: 'p', text: 'Errors in transcription, classification or image association can occur. The Data Correction & Verification Requests page lets you report an incorrect name, a classification issue, an image problem, a publication reference, a possible duplicate or any other discrepancy. Requests are reviewed against the source materials; where appropriate, the information displayed on the platform is updated. TMistan does not modify official government records.' },
      { type: 'note', title: 'Not legal advice', text: 'Nothing on this platform constitutes legal advice or creates a lawyer-client relationship. The Disclaimer and the Terms of Use describe the basis on which the information is provided.' },
      { type: 'check', title: 'Before you rely on a result', items: [
        'Have I checked the original publication for the entries that matter?',
        'Do I know whether this record shows a published application or a later change?',
        'Have I searched variants, applicants, neighbouring classes and images, not just one keyword?',
        'Have I separated what the record says from what I am inferring?',
        'Do I need a professional opinion before acting?',
      ] },
    ],
    meaning: [
      'Use TMistan to find and document what was published; use the original Gazette and professional advice to establish what it means today.',
      'A clean search is encouraging but never conclusive — coverage and status are outside what the data can show.',
      'When a record seems wrong, report it: corrections improve the platform for every researcher.',
    ],
    related: ['how-to-read-gazette-entries', 'preliminary-trademark-search', 'what-is-a-trademark'],
    next: { label: 'Read the Data Sources & Methodology page', to: '/data-sources' },
  },
]

export const ARTICLE_BY_SLUG: Record<string, Article> = Object.fromEntries(ARTICLES.map((a) => [a.slug, a]))

/** Words per minute used for the displayed reading time (a common average for adult readers). */
const WPM = 200

function blockText(b: ArticleBlock): string {
  switch (b.type) {
    case 'p':
    case 'h2':
      return b.text
    case 'ul':
    case 'ol':
      return b.items.join(' ')
    case 'check':
      return `${b.title} ${b.items.join(' ')}`
    case 'example':
      return `${b.title} ${b.rows.map((r) => r.join(' ')).join(' ')} ${b.caption ?? ''}`
    case 'note':
      return `${b.title} ${b.text}`
    case 'figure':
      return b.caption
  }
}

export function articleWordCount(a: Article): number {
  const text = [a.title, a.summary, ...a.body.map(blockText), ...a.meaning].join(' ')
  return text.split(/\s+/).filter(Boolean).length
}

export function readingMinutes(a: Article): number {
  return Math.max(1, Math.round(articleWordCount(a) / WPM))
}

export function articleToc(a: Article): { id: string; text: string }[] {
  return a.body.filter((b): b is Extract<ArticleBlock, { type: 'h2' }> => b.type === 'h2').map(({ id, text }) => ({ id, text }))
}

/** Simple client-side search over the launch articles (title, summary, keywords, body). */
export function searchArticles(query: string, category: KnowledgeCategory | 'all' = 'all'): Article[] {
  const q = query.trim().toLowerCase()
  const terms = q.split(/\s+/).filter(Boolean)
  return ARTICLES.filter((a) => {
    if (category !== 'all' && a.category !== category) return false
    if (terms.length === 0) return true
    const hay = [a.title, a.summary, a.keywords.join(' '), ...a.body.map(blockText)].join(' ').toLowerCase()
    return terms.every((term) => hay.includes(term))
  })
}
