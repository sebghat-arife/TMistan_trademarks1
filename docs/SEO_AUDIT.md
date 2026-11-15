# SEO audit — TMistan (tmistan.com), 2026-11-15

Scope: the live Render static site at commit `d8bcdf5`, the source tree, and Render/Supabase
behaviour that affects crawling. Findings are listed with the fix shipped in the same change set.
Operating documentation is in `docs/SEO.md`.

## A. Findings on the live site (before)

| # | Finding | Evidence | Impact | Status |
|---|---|---|---|---|
| 1 | Every URL returned the same empty SPA shell (`<div id="root"></div>`); content existed only after JavaScript ran | `curl https://tmistan.com/trademark/1011-002` → generic `index.html` | Crawlers and link previews saw no page-specific content; indexing depended on JS rendering | **Fixed** — build-time prerender of all public pages + eligible records |
| 2 | No `<link rel="canonical">`, no Open Graph / Twitter tags, no `hreflang`, no JSON-LD | head of the shell | Duplicate-content risk (`?lang=`, `www.`), poor social previews, no entity data | **Fixed** — single head manager (`web/src/seo`) |
| 3 | `/robots.txt` → 404, no sitemap | `curl -I /robots.txt` | Search engines had no discovery path beyond links; admin area not excluded | **Fixed** — generated `robots.txt`, sitemap index + parts |
| 4 | Language was a query parameter (`?lang=fa`) and a `localStorage` preference; the same URL could render three languages | `web/src/i18n` | Un-indexable translations; inconsistent snapshots | **Fixed** — path-based locales `/fa`, `/ps`; legacy `?lang=` redirects |
| 5 | `www.tmistan.com` 301 → `https://tmistan.com`, but the app's default canonical origin was `https://www.tmistan.com` | live redirect vs `web/src/lib/site.ts` | Would have emitted canonicals pointing at a redirecting host | **Fixed** — default canonical origin is the apex (`SITE_CANONICAL_URL` overrides). *Assumption to confirm with the owner: apex is the preferred host* |
| 6 | Unknown URLs returned HTTP 200 with the shell (static host rewrite) — no 404 status possible | `curl -I /this-does-not-exist` → 200 | Soft-404 risk | **Mitigated** — dedicated not-found view with `noindex,follow`; a true 404 status is impossible on a static-site rewrite (documented) |
| 7 | Main JS bundle 743 kB (incl. Tesseract.js loaded on every page) | `dist/assets/index-*.js` | Slow first render, poorer Core Web Vitals | **Fixed** — Tesseract lazy-loaded, fa/ps bundles lazy, content chunked → 398 kB |
| 8 | `/admin/*` pages were crawlable (no robots directive) | source | Risk of admin login pages in the index | **Fixed** — `noindex,nofollow` meta + `X-Robots-Tag` header |
| 9 | Record pages had no policy on which of the 4 029 records deserve indexing | — | Thousands of thin or near-duplicate pages (change notices without a mark name, etc.) | **Fixed** — `recordPolicy.ts`: 3 595 indexable, 434 `noindex,follow` |
| 10 | Knowledge Center had 6 articles, all product-usage guides; no coverage of Afghan trademark law, procedure, treaties — the queries a trademark researcher actually types | content inventory | Little topical authority for "trademark Afghanistan" queries | **Fixed** — 15 sourced articles (law, opposition, renewal, Madrid, treaties, classes, clearance, glossary) |
| 11 | Unused dependency `i18next-browser-languagedetector` | `package.json` | Dead weight | **Fixed** — removed |

## B. What was *not* a problem

* HTTPS, HSTS-compatible setup and security headers on Render — fine.
* Mobile layout, RTL support and font loading — fine (self-hosted variable fonts).
* No duplicate H1s, no hidden text, no keyword stuffing; the client-mandated wording is unchanged.
* Image `alt` text on trademark images uses the published mark name; decorative art is `aria-hidden`.

## C. Decisions (and the alternatives considered)

1. **Prerender at build time, not SSR.** The client requires a static site on Render; a Node SSR
   service would add cost, a second deployment and a failure mode. Prerendering 3 655 pages costs
   ≈ 45 s per build and ≈ 120 MB of disk, both acceptable. Records are read with the **publishable**
   key through RLS, so the build exposes nothing that the public API does not.
2. **Hydration instead of re-mounting.** Prerendered pages are hydrated (`data-prerendered` marker
   equals the current path and there is no query string); otherwise the app mounts normally. All
   browser-only state (announcement/consent bars, stored language) is read behind `useIsClient` so
   server and first client render match — the smoke test asserts "no hydration warnings".
3. **Path-based locales with English at the root.** `/fa` and `/ps` prefixes, `x-default` →
   English. The first-visit language redirect runs only in the browser and only when a preference
   is stored or the browser language is Dari/Pashto; crawlers are never redirected.
4. **Apex canonical.** The live infrastructure already redirects `www.` → apex, so the apex is
   canonical; flagged as an assumption because the code previously defaulted to `www`.
