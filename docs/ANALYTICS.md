# Analytics — Google Tag Manager `GTM-T2SXFX3Q`

TMistan integrates Google Tag Manager **consent-first**: every page (prerendered pages and the SPA
shell alike) carries the Consent Mode v2 defaults and the official container loader, but `gtm.js`
is requested **only while analytics consent is granted** — immediately on a return visit with a
stored "granted" choice, otherwise the moment the visitor accepts the consent notice. Before that
nothing is requested from Google. Google Analytics 4 is **not** wired into the code: it is
configured inside the container, so the owner can change measurement IDs or add tags without a
deployment.

| Piece | Where | Behaviour |
|---|---|---|
| Consent defaults | `web/index.html` (first script in `<head>`) | `gtag('consent','default', …)`: `ad_storage`, `ad_user_data`, `ad_personalization` **denied**; `analytics_storage` **granted only if** `localStorage['tmistan.consent.analytics.v1'] === 'granted'` *and* the browser sends neither Do Not Track nor Global Privacy Control; `functionality_storage`/`security_storage` granted |
| GTM loader | `web/index.html` (`<!--gtm:head-->` block) | official snippet for `GTM-T2SXFX3Q` wrapped in `window.__tmistanLoadGtm()`; called at once when the defaults are "granted", otherwise by `saveConsent('granted')`. No `<noscript>` iframe on purpose: without JavaScript no consent can be given, so nothing may be requested. `web/vite-plugins/tagManager.ts` swaps/strips the container id per build (below) |
| Consent updates | `web/src/seo/analytics.ts` → `saveConsent()` | `gtag('consent','update',{analytics_storage})`, `dataLayer.push({event:'tmistan_consent', consent_analytics:'granted'|'denied'})`, then (granted) loads the container and reports the current page |
| Consent UI | `web/src/components/ConsentBar.tsx` (first visit) and `AnalyticsPreferences.tsx` (Privacy Policy page) | the bar is shown only while no choice is stored and no opt-out signal is present; the policy page lets the visitor change the choice at any time; both share one live state (`useConsentChoice`) |
| SPA page views | `web/src/seo/Seo.tsx` → `trackPageView()` | after the `<title>`/canonical of a route are written, one `page_view` event per URL (deduplicated; never on `/admin/*`; **only with consent** — the page on which the visitor agrees is reported at that moment): `page_location`, `page_path`, `page_title`, `page_language` (`en`/`fa-AF`/`ps-AF`, the document language), `page_type` (`home`, `search`, `record`, `guide`, `guides`, `article`, `knowledge`, `legal`, `not_found`, `page`), `page_indexable` (`yes`/`no`), `search_term` (search views only) |

Privacy text: `legal.policies.privacy.sections[1]` ("Usage statistics (only with your consent)") and
`consent.*` in `web/src/i18n/locales/{en,fa,ps}.json`.

## Why consent-first instead of the plain snippet

