# SEO — how TMistan is made indexable (and how to keep it that way)

Implemented 2026-11-15. Read `docs/SEO_AUDIT.md` for the before/after findings and the decisions
behind this design. This page is the operating manual.

## 1. Architecture in one paragraph

TMistan stays a **static site on Render** (no server). `npm run build` runs `tsc -b`, `vite build`
and then `node scripts/prerender.mjs`, which renders every public page — in English, Dari and
Pashto — plus every *eligible* trademark record to real HTML files in `dist/`, and writes
`sitemap.xml`, the sitemap parts and `robots.txt`. A prerendered file carries the full `<head>`
(title, description, canonical, hreflang, Open Graph, JSON-LD) and the full page body, so crawlers
and link previews see content without executing JavaScript. The browser then **hydrates** the
prerendered page; any URL without a prerendered file (search results, ineligible records, admin,
unknown paths) is served the SPA shell `dist/app.html` through Render's rewrite rule and renders
client-side exactly as before.

```
URL requested            Render serves               why
/                        dist/index.html             prerendered (English home)
/fa  /ps                 dist/fa/index.html …        prerendered locale homes
/services, /fa/help …    dist/<locale>/<page>/index.html
/knowledge-center/<slug> dist/knowledge-center/<slug>/index.html   (English only, see §4)
/trademark/1011-002      dist/trademark/1011-002/index.html        (eligible records only)
/?q=nike  /trademark/<ineligible>  /admin/*  /anything-else
                         dist/app.html via rewrite   SPA renders; <Seo> sets head client-side
```

## 2. URL scheme and languages

| Language | URL form | `<html lang>` | hreflang | og:locale |
|---|---|---|---|---|
| English (default) | `/path` | `en` | `en` + `x-default` | `en_US` |
| Dari | `/fa/path` (home `/fa`) | `fa-AF`, `dir="rtl"` | `fa-AF` | `fa_AF` |
| Pashto | `/ps/path` (home `/ps`) | `ps-AF`, `dir="rtl"` | `ps-AF` | `ps_AF` |

* Canonicals are absolute, slash-less (except `/`), on the canonical origin (`SITE_CANONICAL_URL`,
  default `https://tmistan.com`; `www.` 301s to the apex at the DNS/Render level).
* Every page lists all three alternates plus `x-default` → English. Record pages and English-only
  Knowledge Center articles use **`canonical: 'english'`** — the `/fa` and `/ps` versions point
  their canonical at the English URL and are not prerendered or listed in the sitemap, because the
  record data (and the article bodies) are not translated.
* Language choice: the path is authoritative. The language switcher navigates to the alternate
  path and stores the choice (`localStorage.i18nextLng`). On a **first visit to a bare English
  path** with a stored or browser preference for `fa`/`ps`, `main.tsx` performs a client-side
  `location.replace` to the localized path — crawlers (no stored preference, `Accept-Language`
  not consulted) always get the English page they asked for. Legacy `?lang=fa|ps` URLs redirect to
  the path form. The old `/search` route redirects to `/` keeping the query.
* Helpers live in `web/src/seo/locales.ts` (`localizePath`, `splitLocalePath`, `alternatePaths`,
  `localeBasename`). React Router runs with `basename` = `/fa` or `/ps`, so in-app links stay
  in-language automatically.

## 3. Head management

`web/src/seo/head.ts` is a pure module (`buildHead`, `applyHead`, `headToHtml`) used both by the
browser and by the prerenderer. Pages call `<Seo …>` (`web/src/seo/Seo.tsx`) or the thinner
`<PageSeo seoKey path type …>` for translated static pages. There is exactly one head manager;
tags it owns are marked `data-seo` and replaced wholesale on navigation.

Robots rules (`robots` prop):

| Page | robots | in sitemap |
|---|---|---|
| Static public pages (3 languages) | index (no tag) | yes |
| Home with a query (`/?q=…`), Knowledge Center search | `noindex,follow` | — |
| Eligible record page | index | yes |
| Ineligible record page | `noindex,follow` | no |
| Not-found page | `noindex,follow` (served 200 by the static host; see audit) | — |
| `/admin/*` | `noindex,nofollow` meta **and** `X-Robots-Tag` header (render.yaml) | — |

Structured data (`web/src/seo/jsonld.ts`): `Organization` (`/#organization`, TMistan),
`Organization` (`/#masnad-law-firm`, the developer), `WebSite` with a `SearchAction` on `/?q={q}`,
`BreadcrumbList` on inner pages, `Article` (with `dateModified`) on Knowledge Center articles,
`ItemPage` + `Thing` (`PropertyValue` "TMistan Serial Number", class, Gazette number) on record
pages. Nothing in the JSON-LD claims legal status, government affiliation or completeness.

