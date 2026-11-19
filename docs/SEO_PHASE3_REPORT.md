# TMistan — Phase 3 report: SEO performance, search analytics & data quality

Date: 2026-11-19 · Scope: tmistan.com (production data read-only; code in this repository) ·
Baseline commit `97e0ed8` (Phase 2 + consent-first GTM) → this commit.

> **No Search Console or GA4 data exists yet.** The Search Console property has not been verified
> and the GA4 property in the GTM container has only been receiving consented page views since
> 2026-11-19. Every number in this report is therefore measured from the database, the build output
> or browser tests — none is a ranking, traffic or impression figure, and no improvement in rankings
> is claimed. Section 7 defines how success will be measured once data arrives.

## 1. Executive summary

| Area | Finding | Action taken | Owner follow-up |
|---|---|---|---|
| Indexing coverage | 3,595 of 4,713 published records (76.3 %) are indexable; of the 1,118 excluded, **684 are missing a publication date, all in gazettes 1344 and 1437** (an import omission), 495 are change notices (correctly excluded), the rest lack classes/mark name/goods/applicant | Audit script + report (`docs/audit/`); policy left unchanged (evidence supports it) | Backfill the publication date of gazettes 1344/1437 → ≈ +606 indexable records (+17 %) |
| Record page quality | 55 groups of same-mark filings shared an identical meta description; 20 % of record titles exceed 70 characters because of long mark names | Serial number added to every record description (0 duplicates now); titles shorten marks > 60 chars | — |
| Page speed / UX defect | On slow connections the **record's trademark image never appeared** (React does not replay `load` events for images that finish before hydration; the component hid the image with `opacity-0` until `onLoad`) | `TrademarkImage` fixed (skeleton behind the image + `img.complete` check); Playwright test with delayed JS passes | — |
| Image weight | Header/footer logo was a 1,600 px, 105 KB PNG on every page, preloaded | 480 px derivatives (26 KB) for header/footer; originals kept for OG/JSON-LD/PDF | 539 of 4,687 trademark images > 300 KB — storage-side re-encode (optional) |
| Internal linking / crawlability | 104 links on Dari/Pashto pages pointed at `/fa|/ps` article and guide URLs that were **not prerendered** (served by the JS shell, canonical only after rendering) | Those 72 pages are now prerendered with their canonical to the English URL; not in the sitemap | — |
| Metadata | 5 early Knowledge Center articles used generic 70–80-character summaries as description | Specific `metaDescription`s added | — |
| Search analytics | Only page views were measured | 13 consent-gated interaction events with a documented, privacy-reviewed taxonomy; GTM configuration steps; privacy notice/policy text updated in 3 languages | Create the GA4 event tag and custom dimensions in GTM/GA4 (`docs/ANALYTICS.md`) |
| Search Console | Not set up | `docs/SEARCH_CONSOLE.md`: set-up, expected numbers for the current build, how to read each report for this site, monthly routine, objectives | Verify the domain property, submit `sitemap.xml`, link GA4 |
| Verification tooling | Manual spot checks only | `web/scripts/seo-check.mjs` (3,745 pages in ~4 s, exit 1 on defects) added to the checklist | Run after every build |

## 2. Trademark indexing audit (task 1)

Method: `web/scripts/indexing-audit.ts` reads all published records and image rows through
PostgREST with the publishable key (read-only; the script refuses secret keys) and applies the
very same `recordIndexDecision()` the site uses for `<meta robots>`, the prerender list and the
sitemap. Output: `docs/audit/INDEXING_AUDIT.md` (tables), `excluded-records.csv` (1,118 rows, no
names/addresses), `indexing-audit.json`. Analysis: `docs/audit/README.md`.

**Result.** Published 4,713 · indexable 3,595 (76.3 %) · excluded 1,118 (23.7 %). Every indexable
record has an image. Causes (a record may fail several rules; "only" = sole cause):

| Rule failed | Records | Only cause | Category |
|---|---|---|---|
| no publication date | 684 | 606 | **missing field — import omission** (gazettes 1344: 526 rows, 1437: 158 rows; NULL on 100 % of their rows, while every other gazette has one consistent date) |
| not a registration notice | 495 | 320 | **by design** (assignments 171, owner address changes 148, owner name changes 86, name+address 41, renewals 38, mergers 5, cancellations 6) |
| no classes | 165 | 8 | missing field (86 from the 2026-10-18 batch) |
| mark name = serial | 26 | 0 | placeholder rows (2026-10-18 batch; all also lack classes) |
| no goods | 21 | 1 | missing field |
| no applicant | 6 | 6 | missing field |

