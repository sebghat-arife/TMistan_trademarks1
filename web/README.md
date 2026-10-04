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
  components/            Layout (header + enterprise footer: Platform / Information / Masnad Law Firm / Legal), Logo, FilterBar (chip dropdowns),
                         ResultCards (card grid + table + pagination), TrademarkImage, ImageViewer
  pages/                 Home, Search (/search), Trademark (/trademark/:serial, with print-ready "Download Record"),
                         About, Help, Legal (terms/privacy/disclaimer), admin/ (Login, Layout with dark sidebar, Dashboard, Import Center)
public/
  brand/                 logo.png · logo-white.png · favicon.png (client-supplied TMistan wordmark)
  img/                   hero-mosque.jpg (hero photograph, loaded from md up), afghanistan-citadel.jpg (dark band)
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
Design tokens live in `src/index.css` (`@theme`): brand green `#067133`, light tint `#eef8ee`,
headline navy `#10233a`, dark bands `#0c2a33` / `#07202a`, footer `#0e1519`, hairline borders
`#e6e8ea`, 12 px card radius.

## Admin (Phase 2 scaffold)

`/admin/login` signs in with Supabase Auth (email + password). `/admin/*` renders only when the
`is_admin()` RPC returns true for the session — authorisation is decided by RLS, never in the browser.
The dashboard reads `registry_stats()`, `trademarks_by_class()` and `import_jobs` (admin-only under RLS).
On the local stack (no GoTrue) paste `LOCAL_ADMIN_KEY` from `scripts/local-stack/keys.env` into the login form.
