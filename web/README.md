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
  components/            Layout (header/footer from the mock-up), Logo, FilterBar (chip dropdowns),
                         ResultCards (card grid + table + pagination), TrademarkImage, ImageViewer
  pages/                 Home, Search (/search), Trademark (/trademark/:serial, with print-ready "Download Record"),
                         About, Help, Legal (terms/privacy), admin/ (Login, Layout with dark sidebar, Dashboard, Import Center)
public/
  brand/                 logo.png · logo-white.png · favicon.png (client-supplied TMistan wordmark)
  img/                   hero-mosque.png (hero illustration)
```

Env (`.env.local`, git-ignored): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (+ `VITE_LOCAL_STORAGE_BASE` for the local stack). Values are inlined by `vite.config.ts` at build time; the build refuses a secret key. Missing values render a configuration screen instead of a blank page.

`npm run dev` · `npm run build` · `npm run preview`

## Design

The UI follows the approved TMistan mock-up as revised by the client brief (Sept 2026): white header
with centred nav (Search · About · Help), globe + language, green **Login**; hero "Search Trademarks in
Afghanistan" with the mosque illustration; statistics cards computed from live Supabase aggregates
(records, gazettes, registrations, renewals, assignments, changes — derived from real
`application_type` counts, see `stats_service.ts`); dark footer. There is no public "all trademarks"
listing and no gazette browsing page: records are reached through search only, and each record shows
its source as "OG <number> — Page <n>". Missing structured values are shown as N/A.
Design tokens live in `src/index.css` (`@theme`): brand green `#067133`, light tint `#eef8ee`,
footer `#141b1e`, sidebar `#0e1519`, hairline borders `#e6e8ea`, 12 px card radius.

## Admin (Phase 2 scaffold)

`/admin/login` signs in with Supabase Auth (email + password). `/admin/*` renders only when the
`is_admin()` RPC returns true for the session — authorisation is decided by RLS, never in the browser.
The dashboard reads `registry_stats()`, `trademarks_by_class()` and `import_jobs` (admin-only under RLS).
On the local stack (no GoTrue) paste `LOCAL_ADMIN_KEY` from `scripts/local-stack/keys.env` into the login form.
