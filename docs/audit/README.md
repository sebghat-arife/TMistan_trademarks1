# Trademark indexing audit (Phase 3) — analysis and recommendations

Files in this folder:

| File | What it is |
|---|---|
| `INDEXING_AUDIT.md` | Generated report (tables): why records are excluded, notice types, data-quality flags, import batches, gazette coverage, near-duplicates, image sizes. |
| `excluded-records.csv` | One row per excluded record (serial, gazette, type, reasons, flags, which fields are present) — no names or addresses, so it can be shared with the data team. |
| `indexing-audit.json` | The same summary as machine-readable JSON (for a dashboard or a future regression check). |

Regenerate after a data import (read-only, publishable key only — the script refuses secret keys):

```sh
cd web && export $(grep -E "^(VITE_)?SUPABASE_(URL|PUBLISHABLE_KEY)=" .env.local | xargs)
npx tsx scripts/indexing-audit.ts --csv ../docs/audit/excluded-records.csv --json ../docs/audit/indexing-audit.json > ../docs/audit/INDEXING_AUDIT.md
```

The script applies the **same** `recordIndexDecision()` as the site (`web/src/seo/recordPolicy.ts`),
so its numbers equal the prerender output (`npm run check` → "3595 trademark record pages written
(1118 records not eligible)").

## Headline (production data, 2026-11-19)

| | Records | Share |
|---|---|---|
| Published | 4,713 | |
| Indexable — prerendered, in the sitemap, `index,follow` | 3,595 | 76.3 % |
| Excluded — served by the app with `noindex,follow`, still searchable on the site | 1,118 | 23.7 % |

Every indexable record has at least one image (3,595 / 3,595). Only 26 published records have
no image at all, and all 26 are excluded for other reasons as well.

## Why the 1,118 are excluded — by cause

A record can fail more than one rule; "only reason" counts records that would become indexable
if that single cause were fixed.

| Cause (rule) | Records | Only reason | Evidence and verdict |
|---|---|---|---|
| **No publication date** | 684 | 606 | All 684 belong to two gazettes: **1344** (526 records, imported 2026-11-15) and **1437** (158 records, imported 2026-11-17). `publication_date` is NULL on **every** row of both gazettes, while every other gazette has exactly one, consistent publication date (e.g. 1419 → 2022-06-20, 1429 → 2023-03-20). This is an **import omission, not a policy problem**: the date was never captured for those two issues. |
| **Not a registration notice** | 495 | 320 | Assignment 171, Owner address change 148, Owner name change 86, Owner name/address change 41, Renewal 38, Merger 5, Cancellation 6. The policy indexes *New Trademark Registration* notices only. 322 of the 495 are otherwise complete, but their goods text is usually the registration's generic text or "Not Specified", and only 37 share a mark name with a registration record in the database — i.e. for most of them the underlying registration is **not** on the site, so a notice page would be a thin, context-free page. |
| No classes | 165 | 8 | 86 of them are in the 2026-10-18 import batch; 157 also fail another rule. |
| No mark name (name equals the serial) | 26 | 0 | All in the 2026-10-18 batch; all also lack classes. These rows are placeholders rather than records. |
| No goods | 21 | 1 | |
| No applicant | 6 | 6 | |

## Recommendations (in order of impact)

1. **Backfill the publication date of gazettes 1344 and 1437 — owner data fix, no code change.**
   Set the issue's publication date on all 526 + 158 rows (admin → edit, or a corrected
   spreadsheet re-import through the admin import). Because every other gazette carries one date per
   issue, a per-gazette value is the right granularity. Effect: ≈ 606 records become indexable at the
   next deploy (the prerender and sitemap pick them up automatically) — the sitemap grows from 3,595
   to ≈ 4,200 record URLs (+17 %). Nothing in `recordPolicy.ts` needs to change.
2. **Keep change notices (assignments, owner changes, renewals…) excluded for now.** The policy is
   doing what it should: these are not registrations, most lack a registration on the site to attach
   to, and their text is thin. If they are wanted in search engines later, the right design is a
   dedicated "notice" page type that links to the registration record (37 candidates today) — not a
   relaxation of the rule.
3. **Watch thin indexable records in Search Console.** 465 indexable records (13 %) have goods text
   "Not Specified" (gazettes 1414, 1425, 1429, 1417, 1421, 1422), and 868 have goods text shorter
   than ~20 characters. They are valid registrations and stay indexable, but if Search Console
   reports many of them as *Crawled – currently not indexed*, the next step is enriching those pages
   (class names from the Nice heading, related records) rather than removing them.
4. **Fix the 2026-10-18 placeholder rows at the source**: 26 records whose mark name is the serial
   number and 86 without classes. They are excluded correctly; the data team should complete or
   unpublish them.
5. `objection_deadline` is NULL on all 4,713 published rows and no importer sets it — it is unused.
   The record page already hides it when empty; no action needed unless the data becomes available.

## Near-duplicates and images (context for the SEO report)

* 308 groups of indexable records share mark name + applicant (955 records; e.g. "GM device /
  General Motors" × 32). They are genuine separate filings (different serials, classes or gazettes),
  each at its own URL. Phase 3 added the serial number to every record's meta description so no two
  record pages share a description.
* Of 4,687 images, 539 (11.5 %) are larger than 300 KB and 132 (2.8 %) wider than 1,600 px. Cards
  and result lists use the 320 px WebP thumbnails; the record page shows the full image (it is the
  largest element of that page and is preloaded with `fetchPriority="high"`). Re-encoding the 539
  large originals (e.g. to ≤ 1,600 px WebP) is a storage-side optimisation for the image importer,
  not a site change.