Images: 26 records lack an image, all excluded for other reasons too — images are **not** a cause
of exclusion. `objection_deadline` is NULL on all 4,713 rows (unused by any importer).

**Policy verdict — unchanged.** The evidence does not support relaxing any rule: the largest group
is a fixable data gap (one date per gazette), and the change notices are thin pages whose
underlying registration is usually not on the site (only 37 of 495 share a mark name with a
registration record). Thin-content watch list for Search Console: 465 indexable records with goods
"Not Specified" and 868 with goods text under ~20 characters.

**Near-duplicates.** 308 groups of indexable records share mark + applicant (955 records) — genuine
separate filings (own serial, class or gazette). Their pages differed only by serial/class; the
description change in §4 makes each unique.

## 3. Search analytics strategy (task 2)

Design principles (unchanged from the GTM phase): consent-first (nothing is requested from Google
before "Allow analytics"; events before consent are dropped, never queued), nothing on `/admin`,
identifiers and counts instead of free text, and no personal data. Implementation:
`track()` in `web/src/seo/analytics.ts`; events listed with parameters and sources in
`docs/ANALYTICS.md` → "Interaction events".

| Requested measurement | Event(s) | Privacy handling |
|---|---|---|
| Search submissions | `view_search_results` (per distinct URL state with results), `search_error` | The only free text is the mark-name query, via `sanitizeSearchTerm()`: trimmed, ≤ 80 chars, **dropped** if it contains `@`, a URL or 8+ digits (e-mails, phone/ID numbers). Filter *names* are sent (`search_fields=q,classes,gazette`), never applicant/owner values. |
| Search result interactions | `select_result` (serial, 1-based position, page, view / image match group) | identifiers only |
| Trademark record views | `view_record` (serial, gazette, type, indexable yes/no, has image, class count) | identifiers only |
| Image-search usage | `image_search` (upload/example, option, intelligent/basic + reason, text recognised yes/no, bucketed result count and duration), `image_search_error` | the picture and the recognised words never leave the browser |
| Language selection | `language_select` (from, to, header/mobile) — pushed before the full-page navigation | — |
| Report downloads | `report_download` / `report_download_error` (serial, gazette, `pdf`) | — |
| Contact & service enquiries | `contact_enquiry` (type, submitted/failed), `correction_request` (status, has attachment), `contact_click` (email/phone, footer/contact page), `cta_click` (services page CTAs) | form contents, names and e-mail addresses are never sent |

Verified with Playwright against the production build (`/tmp/events_smoke.py`, 17 checks): one
`view_search_results` per search with sanitised term; e-mail-like, phone-like and over-long queries
are not reported; `select_result` position 1 + `view_record` with exactly the documented keys; no
events without consent, with consent denied, or on `/admin`; `language_select` captured before
navigation; `cta_click`; a real PDF download produces `report_download`; `image_search` +
`select_result` (image) in a second script. The existing 36-check GTM suite still passes.

Disclosure: the consent notice and the Privacy Policy's analytics paragraph (en/fa/ps) now say that
records opened and features used are counted and that form contents, images and e-mail addresses
are not.

Owner steps (10 minutes in GTM, `docs/ANALYTICS.md`): one Custom-Event trigger (regex of the 13
event names), one GA4 event tag with `{{Event}}` as the event name and the listed Data Layer
Variables, custom dimensions/metrics in GA4, mark `contact_enquiry`, `correction_request`,
`report_download` as key events.

## 4. Technical and multilingual SEO audit (tasks 4 & 5)

Tool: `web/scripts/seo-check.mjs` over the final `dist` (3,745 HTML pages, 120,704 internal links,
14,722 `<img>`, 7,520 JSON-LD blocks). **Result after the changes: 0 errors**; warnings are
long-title/description notices and one identical title on hreflang alternates (below).

