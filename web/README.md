# web — TMistan frontend

React 19 · TypeScript · Vite · Tailwind v4 · Radix primitives (shadcn-style) · Lucide · TanStack Query · React Router · i18next

```
src/
  lib/supabase.ts        single Supabase client (anon key only) + storagePublicUrl()
  lib/database.types.ts  typed schema subset (regenerate with `supabase gen types`)
  lib/queries.ts         every data access, as TanStack queryOptions
  lib/searchParams.ts    URL ⇄ search state (the URL is the source of truth)
  i18n/                  en / fa (Dari) / ps (Pashto); RTL handled on <html dir>
  lib/auth.ts            useAuth(): Supabase Auth session + server-side is_admin() check
  components/            Layout (header/footer from the mock-up), Logo, FilterBar (chip dropdowns),
                         ResultCards (card grid + table + pagination), TrademarkImage, ImageViewer
  pages/                 Home, Search (/search + /trademarks), Trademark, Gazettes, Gazette, About, Help,
                         Legal (terms/privacy), admin/ (Login, Layout with dark sidebar, Dashboard, section stubs)
public/
  brand/                 logo.png · logo-white.png · favicon.png (client-supplied TMistan wordmark)
  img/                   hero-mosque.png · about-lineart.png (decorative illustrations)
```

Env (`.env.local`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (+ `VITE_LOCAL_STORAGE_BASE` for the local stack).

`npm run dev` · `npm run build` · `npm run preview`

## Design

The UI is a 1:1 implementation of the approved TMistan mock-up: white header with centred nav
(Search · Gazettes · Trademarks · About · Help), globe + language, green **Login**; hero with the
mosque illustration; four stat cards; "Recently Added Trademarks"; four-feature strip; dark footer.
Design tokens live in `src/index.css` (`@theme`): brand green `#067133`, light tint `#eef8ee`,
footer `#141b1e`, sidebar `#0e1519`, hairline borders `#e6e8ea`, 12 px card radius.

## Admin (Phase 2 scaffold)

`/admin/login` signs in with Supabase Auth (email + password). `/admin/*` renders only when the
`is_admin()` RPC returns true for the session — authorisation is decided by RLS, never in the browser.
The dashboard reads `registry_stats()`, `trademarks_by_class()` and `import_jobs` (admin-only under RLS).
On the local stack (no GoTrue) paste `LOCAL_ADMIN_KEY` from `scripts/local-stack/keys.env` into the login form.