Default social image: `web/public/brand/og-default.png` (1200×630). Record pages use the mark image
when one exists.

## 4. Record indexing policy (`web/src/seo/recordPolicy.ts`)

TMistan does **not** publish a browse-all directory, and it does not offer thin pages to search
engines. A record page is indexable (robots index + prerendered + in the sitemap) only when it is a
*New Trademark Registration* with a real mark name, applicant, at least one class, goods/services
text, a publication date and a Gazette number. Change notices (assignment, address change, renewal,
cancellation, merger) and incomplete entries remain fully functional and reachable through search
but are `noindex,follow`. The one function `recordIndexDecision()` drives the page, the sitemap and
the prerender list, so the three cannot disagree. On 2026-11-15 this made 3 595 of 4 029 records
indexable (434 excluded).

Record titles follow `"<Mark> (<serial>) – Afghanistan Trademark Record | TMistan"`; descriptions
are composed from the published fields only (applicant, class, goods, Gazette number/page). Missing
values are omitted — never invented, never "N/A" in a meta tag.

## 5. Sitemaps and robots

Written by the prerenderer into `dist/`:

* `sitemap.xml` — index pointing at `sitemap-pages.xml` (all static pages, 3 languages, with
  `xhtml:link` alternates and hand-maintained `lastmod` from `web/src/seo/routes.ts` and article
  dates) and `sitemap-records-<n>.xml` (eligible records, ≤ 10 000 per file, `lastmod` = record
  update time).
* `robots.txt` — allows everything public, disallows `/admin/`, points at the sitemap. The former
  `mode=image` line was removed (image search is a client-side mode, not a crawlable resource).

Bump `SEO_RELEASE_DATE` / the per-route `lastmod` in `routes.ts` when a static page's content
changes materially; article dates come from `written`/`updated` in `web/src/content/knowledge*.ts`.

## 6. Build, environment and hosting

| Variable (build time) | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | required — the prerenderer reads the public records with the publishable key (RLS, read-only) |
| `SITE_CANONICAL_URL` | canonical origin; default `https://tmistan.com` |
| `SITE_GTM_CONTAINER_ID` | Google Tag Manager container; **default `GTM-T2SXFX3Q`** for production builds (no variable needed). Set to an empty string to ship without Tag Manager, or to another `GTM-…` id. The container (and the GA4 tag configured inside it) is loaded only once the visitor accepts the consent bar — see `docs/ANALYTICS.md` |
| `PRERENDER_ALLOW_PARTIAL=1` | emergency switch: build the static pages even if Supabase is unreachable (record pages/sitemap-records are skipped and a warning is printed). Do not use routinely |

* Build time: ≈ 45 s for the prerender (4 029 records read in pages of 1 000) on top of the Vite
  build; `dist/` ≈ 120 MB (3 655 HTML files). Both are within Render's static-site limits.
* **Render rewrite rule must target `/app.html`** (`render.yaml` is updated; a hand-made rule in
  the Dashboard must be changed from `/index.html` to `/app.html`). With `/index.html` as the
  destination, unknown URLs would receive the prerendered English home page instead of the SPA
  shell — the app would still work after hydration mismatch, but crawlers would see duplicate home
  pages.
* Render serves `dir/index.html` for both `/dir` and `/dir/` without redirecting; canonicals point
  at the slash-less form, so this is harmless.
* `npm run build:spa` builds without prerendering (local debugging only).
* Local verification: `node scripts/serve-dist.mjs 4180` serves `dist/` with Render-like rules
  (real files first, then `/app.html`).

## 7. Performance decisions that matter for SEO

* Dari/Pashto translation bundles are lazy chunks (`fa-*.js`, `ps-*.js`); English is inlined.
* Tesseract.js (image-search OCR) is a dynamic import — it was 350 kB of the old main bundle.
* Knowledge Center content is its own chunk.
* Main bundle after the change: ≈ 398 kB (124 kB gzip) vs 743 kB before.
* Images below the fold use `loading="lazy"`; the record's main image is `eager`.

## 8. Knowledge Center content rules

Articles live in `web/src/content/knowledge.ts` (launch series), `knowledgeLaw.ts`
(law & procedure series, 2026-11-15) and `knowledgePractice.ts` (practice series, 2026-11-16). Each legal article cites its sources in a `sources` block —
the official English translation of the Law on Trade Marks Registration (Official Gazette No. 995,
2009, as reproduced by the WTO), WIPO Lex, WIPO Madrid/Nice pages and, where practice rather than
statute is described, a clearly labelled practitioner source. Article bodies are English; titles and
summaries are translated in the locale files; fa/ps article URLs show an "English only" notice and
canonicalise to the English URL. Thumbnails for the legal series are typographic cards generated by
`tools/kc_cards/make_cards.py` (see `web/public/img/CREDITS.md`).