| Check | Before Phase 3 | After |
|---|---|---|
| Canonical: exactly one, absolute on `https://tmistan.com`, self or English | OK on every page | OK |
| hreflang: complete (`en`, `fa-AF`, `ps-AF`, `x-default`) and reciprocal on all 42 translated pages; none on noindex/English-canonical pages | OK | OK |
| `<html lang>`/`dir` matches the URL language | OK | OK |
| One `<title>`, one description, one `<h1>` per page; `img` alt; JSON-LD parses with `@type` | OK | OK |
| Sitemap = indexable self-canonical pages (3,673), no noindex/canonicalised URLs in it; robots.txt points at it and disallows `/admin` | OK | OK |
| Internal links resolve to prerendered HTML | **104 links → 72 non-prerendered `/fa|/ps` article & guide URLs** | prerendered copies, canonical → English, not in sitemap |
| Duplicate descriptions across different canonicals | **55 groups** (same-mark filings) | 0 |
| Duplicate titles across different canonicals | 1 (`/fa` and `/ps` disclaimer pages — same loanword "سلب مسئولیت"; hreflang alternates, harmless) | unchanged, reported as warning |
| Record titles > 70 chars | 728 of 3,595 (20 %); max 115 | marks > 60 chars shortened in the `<title>` only (50 pages > 90 chars affected); the H1, description and structured data keep the full name |
| Descriptions > 170 chars | 2,937 (median 193) — the record template carries mark, serial, gazette, date (Gregorian + Solar Hijri), applicant, class and goods | goods excerpt reduced from 110 to 90 chars; serial added for uniqueness; median 203 — accepted: search engines truncate, the ordering puts the distinctive part first |
| Thin descriptions | 5 articles with generic 70–80-char summaries | specific `metaDescription`s |

Mobile usability: Playwright at 390 px on home (with consent bar), record page and a Dari guide —
no horizontal overflow; screenshots reviewed. Structured data unchanged from Phase 2
(`WebSite`+`SearchAction`, `Organization`, record `WebPage`/`CreativeWork`, `BreadcrumbList`,
`Article`, `FAQPage`, `CollectionPage`), all blocks parse.

**Page speed (measured from the build, not from the field):**

* Record page initial JavaScript: 921 KB raw / **≈ 277 KB gzip** (app 118, React 72, Supabase 50,
  i18n 19, utils 10, shared 8); CSS 103 KB / 17 KB gzip. Dari/Pashto bundles (≈ 200 KB each),
  the PDF engine (1.16 MB) and the OCR engine (3.8 MB) are lazy chunks and never load on a plain
  page view. Page HTML: home 79 KB, record 31 KB.
* LCP candidate on a record page is the trademark image (`fetchPriority="high"` + preload). **Defect
  found and fixed:** the image was rendered with `opacity-0` until React's `onLoad`; when the image
  finished before hydration (delayed JS in the test, i.e. any slow connection) it stayed invisible
  under the skeleton permanently. Now the skeleton sits behind the image, the image is never hidden,
  and `img.complete` is checked after mount. Test: image visible before and after late hydration,
  skeleton removed.
* Logo: 1,600×820 PNG (105 KB, preloaded on every page, shown at 40 px) → 480 px derivatives
  (26 KB) in header/footer; ≈ 160 KB less per page view (header + footer).
* Trademark images: 539 of 4,687 originals > 300 KB and 132 > 1,600 px. Lists use the 320 px WebP
  thumbnails; only the record page loads the original. Optional storage-side optimisation (re-encode
  originals to ≤ 1,600 px WebP in the image importer) — not a site change, not done here.

**Multilingual review (en / Dari / Pashto):** titles and descriptions of the 14 translated static
pages are distinct per language (one exception above), canonicals self-referencing, hreflang sets
complete and reciprocal, `x-default` = English, `dir="rtl"` on `/fa` and `/ps`. Records, guides and
articles are English-canonical by design (content not translated); their Dari/Pashto copies now
exist as real HTML with that canonical, so a Dari reader following a link gets the Dari chrome and
search engines get an explicit canonical without executing JavaScript. The Pashto disclaimer title
uses the same term as Dari ("سلب مسئولیت") — a vocabulary fact, not an error; left as is.

## 5. Search performance monitoring (task 3)

`docs/SEARCH_CONSOLE.md` prepares the owner for Search Console and Bing Webmaster Tools: domain
property + DNS verification (or the already-built `SITE_GOOGLE_SITE_VERIFICATION` meta-tag path),
sitemap index submission, GA4 association; the numbers each report should show for this build
(3,673 sitemap URLs; ≈ 72 "alternate page with proper canonical"; 1,118 noindex records + search
URLs under "excluded by noindex"; `/admin` blocked); how to break down impressions/clicks/CTR/
position by record vs. editorial pages, by `/fa/`–`/ps/` paths and by Arabic-script queries, by
country (AF, IR, PK, IN, US, AE, TR, CN) and device; Core Web Vitals, Enhancements, Links and
Crawl-stats expectations; a 30-minute monthly checklist; and measurable objectives.