Google's "advanced" consent mode (container always loaded, tags send cookieless pings while
consent is denied) was measured against the live container on 2026-11-19: the GA4 tag already
present in `GTM-T2SXFX3Q` sent a `/g/collect` request **before** any consent (no cookies, `gcs`
denied). That contradicts the promise the site has made since Phase 1 ("nothing is loaded until
you agree") and the privacy text in three languages, and it would depend on the owner never
adding a tag without consent checks. Loading the container itself only with consent ("basic"
consent mode) keeps the guarantee in code and verifiable (`/tmp`-style smoke test below). The
trade-off: visitors who decline are invisible to GA4 (no modelled data), and Tag Assistant /
Preview mode only connect after you click **Allow** in the consent bar.

## Build switch

`web/vite-plugins/tagManager.ts`

| `SITE_GTM_CONTAINER_ID` | production build (`npm run build`) | `vite dev` |
|---|---|---|
| unset (Render today) | `GTM-T2SXFX3Q` | no Tag Manager (snippet stripped, no consent bar) |
| `GTM-XXXXXXX` | that container | that container |
| `""` (empty) | no Tag Manager, no consent bar | no Tag Manager |

The plugin refuses malformed ids and fails the build if the template does not contain exactly one
GTM loader. `__SITE_GTM_ID__` (Vite define) tells the app whether analytics exist at all
(`analyticsConfigured()`); the former `SITE_GA4_MEASUREMENT_ID` variable is ignored (a build-time
warning says so).

## Container configuration (owner, in tagmanager.google.com)

The code guarantees consent-safe plumbing; the GA4 property is attached inside the container.
State observed on 2026-11-19: the container already holds a GA4 *Google tag* for measurement ID
`G-L58MHTQERR` with default settings (automatic `page_view` on load). That works as is: full page
loads are counted once consent exists, and GA4's Enhanced measurement counts client-side
navigations — but with the title of the *previous* page (the history event fires before React
renders the new one). The recommended setup below fixes that and uses the richer `page_view`
events the site pushes; no duplicate page views:

1. **Consent overview** — Admin → Container Settings → *Enable consent overview*. The page sets
   `gtag('consent','default', …)` before `gtm.js` loads, so no CMP template or "Consent
   Initialization" tag is needed inside the container.
2. **Variables** (Data Layer Variable, version 2): `DLV - page_location`, `DLV - page_path`,
   `DLV - page_title`, `DLV - page_language`, `DLV - page_type`, `DLV - page_indexable`,
   `DLV - search_term`.
3. **Trigger** `CE - page_view` — Custom Event, event name `page_view`.
4. **Tag "GA4 – Google tag"** (type *Google tag*, Tag ID `G-…`): Configuration settings →
   **`send_page_view` = `false`** (the site reports its own page views so SPA titles are correct).
   Trigger: *Initialization – All Pages*. Advanced → Consent settings: *Require additional consent
   for tag to fire* → `analytics_storage` (belt and braces — the container is only loaded with
   consent anyway).
5. **Tag "GA4 – page_view"** (type *Google Analytics: GA4 Event*, event name `page_view`), event
   parameters `page_location`, `page_title`, `page_path`, `page_language`, `page_type`,
   `page_indexable`, `search_term` from the variables above. Trigger: `CE - page_view`. Consent
   settings as in 4. The event the site pushes when the visitor accepts the notice
   (`tmistan_consent`) needs no tag; the current page's `page_view` follows it automatically.
6. In the GA4 property: Admin → Data streams → *Enhanced measurement* → **turn off "Page changes
   based on browser history events"** (otherwise client-side navigations are double-counted).
   Register `page_language`, `page_type`, `page_indexable` as event-scoped custom dimensions if
   you want them in reports.
7. Verify with **Preview** (Tag Assistant): the debugger connects only after you click **Allow**
   in the consent bar (the container is not loaded before). Then `tmistan_consent` and one
   `page_view` appear; each navigation adds exactly one `page_view`. GA4 *DebugView* should show
   one `page_view` per navigation with the correct title.
8. Publish the container version. Do **not** add tags that set cookies for advertising without
   extending the consent notice and policy text (`ad_storage` etc. stay denied).

## Verifying a deployment

```sh
curl -s https://tmistan.com/ | grep -c "GTM-T2SXFX3Q"                      # 1 (loader; no noscript iframe)
curl -s https://tmistan.com/app.html | grep -c "googletagmanager.com/gtm.js"  # 1
curl -s https://tmistan.com/fa/trademark/1011-002 | grep -c "gtag('consent', 'default'"   # 1
```

In the browser (DevTools → Network, fresh profile): **no** request to `googletagmanager.com` or
`google-analytics.com` until the consent bar is accepted; after "Allow", `gtm.js` loads, the GA4
requests start and the `_ga` cookies appear. On the next visit `gtm.js` loads immediately. With
Do Not Track or Global Privacy Control enabled the bar is hidden and nothing is ever loaded.
Playwright smoke run on 2026-11-19 (35 checks: dataLayer order, consent default/update, page_view
per navigation, search/record/404/admin cases, Privacy-page preferences, DNT, served HTML of six
URLs, 390 px layout) — all passed against the production build.

## What is deliberately not done

* No request to Google, no analytics or marketing cookies before consent; no advertising consent types ever granted.
* No page views for `/admin/*`; no personal data (names, e-mail, record edits) in the dataLayer.
* No server-side tagging, no GA4 `gtag.js` outside the container, no second analytics vendor.
