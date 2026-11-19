# Search performance monitoring — Google Search Console (and Bing Webmaster Tools)

Prepared 2026-11-19 (Phase 3). **No Search Console data exists yet** for `tmistan.com` — the
property has not been verified by the owner at the time of writing — so this document is the
set-up procedure, the numbers the reports *should* show given the current build, and the
monitoring routine. Nothing below is a measurement.

## 1. Set-up (owner, once)

| Step | Where | Notes |
|---|---|---|
| Create a **Domain property** `tmistan.com` | search.google.com/search-console → Add property → *Domain* | Covers `https://`, `http://`, `www.` and all paths (`/fa/`, `/ps/`) in one property. Verification is a DNS TXT record at the registrar. |
| (Alternative) URL-prefix property `https://tmistan.com/` | same | Can be verified with the HTML meta tag: set `SITE_GOOGLE_SITE_VERIFICATION` in Render → Environment and redeploy; `web/vite-plugins/siteVerification.ts` injects `<meta name="google-site-verification">` into every page. Also add the `www`/`http` variants or you will miss traffic. |
| Submit the sitemap | Indexing → Sitemaps → `https://tmistan.com/sitemap.xml` | It is a sitemap **index**; Search Console lists the child files (`sitemap-pages.xml`, `sitemap-records-1.xml`) under it after the first fetch. `robots.txt` also points at it. |
| Bing Webmaster Tools | bing.com/webmasters → *Import from Google Search Console* (after step 1) or verify with `SITE_BING_SITE_VERIFICATION` (same plugin) | Submit the same sitemap URL. Bing also powers DuckDuckGo/Yahoo results. |
| Link GA4 | Search Console → Settings → Associations → GA4 property of `G-L58MHTQERR` | Enables the *Search Console* collection in GA4 reports (queries + landing pages next to engagement). |
| Users | Settings → Users and permissions | Add the Masnad/TMistan maintainers as *Full* users so the monthly review does not depend on one account. |

## 2. What the reports should show for the current build

Numbers from the production build of 2026-11-19 (`npm run check`, `node scripts/seo-check.mjs dist`)
— compare the first *Pages* (Indexing) report against these:

| Measure | Expected | Source |
|---|---|---|
| URLs in sitemaps | **3,673** = 78 static pages (14 pages × 3 languages + 11 guides + 25 Knowledge Center articles) + 3,595 trademark records | `sitemap-pages.xml`, `sitemap-records-1.xml` |
| Indexed pages (steady state) | approaches 3,673; records make up 98 % | — |
| "Alternate page with proper canonical tag" | ~72 (Dari/Pashto copies of guides/articles) + any `/fa/trademark/…`, `/ps/trademark/…` URLs Google discovers | by design (`canonical: 'english'`) |
| "Excluded by 'noindex' tag" | the 1,118 records that fail the indexing policy (served by the SPA shell with `noindex,follow`), search-result URLs (`/?q=…`), image-search URLs, 404s | `web/src/seo/recordPolicy.ts`, `docs/audit/INDEXING_AUDIT.md` |
| "Blocked by robots.txt" | `/admin/*` only | `robots.txt` |
| "Not found (404)" | should stay near zero — the server returns the SPA shell with HTTP 200 for unknown URLs, so Google reports those as *soft 404* instead | watch *Soft 404* |
| hreflang errors (International targeting is gone; check *Page indexing* details and the hreflang report in Bing) | none: 42 pages (14 × 3) carry reciprocal `en` / `fa-AF` / `ps-AF` / `x-default` sets; records, guides and articles carry none (English canonical) | `scripts/seo-check.mjs` verifies reciprocity on every build |
| Sitemap *lastmod* | records: `updated_at` of the row; static pages: hand-maintained dates in `web/src/seo/routes.ts` | bump when content changes materially |

If *Pages* shows "Crawled – currently not indexed" for many record URLs, that is Google's quality
judgement on thin pages, not a technical fault: see the thin-content section of
`docs/SEO_PHASE3_REPORT.md` (465 indexable records whose goods text is "Not Specified").

## 3. Performance report — how to read it for this site

Open **Performance → Search results**, date range *last 3 months*, compare with the previous period.

| Question | Filter / breakdown | What to look for |
|---|---|---|
| Overall demand | Totals: impressions, clicks, average CTR, average position | Impressions grow first (indexing), clicks follow. Establish the baseline in month 1; targets in §5. |
| Record pages vs. editorial pages | *Page* → contains `/trademark/` vs. `/guides/` vs. `/knowledge-center/` | Records should dominate impressions (brand/mark-name queries); guides and articles should win informational queries (“trademark registration afghanistan”, “ثبت علامت تجارتی”). |
| Language performance | *Page* → contains `/fa/` ; contains `/ps/` ; neither (English) | Only the 14 translated static pages have `/fa/`/`/ps/` URLs that can rank. Record pages are English URLs, so Dari/Pashto *queries* that land on records show under English pages — use the *Query* breakdown with Arabic-script filters instead of the URL. |
| Country performance | *Country* → Afghanistan, Iran, Pakistan, India, United States, UAE, Turkey, China | Afghanistan + the diaspora/trading partners should lead. A country with impressions but very low CTR usually means titles in the wrong language for that audience. |
| Branded vs. non-branded | *Query* → contains `tmistan` / `masnad` (branded) vs. the rest | Non-branded share is the growth metric. |
| Mark-name queries | *Query* → regex `^[A-Z0-9 &'-]{2,}$` is not supported — instead sort queries by impressions and look at those landing on `/trademark/` | Confirms whether record pages are found for the mark names they carry. |
| Position buckets | Add *Average position*; filter position > 10 with impressions > 50 | Page-2 pages with impressions are the cheapest wins: improve the title/description of those exact URLs. |
| Devices | *Device* | Afghanistan traffic is mobile-first; a mobile CTR much lower than desktop points at title truncation (60 characters) — record titles are shortened for marks > 60 characters since Phase 3. |
| Search appearance | *Search appearance* → *Breadcrumbs*, *FAQ*, *Sitelinks searchbox* | Shows whether the structured data (`BreadcrumbList`, `FAQPage` on guides, `WebSite` SearchAction on the home page) is being used. |