## 6. Changes in this commit

Code (architecture and data model unchanged; no database change):

* `web/scripts/indexing-audit.ts` (new), `web/scripts/seo-check.mjs` (new), `docs/audit/*` (new).
* `web/src/seo/analytics.ts`: `track()`, event types, `sanitizeSearchTerm()`, buckets; page-view
  `search_term` now sanitised too.
* Event wiring: `SearchExperience.tsx`, `ResultCards.tsx` (optional `onSelect`),
  `ImageSearchResults.tsx`, `useImageSearch.ts`, `TrademarkPage.tsx`, `Layout.tsx`, `ContactPage.tsx`,
  `DataCorrectionsPage.tsx`, `ServicesPage.tsx`.
* `TrademarkImage.tsx`: load-state fix (see §4). `Logo.tsx` + `public/brand/*-480.png`.
* `scripts/prerender.mjs`: Dari/Pashto copies of English-canonical pages (72), not in the sitemap.
* `TrademarkPage.tsx` + `locales/{en,fa,ps}.json`: record description with serial, 90-char goods
  excerpt, 60-char mark cap in `<title>`; consent notice and privacy policy text.
* `content/knowledge.ts`: 5 `metaDescription`s.
* Docs: `ANALYTICS.md` (events + GTM steps), `SEO.md` (§10 Phase 3, checker in checklist),
  `SEARCH_CONSOLE.md`, `README.md`, this report.

Validation: `npm run check` exit 0 (typecheck, lint 14 warnings/0 errors as before, build, prerender
3,673 pages + 72 copies, 2 sitemap files + index, robots.txt); `seo-check.mjs` 0 errors; GTM smoke
36/36; events smoke 17/17 (+ image-search script 2/2); no secrets in `dist`; Playwright mobile
screenshots.

## 7. Priorities and measurable objectives

Priorities (impact ÷ effort):

1. **Owner — backfill `publication_date` for gazettes 1344 and 1437** (admin edit or corrected
   spreadsheet import). Measurable: `npm run check` reports ≈ 4,200 record pages (today 3,595);
   Search Console sitemap *Discovered* rises accordingly.
2. **Owner — verify Search Console (domain property), submit `sitemap.xml`, link GA4, import into
   Bing.** Measurable: sitemap status *Success*, ≥ 90 % of 3,673 URLs discovered within 4 weeks,
   zero hreflang / structured-data errors.
3. **Owner — GTM: event trigger + GA4 event tag + custom dimensions; key events.** Measurable: GA4
   DebugView shows one event per interaction; the *Site search* report fills from `search_term`.
4. **Monthly routine** (`docs/SEARCH_CONSOLE.md` §5): fix titles/descriptions of pages with
   impressions > 100 and CTR < 1 %; strengthen existing guides for page-2 queries; watch
   "Crawled – currently not indexed" on the thin-record list.
5. Data team — complete or unpublish the 2026-10-18 placeholder rows (26 no-name, 86 no-class).
6. Optional engineering — re-encode the 539 large trademark originals in storage; consider a
   dedicated notice page type if change notices should ever be indexable.

Objectives (targets, to be confirmed against the first real baseline — no forecasts implied):

| Horizon | Objective | Measured by |
|---|---|---|
| Month 1 | Search Console live; sitemap processed; GA4 events flowing; 0 technical errors | Indexing → Sitemaps/Pages/Enhancements; GA4 DebugView |
| Month 3 | ≥ 70 % of sitemap URLs indexed; all 36 guides/articles indexed; ≥ 1 non-branded informational query on page 1 per language | Pages report; Performance → Query |
| Month 6 | Impressions for ≥ 1,000 distinct mark-name queries on record pages; CTR ≥ 2 % for positions 1–10; AF/PK/IR in the top-5 countries; sitemap ≈ 4,200 records after the backfill | Performance filters; Sitemaps |
| Ongoing | Soft 404 < 20 URLs; 0 pages blocked by robots.txt outside `/admin`; `seo-check.mjs` 0 errors on every build; consented `view_search_results → select_result → view_record → contact_enquiry` funnel reported monthly | Pages report; CI/checklist; GA4 Explorations |
