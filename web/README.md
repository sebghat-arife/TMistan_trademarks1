# web — TMistan frontend

React 19 · TypeScript · Vite · Tailwind v4 · Radix primitives (shadcn-style) · Lucide · TanStack Query · React Router · i18next

```
src/
  lib/supabase.ts        single Supabase client (publishable key only; config injected at build time) + storagePublicUrl()
  lib/database.types.ts  typed schema subset (regenerate with `supabase gen types`)
  services/              THE data-access layer: trademark_service (search/filter/detail/similar),
                         image_service, stats_service (registry_stats, filter options, record-type totals),
                         admin_service, import_service; DataError codes
                         (`schema_missing`, `auth`, …) drive the shared error states. UI never calls supabase-js directly.
  lib/queries.ts         deprecated alias of services/ (kept for old imports)
  components/AsyncState  LoadingState / EmptyState / ErrorState used by every page; ConfigScreen when env is missing
  lib/searchParams.ts    URL ⇄ search state (the URL is the source of truth)
  i18n/                  en / fa (Dari) / ps (Pashto); RTL handled on <html dir>
  lib/auth.ts            useAuth(): Supabase Auth session + server-side is_admin() check
  components/            Layout (header + ivory footer with the decorative frieze: Platform / Information / Masnad Law Firm / Legal), Logo,
                         ResultCards (card grid + table + pagination), TrademarkImage, ImageViewer,
                         PageHero (informational pages; `motif` = photo | arch | lattice | none), editorial (SplitHero, SectionLabel, …)
  components/ornament    Restrained ornament library — original SVG linework, configurable colours/opacity, aria-hidden,
                         pointer-events none, 1 px non-scaling strokes: GirihMotif (one oversized eight-fold rosette cropped
                         into a corner: page background, dark promo sections), CornerAccent (thin stepped corner frame with a
                         small rosette: selected headers/panels), OrnamentalBand (narrow footer frieze: rosettes + cartouches
                         between two hairlines), StarMotif / StarDivider (small star accents), ArchitecturalArch (line-art arch:
                         Services header, Home feature band). The `.eyebrow` label draws the star through a CSS mask.
                         No repeating wallpaper tiles anywhere; backgrounds stay plain ivory.
  components/search/     SearchExperience (hero + results, the landing page's top; /search redirects here),
                         SearchModeSwitch (segmented control), AdvancedSearchPanel,
                         ActiveFilters (chips), ImageSearchCard + useImageSearch (upload / preview / options / submit),
                         ImageSearchResults, ImageSearchExamples (real published images), SearchTips
  pages/                 Home (/ — search hero + results + landing sections), Trademark (/trademark/:serial, with print-ready "Download Record"),
                         About, Help, Legal (terms/privacy/disclaimer), admin/ (Login, Layout with dark sidebar, Dashboard, Import Center)
public/
  brand/                 logo.png · logo-white.png · favicon.png (client-supplied TMistan wordmark)
  img/                   search-hero-darulaman.jpg (landing-page search hero — real photograph, CC BY 4.0) and the page-hero
                         photographs/illustrations (hero-*.jpg, about-hero-kabul.jpg, about-minaret.jpg, legal-documents-desk.jpg); attributions in img/CREDITS.md
```

Env (`.env.local`, git-ignored): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (+ `VITE_LOCAL_STORAGE_BASE` for the local stack; optional public `SITE_*` metadata incl. `SITE_MASNAD_URL`, see `.env.example`). Values are inlined by `vite.config.ts` at build time; the build refuses a secret key. Missing values render a configuration screen instead of a blank page.

`npm run dev` · `npm run build` · `npm run preview`

## Design

The UI follows the approved TMistan mock-up as revised by the client briefs (Sept/Oct 2026): white
header with centred nav (Search · About · Help), globe + language, green **Login**. The homepage is
an enterprise/legal-tech landing page (Oct 2026 "master prompt"): hero with the search bar as the
primary action over a photograph of Afghan architecture, then Why TMistan → Built by Masnad Law
Firm → Why it matters → Platform capabilities → **TMistan at a Glance** (live Supabase aggregates:
records, gazettes, registrations, renewals, assignments, changes — derived from real
`application_type` counts in `stats_service.ts`; empty categories are omitted and the whole section
disappears when the database holds no published records) → How it works / Published sources &
transparency (with the independence disclaimer) / Who it is for → dark "Built for Afghanistan" and
Masnad + TMistan vision bands → final CTA → enterprise footer. All wording comes from the client
brief and lives in `src/i18n/locales/*` (en / fa / ps). Sections fade in on scroll (`.reveal`,
disabled under `prefers-reduced-motion`). Fonts are self-hosted (`@fontsource-variable/inter`,
`@fontsource-variable/source-serif-4` for editorial headings) — no third-party requests.

There is no public "all trademarks" listing and no gazette browsing page: records are reached
through search only, and each record shows its source as "OG <number> — Page <n>". Missing
structured values are shown as N/A.
Design tokens live in `src/index.css` (`@theme`) — the Afghan-inspired design system palette:
emerald `brand-600 #087747` (primary actions, links, selected states; scale 50–900), navy
`navy-900 #102b43` (headings, dark bands, admin sidebar; 700–950), ivory `ivory-50 #f7f7f1`
(page background; 50–200), turquoise `turquoise-200 #b9dcd2` (restrained ornament accents; 50–400),
slate gray-blue neutrals `ink-50…900` (borders, secondary text), `mist-50/100` tinted sections,
radii 6/8/12/16 px, `shadow-card` / `shadow-float`. Type: Source Serif 4 (editorial headings) +
Inter (body, controls, tables), both self-hosted. Components use these utilities only — no scattered
hex values. Decoration budget: ivory backgrounds with one faint girih rosette in the bottom-end corner
(off on search results and record pages), one ornamental band in the footer, corner accents only on the
Home, About, Services, Data Sources and Knowledge Center headers/panels; Search, Data Corrections, Legal,
Help, Contact and admin stay plain.

## Admin (Phase 2 scaffold)

`/admin/login` signs in with Supabase Auth (email + password). `/admin/*` renders only when the
`is_admin()` RPC returns true for the session — authorisation is decided by RLS, never in the browser.
The dashboard reads `registry_stats()`, `trademarks_by_class()` and `import_jobs` (admin-only under RLS).
On the local stack (no GoTrue) paste `LOCAL_ADMIN_KEY` from `scripts/local-stack/keys.env` into the login form.