Export: the *Export → Google Sheets* button on any view; the monthly routine below assumes a sheet
with one tab per month (totals, top pages, top queries, countries, languages).

## 4. Companion reports

* **Core Web Vitals** (Experience): field data appears only once the site has enough Chrome
  users; until then use PageSpeed Insights on `https://tmistan.com/`, a record page and a guide.
  The record page's largest element is the trademark image (Phase 3 fixed the image staying hidden
  when it loaded before hydration) — LCP should be the image or the `<h1>`.
* **HTTPS / Mobile usability**: no action expected (Render serves HTTPS; the layout is responsive;
  Phase 3 smoke tests run at 390 px).
* **Enhancements → Breadcrumbs / FAQ**: should list the record pages and guides without errors.
* **Links**: *Top linked pages — internally* should put `/`, `/guides`, `/knowledge-center` and the
  most-linked record pages (via "similar trademarks") first. External links: watch for the first
  referring domains (IP blogs, WIPO directories, Masnad's own site).
* **Removals**: use only for emergency take-downs of a record (then also unpublish it in the admin
  so it is not re-indexed).
* **Settings → Crawl stats**: total crawl requests per day, average response time; a sudden
  rise after a deploy means Google recrawls the whole sitemap (`lastmod` changed), which is fine.

## 5. Monthly routine and measurable objectives

Checklist (≈30 minutes, first working day of the month):

1. *Pages*: indexed count vs. expected (§2); open every new *error* or *soft 404* reason; confirm
   the sitemap status is *Success* and *Discovered URLs* = 3,673 (or the new count after a
   data import — `npm run check` prints it).
2. *Performance*: record totals, top 20 queries, top 20 pages, countries, device split in the
   sheet; note month-over-month change.
3. Pick the five pages with impressions > 100 and CTR below 1 % → rewrite their title/description
   (static pages in `web/src/i18n/locales/*.json`, guides/articles in `web/src/content/`).
4. Pick the five queries with position 8–20 and impressions > 50 → decide whether an existing
   guide/article can be strengthened (no new thin pages).
5. Core Web Vitals / PageSpeed spot check on three URLs; *Enhancements* for new errors.
6. Record the GA4 counterpart (consented sessions, `view_search_results`, `view_record`,
   `contact_enquiry`) next to the Search Console numbers so CTR → engagement → enquiry can be read
   as one funnel. GA4 only counts visitors who accepted analytics, so treat it as a sample, not a
   census.

Objectives — to be confirmed against the first real baseline (no Search Console data exists yet;
these are targets, not forecasts):

| Horizon | Objective | How it is measured |
|---|---|---|
| Month 1 | Property verified, sitemap *Success*, ≥ 90 % of sitemap URLs *Discovered*, zero hreflang/structured-data errors | Indexing → Sitemaps / Pages / Enhancements |
| Month 3 | ≥ 70 % of the 3,673 sitemap URLs *Indexed*; every guide and article indexed; at least one non-branded informational query on page 1 in each language | Pages report; Performance → Query |
| Month 6 | Record pages receiving impressions for ≥ 1,000 distinct mark-name queries; overall CTR ≥ 2 % for positions 1–10; Afghanistan, Pakistan and Iran among the top-5 countries | Performance report filters |
| Month 6 | Backfilled publication dates for gazettes 1344/1437 raise the sitemap to ≈ 4,200 record URLs | `npm run check` output + Sitemaps report |
| Ongoing | Zero *Blocked by robots.txt* outside `/admin`, zero *Server error (5xx)*, soft 404 < 20 URLs | Pages report |

## 6. Reference: how the site is built for Search Console

* Canonical origin `https://tmistan.com`; English without prefix, Dari `/fa/…`, Pashto `/ps/…`.
* Translated pages: self-canonical + reciprocal hreflang (`en`, `fa-AF`, `ps-AF`, `x-default` = English).
* Records, guides, articles: English URL canonical for every language; no hreflang; Dari/Pashto
  copies are prerendered (since Phase 3) but not listed in the sitemap.
* Non-indexable URLs are served by the SPA shell (`/app.html` rewrite on Render) and set
  `noindex,follow` client-side; `/admin` is disallowed in `robots.txt` and `noindex,nofollow`.
* `node scripts/seo-check.mjs dist` (run from `web/` after a build) re-verifies all of the above
  — canonical/hreflang reciprocity, sitemap ↔ indexable pages, titles/descriptions, images,
  JSON-LD, internal links — and exits 1 on any defect.
