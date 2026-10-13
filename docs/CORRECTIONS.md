# Legal, Knowledge Center and Data Correction pages

Three informational/service pages added on 2026-10-13 (same header, footer, router, design
tokens and Supabase client as the rest of the site). Nothing in Search, record pages, About or
Help was redesigned; they only gained small cross-links.

| Route | Page | Source |
|---|---|---|
| `/legal` | Legal Information & Policies hub (hero, four policy cards, reader + sidebar) | `web/src/pages/LegalPage.tsx` |
| `/legal/terms`, `/legal/privacy`, `/legal/disclaimer`, `/legal/intellectual-property` | one policy opened in the reader; the old `/terms`, `/privacy`, `/disclaimer` URLs redirect here | same file, text in `legal.*` of the locale files |
| `/knowledge-center` | Trademark Knowledge Center (topics, search, featured guides, quick links) | `web/src/pages/KnowledgeCenterPage.tsx` |
| `/knowledge-center/:slug` | one article (table of contents, body, example/checklist, related, next step) | `web/src/pages/KnowledgeArticlePage.tsx`, content in `web/src/content/knowledge.ts` |
| `/data-corrections` | Data Correction & Verification Requests (types, form, status check, process) | `web/src/pages/DataCorrectionsPage.tsx`, `web/src/services/correction_service.ts` |
| `/admin/corrections` | administrators' queue for the requests | `web/src/pages/admin/AdminCorrectionsPage.tsx` |

Shared editorial building blocks (split hero, section labels, cards, side panels, numbered
steps, closing banner) live in `web/src/components/editorial.tsx` and the `.split-hero*`,
`.ed-*`, `.section-label`, `.num-badge`, `.policy-nav-link`, `.article-body` rules of
`web/src/index.css`.

## Legal pages — what is draft and what is given text

* **Disclaimer** — the client's draft is used verbatim.
* **Terms of Use, Privacy Policy, Intellectual Property** — drafts written for this release
  and marked on the page as *"Draft prepared 13 Oct 2026 — pending approval by Masnad Law
  Firm"*. The Terms deliberately contain **no governing law, jurisdiction, legal entity or
  registered address**; a yellow *"To be completed before publication"* box says so. The
  Privacy Policy describes what the site really does today: no accounts, no analytics or
  advertising cookies, the language preference in `localStorage`, Supabase (hosting the data
  and receiving form submissions), the two forms (Contact; Data Correction) with their
  retention of name/e-mail/message, the hashed-IP rate limit, and the download of records as
  PDF generated in the browser. There are no consent banners because nothing needs consent.
* Revision dates are shown only for the three drafts (the day they were written). The
  Disclaimer shows none because the client's text carries none.
* All four policies exist in English, Dari and Pashto (`legal.*` keys). When Masnad approves a
  text, replace the strings and remove the `draft` flag in `LegalPage.tsx`.

## Knowledge Center

* Six complete articles (`web/src/content/knowledge.ts`): *What is a trademark?*, *How to Search
  Trademark Records in TMistan*, *How to Read Official Gazette Entries*, *Understanding
  Trademark Classes*, *How to Conduct a Preliminary Trademark Search*, *What a Trademark Search
  Can and Cannot Tell You*. Bodies are English; titles, summaries and UI strings are translated
  and a notice says the body is available in English only.
* Reading time is computed from the word count (200 words/min) — never typed by hand. Every
  feature an article mentions exists in the current interface (checked against the Search,
  record and Data Sources pages); the figures are screenshots of the real interface
  (`web/public/img/kc/`, see `web/public/img/CREDITS.md`). No fees, deadlines, statistics or
  citations were invented; the one record used as an example (1022-073, Edifier) is a real
  published record.
* The search box filters the articles client-side (title, summary, headings, body) and shows an
  empty state with a reset button. Topic cards filter by category; *Browse All Articles* clears
  the filter.
* Quick links go to `/help`, the *Understanding Trademark Classes* article, `/data-sources` and
  `/help#faq`. *Keep Learning* promises nothing about future articles.