5. **Records: index only self-sufficient registration pages.** Avoids thin content without
   creating a browse-all directory (which the client excluded). Change notices stay searchable.
6. **No fake 404 status.** Static hosts cannot return 404 for rewritten paths. The not-found view
   is `noindex,follow` and there are no internal links to unknown URLs.
7. **GA4 only with consent and only when configured.** No tracking by default.
8. **Legal content strictly sourced.** Every statement about Afghan law in the new articles is
   tied to an article number of the official English translation of the 2009 law (Official
   Gazette No. 995) or to WIPO Lex treaty dates; practitioner claims are labelled as such; no fee
   amounts, no processing times beyond statutory ones, no status claims about any mark.

## D. Measured after the change (local build of `dist/`, served with Render-like rules)

* 60 static pages (20 × 3 languages, incl. 21 Knowledge Center articles in English) + 3 595 record
  pages prerendered; sitemap index + `sitemap-pages.xml` + `sitemap-records-1.xml`; `robots.txt`.
* Home: title "TMistan – Afghanistan Trademark Search & Research Platform", canonical
  `https://tmistan.com/`, 4 hreflang links, `Organization` + `WebSite` JSON-LD.
* Record `1011-002`: title "Caravell (1011-002) – Afghanistan Trademark Record | TMistan",
  canonical English, `ItemPage` JSON-LD, no robots tag (indexable).
* Main bundle 398 kB (124 kB gzip) vs 743 kB; fa/ps bundles 188 kB each, loaded on demand;
  Knowledge Center content 107 kB chunk.
* Playwright smoke suite: 48 checks (head tags, hydration, language switching and redirects,
  robots directives, 404 view, mobile overflow, Knowledge Center law series) — all passing.
* Secret scan of `dist/`: no `sb_secret_` / `service_role` strings.

## E. Owner actions after deploy

1. If the Render service was created by hand, change the rewrite destination from `/index.html`
   to **`/app.html`** (Dashboard → Redirects/Rewrites). The Blueprint (`render.yaml`) already has it.
2. Confirm the canonical host (apex `tmistan.com`). To use `www.` instead, set
   `SITE_CANONICAL_URL=https://www.tmistan.com` and flip the DNS/Render redirect direction.
3. Verify the property in Google Search Console and Bing Webmaster Tools; submit
   `https://tmistan.com/sitemap.xml`.
4. Optionally set `SITE_GA4_MEASUREMENT_ID` (consent-gated analytics).
5. Re-run the build whenever the registry grows: new eligible records are prerendered and added to
   the sitemap automatically on the next deploy (Render redeploys on every push; a manual
   "Clear build cache & deploy" after a large import refreshes record pages without a code change).

## F. Known limits

* Record pages reflect the data at build time; the live page hydrates and re-fetches, so visitors
  always see current data, but crawlers see the snapshot from the last deploy.
* Static hosting cannot emit 404/410 status codes or `Vary: Accept-Language` redirects.
* Dari/Pashto article bodies are not translated (English only, canonicalised to English) — a
  future translation would simply turn `canonical: 'english'` off for those slugs.

## G. Phase 2 (2026-11-16) — measured on the local build

* 78 static pages (14 routes × 3 languages + 11 English guide pages + 25 English article pages) +
  3 595 record pages; `sitemap-pages.xml` lists all 78, `sitemap-records-1.xml` the records.
* Every guide and article has a unique `<title>` (≤ 65 characters before the brand suffix) and a
  meta description ≤ 160 characters; one `<h1>`, `h2`/`h3` outline, sources section with the official
  translation of the law and WIPO pages, `Article` (+ `FAQPage` on guides) + `BreadcrumbList` JSON-LD.
* Guide page `trademark-opposition-afghanistan`: ~1 400 words, 23 distinct internal link targets,
  external citations to wto.org / wipo.int.
* Record `1011-002`: image alt "Caravell – trademark image, Gazette Number 1011", "Understand this
  record" block with 4 educational links; attorney never rendered.
* Crawl paths: every article reachable from `/knowledge-center` (article index) and every guide from
  `/guides`, the home page and the footer; unknown `/guides/*` and `/knowledge-center/*` slugs show
  the not-found view with `noindex,follow`.
* Main bundle 386 kB (120 kB gzip) — smaller than after Phase 1 (398 kB) despite +15 pages of
  content, because the content modules are split out of the entry chunk.
* Playwright smoke suite: 64 checks (Phase 1 set + guides hub/page, Dari guide notice, article
  index, practice article structure, record alt/links, unknown-slug 404s) — all passing.
* Secret scan of `dist/`: clean. Verification meta tags absent without the env variables, present
  (and validated) with them.

Owner actions added: set `SITE_GOOGLE_SITE_VERIFICATION` (and optionally
`SITE_BING_SITE_VERIFICATION`) in the Render environment, redeploy, verify the property, submit
`https://tmistan.com/sitemap.xml`; the records sitemap grows automatically with each deploy.
