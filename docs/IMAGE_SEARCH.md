# Search by Image

`/search?mode=image` lets a visitor drop a logo / mark image and get the published trademarks whose
stored image looks most similar. It is a *research aid* for finding visually comparable marks — it is
not a clearance, availability or infringement opinion, and the UI says so.

```
visitor's browser                                   Supabase
┌──────────────────────────────┐                    ┌──────────────────────────────────────────┐
│ image file (≤ 8 MB)          │                    │ trademark_image_features (pgvector, RLS) │
│  → decode on a <canvas>      │  369 floats        │   image_id · trademark_id · version      │
│  → descriptor (369 floats)   │ ───────rpc───────▶ │   · descriptor vector(369)               │
│  nothing else leaves the tab │  search_trademarks │ search_trademarks_by_image()  SECURITY   │
│                              │  _by_image         │   cosine distance, published rows only   │
└──────────────────────────────┘ ◀──── results ──── └──────────────────────────────────────────┘
```

## 1. One-time setup (project owner)

1. Supabase → SQL Editor → paste **`supabase/APPLY_0500.sql`** → Run. It adds the `vector`
   extension, table `public.trademark_image_features`, one HNSW index and five functions
   (`search_trademarks_by_image`, `image_search_status`, `admin_image_index_status`,
   `admin_images_missing_features`, `admin_upsert_image_features`). Additive, idempotent, never
   touches `trademarks` / `trademark_images` rows. The result grid must show `pgvector extension 1`,
   `image feature table 1`, `image search functions 5`.
2. Sign in → **Admin → Import Center → Visual search index** → *Index N images*. The browser
   downloads every matched image from the public bucket, computes its descriptor and stores the
   vectors (200 per RPC call). A few hundred images take well under a minute. Failures (undecodable
   files, 404s) are listed and downloadable as CSV; they do not stop the run.
3. From now on images uploaded through the Import Center are indexed automatically at the end of
   the upload (*"Visual search index updated"* in the import result). Re-open the panel after an
   algorithm change (`DESCRIPTOR_VERSION` bump): rows with an older version show as **Stale** and
   are re-indexed by the same button.

Until step 1 is done the search page shows *"Search by Image is temporarily unavailable"*; between
steps 1 and 2 it shows *"the visual index is empty"*. Neither state breaks the keyword search.

## 2. How a match is computed

`web/src/lib/imageSearch/descriptor.ts` (pure TypeScript, same code for indexing and querying):

| Block | Dims | What it captures |
|---|---|---|
| perceptual hash (sign of 8×8 low-frequency DCT) | 64 | overall layout, robust to resize / JPEG / small blur |
| radially weighted low-frequency DCT coefficients | 56 | coarse shape with graded weight |
| stroke-orientation histograms in a 4×4 grid | 128 | typography / line work per region |
| grey-level grid (16×8) | 128 | lightness distribution |
| ink colour (hue/saturation) | 9 | dominant colour of the mark itself |
| geometry (aspect ratio, ink coverage, centroid, extent) | 8 | word-mark vs. device, wide vs. square |

Before describing, the image is decoded, the background estimated from the border, a connected-
component *ink mask* built (specks removed), and the content box cropped — so a logo on a white
sheet, the same logo tightly cropped and a JPEG re-save all land on nearly the same vector.
Everything is L2-normalised; similarity = cosine similarity in Postgres (`<=>`).

Calibration on the real 56 production images (gazette 1022) plus their re-encoded, rescaled,
padded and cropped variants: every image finds itself as the top-1 hit (55–56 / 56 depending on the
distortion), the *highest* similarity between two unrelated marks is **0.574** (99th percentile
0.507). The public cut-off is therefore **0.55** (`IMAGE_SEARCH_MIN_SIMILARITY`), labelled in the
UI as *high* (≥ 0.80), *moderate* (≥ 0.65) and *low* (≥ 0.55). Up to 24 results are returned.

Known limitation: a blank or almost blank image (e.g. `1022-050`, which is a black rectangle in the
Gazette scan) produces a degenerate descriptor and is never a meaningful match.

## 3. Privacy and security

* The uploaded picture is decoded in the visitor's browser and discarded; only the 369-number
  descriptor is sent, and the database stores nothing about queries.
* `trademark_image_features` has RLS enabled and **no** policies; anon/authenticated reach it only
  through `search_trademarks_by_image` / `image_search_status` (SECURITY DEFINER, published rows
  only, hard-capped at 50 results). The three `admin_*` functions call `admin_assert()` first.
* No service-role key is involved anywhere; the static site uses the publishable key only.
* The site is static, so there is no server-side rate limit on this RPC beyond Supabase's own; the
  query is a single indexed nearest-neighbour lookup (HNSW, cosine) and costs milliseconds.

## 4. Files

`web/src/lib/imageSearch/descriptor.ts` (descriptor + decoding) ·
`web/src/services/image_search_service.ts` (RPC wrappers, indexing helpers) ·
`web/src/components/ImageSearchPanel.tsx` (public UI) · `web/src/pages/admin/ImageIndexPanel.tsx`
(admin index panel) · `supabase/migrations/20261011000500_image_search.sql` · `supabase/APPLY_0500.sql`
· i18n keys `search.image.*`, `admin.index.*`, `admin.import.indexing*`.