## Data Correction & Verification requests

### Visitor side

1. The page probes `correction_form_status()`. When the function is missing (migration 0900 not
   applied) the form is shown disabled with a notice pointing to the Contact page — the page
   never pretends to accept a request.
2. `submitCorrectionRequest()` calls `submit_correction_request(...)`; validation, rate limits
   and the honeypot live in Postgres. The success panel is rendered **only after the RPC returns**
   the row id and reference. Duplicate submissions are blocked by the pending mutation state.
3. Evidence (optional, max 3 files, JPG/PNG/PDF, ≤ 5 MB each) is uploaded **after** the request
   exists, to the private bucket `correction-evidence` under `<request-id>/<random>.<ext>`. The
   Storage policy accepts the upload only while `correction_upload_allowed(name)` is true: request
   younger than 15 minutes, fewer than 3 objects, name pattern valid, global upload rate not
   exceeded. A failed upload is reported next to the file; the request itself stays stored.
4. Tracking: the reference (`CR-XXXXXXXX`, from a 32-character alphabet, not sequential) together
   with the e-mail address used lets the requester call `correction_request_status()` on the same
   page. It returns the status, the request type, dates and the administrator's public note —
   nothing else. One value alone returns nothing.
5. No e-mail is sent in either direction (no mail provider is configured). The page says so: the
   process box ends with *"Check the outcome"*, not with a promise of a notification.
6. Nothing personal is placed in URLs or logs. Deep links carry only the record reference and
   type (`?serial=1022-073`, `?gazette=1022`, `?type=image`).

### Administrator side (`/admin/corrections`)

* Count cards, filters (status, type, free text), pager, detail panel per request: requester,
  description, related record, linked trademark (opens the public record and the admin record
  search), evidence files (opened through 10-minute signed URLs, deletable), internal note (never
  shown to the requester), public note (shown in the status check), status change with the
  allowed transitions, full history with actor and timestamp. "Reply by e-mail" is a `mailto:`
  link — the platform itself sends nothing.
* Statuses: `received → under_review → more_info_needed | resolved | closed_no_change`;
  `more_info_needed ↔ under_review`; a request can never return to `received`. Every change is
  written to `correction_request_events` and to the admin audit log (`correction.update`).
* Administrators decide what, if anything, changes in a trademark record; a correction request
  never writes to `public.trademarks`.

### Backend (migration 0900, `supabase/APPLY_0900.sql`)

See `docs/SCHEMA.md` → *Data correction requests*. Requires 0400 + 0600 only; additive and
idempotent; tested with `psql` (functions, RLS, rate limits, upload gate, status transitions,
non-admin rejection).

## Applying the backend (project owner)

1. Backup (Dashboard → Database → Backups).
2. SQL Editor → paste `supabase/APPLY_0900.sql` → Run. The result panel must show
   `correction functions (expect 8) = 8`, `storage policies (expect 3) = 3` and
   `bucket correction-evidence = 1`.
3. If the bucket row is `0` (the SQL editor role may not write `storage.buckets` on some
   projects), run `python3 scripts/setup_storage.py` from a trusted machine (secret key in
   `importers/.env`, never in the browser) and re-run `APPLY_0900.sql` so the policies exist.
4. Open `/data-corrections`: the notice disappears and a test submission returns a `CR-` reference;
   `/admin/corrections` lists it.

## Items that need Masnad's confirmation

* Approval of the Terms of Use, Privacy Policy and Intellectual Property drafts; governing law,
  jurisdiction, legal entity and address for the Terms.
* Whether evidence files should be kept after a request is closed (today they stay until an
  administrator deletes them).
* Whether requesters should receive e-mail notifications (would need a mail provider and an
  Edge Function; the UI currently promises none).
* The hero artwork on the three pages is cropped from the client's own mock-ups; replace
  `web/public/img/hero-{legal,knowledge,corrections}.jpg` to change it.
