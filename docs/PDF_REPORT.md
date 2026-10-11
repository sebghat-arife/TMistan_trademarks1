# Trademark Publication Report (PDF download)

"Download Record" on a trademark page produces a one-page (A4) PDF, generated **entirely in the
browser** with `@react-pdf/renderer` — no server, no Supabase function, no extra network request
beyond the trademark images the page already shows.

| Item | Where |
| --- | --- |
| Document component, fonts, layout | `web/src/lib/pdf/trademarkReport.tsx` |
| Disclaimer text (verbatim, client-provided) and file name | `web/src/lib/pdf/disclaimer.ts` |
| Trigger / data mapping | `useRecordDownload()` in `web/src/pages/TrademarkPage.tsx` |
| Fonts (OFL) | `web/public/fonts/` — Inter (Regular/SemiBold/Bold), Noto Naskh Arabic (Regular/Bold) |
| Build-time textkit fixes | `web/vite-plugins/reactPdfTextkitFix.ts` (wired in `web/vite.config.ts`) |
| Canonical record URL | `SITE_CANONICAL_URL` (default `https://www.tmistan.com`) in `render.yaml` / `web/.env.example` |

The report module is loaded lazily (`import('@/lib/pdf/trademarkReport')`), so the ~1 MB
react-pdf bundle is only downloaded when a user clicks the button.

## Content

1. **Header** — TMistan logo, platform description sentence, document title
   *Trademark Publication Report*, generation date.
2. **Record header** — mark name, serial number, image(s) when the record has any
   (`trademark_primary_images`), source line `Source: OG <number> — Page <n>`.
3. **Details table** — the same public fields as the trademark page, in the same order and with
   the same `N/A` handling. The attorney / representative is never included.
4. **Disclaimer** — the full client-provided disclaimer (`REPORT_DISCLAIMER`). It is always
   placed *before* the record link.
5. **Record link** — the canonical URL of the record (`SITE_CANONICAL_URL + /trademark/<serial>`).
6. **Footer** — `TMistan` and `Page n / total` on every page.

File name: `TMistan-Trademark-Report-<serial>.pdf` (`reportFileName()`); the serial is reduced to
`[A-Za-z0-9._-]`.

Field values are printed exactly as stored — registry data is never translated. Only labels follow
the UI language (English, Dari, Pashto), and the page direction follows the language.

## Languages, fonts and dates

* Latin text uses Inter; any string containing Arabic script is set in Noto Naskh Arabic
  (`T()` helper). Fonts are registered once from `web/public/fonts/` through `Font.register`.
* Hyphenation is disabled (`Font.registerHyphenationCallback`) so serial numbers and URLs never
  break mid-token.
* Dari/Pashto documents are `direction: rtl`. Latin-only values (serials, URLs, Latin mark names)
  are rendered as their own `Text` with `direction: ltr` inside a flex row — mixing an Arabic label
  and a Latin number in one `Text` reorders the number in react-pdf.
* A paragraph that contains Arabic script in an RTL document is always an RTL paragraph, even
  when it starts with a Latin word ("TMistan پلتفرمی …"); otherwise first-strong direction is used.
* Dates: `formatRegistryDate()` / `formatToday()` in `web/src/lib/utils.ts`. Chromium ships no
  Pashto ICU data, so Pashto dates are produced from the Solar Hijri calendar fields with the Afghan
  Pashto month names (وری … کب) instead of `Intl`; Dari uses `fa-AF`, English shows the Gregorian
  date with the Solar Hijri date in brackets.

## Arabic text and the textkit workaround

`@react-pdf/textkit` 7.0.1 (react-pdf 4.9.0) breaks Arabic fonts whose letters are shaped as a
dotless base glyph plus a zero-advance mark glyph (Noto Naskh Arabic, and most modern Arabic
fonts): the first letter of every line lost its body and the dots of every letter sat over the
neighbouring letter. The upstream issues are
[react-pdf#3555](https://github.com/diegomura/react-pdf/issues/3555) (fix in PR #3577, unreleased)
and [react-pdf#3576](https://github.com/diegomura/react-pdf/issues/3576) (open).

`web/vite-plugins/reactPdfTextkitFix.ts` applies four minimal source patches to the textkit ESM
**at build time** (`node_modules` is never modified):

1. `run/slice` start boundary — use the *first* glyph of a decomposed character (#3555).
2. GPOS `xOffset`/`yOffset` — convert to 1/1000 em, the unit the renderer passes to pdfkit, and
   keep the GPOS `yOffset` (#3576).
3. Bidi reversal — after a run is reversed a mark precedes its base; add the base advance to the
   mark's x offset.
4. `letterSpacing` — never add tracking to zero-advance marks (it detached the dots; this is also
   why `T()` forces `letterSpacing: 0` for Arabic strings).

Every patch is a no-op when its pattern is absent, and the plugin logs what it applied
(`applied 4 fixes — …`) or `nothing to patch` during `npm run build`. The glyph positions after patching were
checked against fontkit's own layout of the same strings, and the resulting PDFs were rendered with
pdfium and inspected at 4–8× for English, Dari and Pashto.

**Remove the plugin** (delete the file, the import in `vite.config.ts`, and
`optimizeDeps.exclude: ['@react-pdf/renderer']`) once the project is on a react-pdf release that
renders Arabic marks correctly; "nothing to patch" at build time is the signal that the patterns
are gone, after which a visual check of a Dari PDF decides.

### Rules of thumb when editing the report

* Never use `letterSpacing` / `textTransform` on text that may contain Arabic.
* Keep Latin values in their own `Text` with `direction: 'ltr'` inside RTL rows.
* Use unitless `lineHeight` on individual `Text` elements only (it compounds on ancestors).
* Images need explicit `width` + `height` with `objectFit: 'contain'`.
* Text extraction (copy/paste, `pdftotext`) of Arabic from the PDF may swap letters that share
  a skeleton glyph — a known react-pdf ToUnicode limitation, cosmetic only; the printed output is
  correct.

## Verification checklist

```bash
cd web && npm run build          # plugin must log "applied 4 fixes", never "nothing to patch"
grep -rl "sb_secret_\|service_role" dist/   # must print nothing
```

Then open a trademark page in each language, click **Download Record**, and check: one page,
correct Arabic shaping (dots on their letters, first letter intact), serial and URL left-to-right,
disclaimer before the link, page footer present.
