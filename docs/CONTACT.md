# Contact & Feedback, Services and Data Sources pages

Three informational pages were added to the public site in the same shell (header, footer, i18n,
router) as the rest of TMistan. Only `/contact` has a backend.

| Route | Page | Source | Backend |
|---|---|---|---|
| `/data-sources` | Data Sources & Methodology | `web/src/pages/DataSourcesPage.tsx` | none (static copy) |
| `/services` | Trademark Research & Professional Assistance | `web/src/pages/ServicesPage.tsx` | none (static copy) |
| `/contact` | Contact & Feedback | `web/src/pages/ContactPage.tsx` | `submit_contact_request` (migration 0800) |
| `/admin/inquiries` | Admin → Inquiries (private inbox) | `web/src/pages/admin/AdminInquiriesPage.tsx` | `admin_*_contact_request*` (migration 0800) |

All copy lives in `web/src/i18n/locales/{en,fa,ps}.json` under `dataSources.*`, `services.*`,
`contact.*` and `admin.inquiries.*`; the English text is the client's wording verbatim. The shared
hero band is `web/src/components/PageHero.tsx`; the faded desk artwork behind it is the client-supplied
illustration (`web/public/img/legal-documents-desk.jpg`, credit in `web/public/img/CREDITS.md`) and can
be swapped by replacing that file.

Deep links understood by `/contact`:

| Parameter | Effect |
|---|---|
| `type=general｜trademark-research｜data-correction｜technical-support` | preselects the inquiry category (the category cards and the *Inquiry Type* select keep this in sync) |
| `research=availability｜similar｜historical｜review｜portfolio｜custom｜other` | preselects *Type of research requested* (used by the service cards on `/services`) |
| `issue=<issue key>` | preselects the issue category (e.g. `incorrect_image` from the Data Sources page) |
| `serial=`, `gazette=`, `mark=` | prefill the record fields |

## How a submission travels

```
browser (publishable key, anon)                Postgres (migration 0800)
──────────────────────────────                 ────────────────────────────────────────────
validate required fields + e-mail  ──rpc──►    submit_contact_request(...)
                                               ├─ validates every field again (22023 → shown to the user)
                                               ├─ keeps only known detail keys, clips lengths
                                               ├─ honeypot filled? → pretend success, store nothing
                                               ├─ rate limits (TM429): 5/h per e-mail, 10/h per
                                               │  hashed IP, 60 per 10 min overall
                                               └─ insert into public.contact_requests
success panel ("Thank You for Contacting TMistan") ◄── {id, received_at}
```

* **Nothing is readable through the API.** `public.contact_requests` has RLS enabled, no policies and
  no grants for `anon` / `authenticated`; the only way in is the `security definer` functions.
  Administrators read through `admin_list_contact_requests` & co., which call `admin_assert()` (the
  same guard as the Data Management Center) and log status changes to `admin_actions`.
* **No secrets in the browser.** The page uses the publishable key already shipped with the site;
  there is no e-mail provider, webhook or server-side key. Replies are sent by the administrator from
  their own mailbox (*Reply by e-mail* in the admin inbox opens a prefilled `mailto:`).
* **Privacy.** The visitor's IP address is never stored — only a salted SHA-256 hash used for rate
  limiting. The user agent (≤ 300 chars), UI language and the page URL are kept to help with support
  requests. No attachments are accepted (there is no secure upload path for them yet).
* **Graceful degradation.** `contact_form_status()` is probed once per session; when it does not
  exist (0800 not applied) the form shows *"The inquiry form is not available yet"* and the submit
  button is disabled. Admin → Inquiries shows *"Migration 0800 has not been applied"*.
* **Errors.** Server validation (`22023`) is shown next to the generic "please correct" message;
  `TM429` shows the rate-limit text; anything else shows the client's failure wording and keeps the
  visitor's input so they can retry.

## Applying the backend (project owner)

1. Backup (Dashboard → Database → Backups) — optional, nothing existing is touched.
2. SQL Editor → paste `supabase/APPLY_0800.sql` → Run. Post-checks must show
   `contact_requests table = 1`, `RLS enabled = true`, `anon/authenticated table grants = 0`,
   `anon may call submit_contact_request = 1`, `contact functions = 6`.
3. Open `/contact` — the "not available yet" notice disappears without a redeploy.
4. Admin → Inquiries lists submissions (filters: status, type, free text; detail: message, submitted
   details, status, internal note).

Local rehearsal: `scripts/local-stack/start.sh` applies all migrations including 0800; the functions
were exercised with `psql` (validation codes, honeypot, rate limit, privilege checks, admin RPCs) and
through PostgREST + the real page with Playwright.

## Contact details shown on the page

Only verified facts are rendered: *"TMistan is operated by Masnad Law Firm, Kabul, Afghanistan"*
and the link to `https://www.masnadip.af/` (`SITE_MASNAD_URL`). E-mail, phone and street address appear
**only** when the owner sets `SITE_CONTACT_EMAIL`, `SITE_CONTACT_PHONE`, `SITE_CONTACT_ADDRESS` as Render
environment variables (build-time, see `web/.env.example`). Until then the aside says that further
channels will be listed once confirmed. No map, hours or social links are invented.

## Items that need Masnad's confirmation

* Publishable e-mail / phone / address / social links / office hours (currently none).
* Whether to state response times or fees anywhere (currently: "confirmed by the firm per inquiry").
* The Privacy Policy text at `/privacy` should mention the contact form data (name, e-mail, message,
  hashed IP, retention).
* The hero illustration (AI-rendered client artwork showing an emblem of the former republic) — swap
  `web/public/img/legal-documents-desk.jpg` if a photograph is preferred.