## 9. Phase 2 (2026-11-16): guides, practice articles, internal linking, verification

**Guides (`/guides`, `/guides/<slug>`).** Eleven educational landing pages — trademark search,
registration, availability search, clearance research, opposition, renewal & ownership changes,
classification, Nice classification, protection for foreign businesses, research for international
companies, law & regulations. Content: `web/src/content/guides.ts` (bodies, facts, FAQs, tools,
sources) and `guidesMeta.ts` (slug, titles, meta description, icon — a light module so the home page
can list guides without loading the bodies). Pages: `GuidesPage.tsx` (hub, fully translated,
`CollectionPage`), `GuidePage.tsx` (English body, `canonical: 'english'`, `Article` + `FAQPage` +
`BreadcrumbList` JSON-LD, key-facts panel, FAQ accordion, sources, tools, related articles/guides).
The hub is in `STATIC_ROUTES` (3 locales); guide pages are English-only `ENGLISH_PAGES`
(`entry-server.tsx`) prerendered and listed in `sitemap-pages.xml` with priority 0.7. Editorial
rules are the same as for the law series (official translation of the law cited by article, WIPO
Lex dates, practitioner facts labelled, no fees/times/government-relationship claims); a shared
`LEGAL_NOTE` is rendered on every guide.

**Knowledge Center.** Four practice articles were added in `knowledgePractice.ts` (reading a record
page, monitoring new publications, Dari/Pashto scripts & transliteration, geographical names);
articles may now carry `seoTitle`/`metaDescription` (used for `<title>`/description instead of the
display title/summary), `h3` blocks, inline links `[label](/path)` and `**bold**`
(`components/content/ContentBlocks.tsx`). The hub gained a complete **article index** grouped by
topic so every article is one plain link away from `/knowledge-center` (the topic filters are
client-side buttons and were not crawlable). Each article shows a "Start with the guide" aside
(`GUIDE_FOR_ARTICLE` / `GUIDE_FOR_CATEGORY` in `guides.ts`). Unknown article/guide slugs render the
not-found view (`noindex`) instead of redirecting to the hub.

**Internal linking.** Home "Learn" strip (6 guides + links to `/guides` and the Knowledge Center);
footer "Trademark Guides"; Knowledge Center quick link; guides ↔ articles ↔ guides cross-links;
record pages end with "Understand this record" (`learnLinks()` in `TrademarkPage.tsx`: field guide,
plus opposition / ownership-change / renewal links chosen by notice type, classification, search
guide). The header navigation is unchanged on purpose (client-mandated layout).

**Record pages.** The main image alt is now descriptive (`trademark.imageAlt`: "<mark> – trademark
image, Gazette Number <n>") and carries `fetchpriority="high"` (LCP). Indexing policy, titles and
descriptions are unchanged (`recordPolicy.ts`).

**Search-engine verification.** `SITE_GOOGLE_SITE_VERIFICATION` / `SITE_BING_SITE_VERIFICATION`
(raw token = the `content` value of the meta tag) are injected at build time by
`web/vite-plugins/siteVerification.ts` into `index.html`, hence into every prerendered page and the
SPA shell. Unset → nothing emitted. The plugin rejects a value that is not a bare token. Analytics
remain opt-in: every page carries the Consent Mode defaults and the Google Tag Manager loader
(`GTM-T2SXFX3Q`), but `gtm.js` is requested only after the visitor agrees (§6, `docs/ANALYTICS.md`).

**Bundles.** Main chunk 386 kB (120 kB gzip); guide bodies (75 kB), law series (74 kB) and launch
articles (57 kB) are separate chunks loaded only on those pages.

## 10. Checklist after any change

1. `cd web && npm run check` (typecheck, lint, full build incl. prerender) — needs the two Supabase
   variables in the environment (`web/.env.local` locally).
2. `grep -rl "sb_secret_\|service_role" web/dist/` → must print nothing.
3. Spot-check `dist/index.html`, `dist/fa/index.html`, one record page, one article, one guide:
   title, canonical, 4 hreflang links (translated pages) or none (English-only pages), JSON-LD.
4. `node scripts/serve-dist.mjs 4180` and run the Playwright smoke script (hydration warnings,
   language switching, redirects, robots tags).
5. After deploy: `curl -I https://tmistan.com/robots.txt`, `/sitemap.xml`, a record URL, and an
   unknown URL (should return the shell with the not-found view). Submit the sitemap in Google
   Search Console / Bing Webmaster Tools once (owner action).
