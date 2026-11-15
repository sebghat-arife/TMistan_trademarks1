# Image credits

| File | Subject | Author / source | Licence |
|---|---|---|---|
| `search-hero-darulaman.jpg` | Darulaman Palace (Darul Aman Palace), Kabul — restored building, photographed 23 March 2023 | Qasimmirzaie, via Wikimedia Commons — https://commons.wikimedia.org/wiki/File:Darulaman_palace.jpg | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — cropped and resized for the search hero on the landing page; no other changes |

The landing page shows the required attribution as a small caption on the photograph.

All other decoration (rosettes, corner frames, the footer band, the arch) is original vector linework drawn in
`web/src/components/ornament.tsx` — no stock, generated or historic imagery is used for it.

## legal-documents-desk.jpg
- Used on: Data Sources & Methodology, Services & Trademark Research and Contact & Feedback heroes (faded, decorative, `aria-hidden`).
- Source: illustration supplied by the client with the page brief on 2026-10-12 ("Professional Legal Documents on Glass Desk"); rendered artwork, not a photograph of a real publication.
- Processing: downscaled to 1600 px, JPEG q78.

## hero-legal.jpg · hero-knowledge.jpg · hero-corrections.jpg

Photographs from Wikimedia Commons for the `/legal`, `/knowledge-center` and `/data-corrections` heroes
(replacing the mock-up crops used in the first revision). Each page shows the attribution as a small
caption on the picture, linking to the Commons file page. Processing for all three: cropped to a wide
hero frame, resized (≤1600 px), slight contrast/white-balance adjustment, JPEG q76–80. No other changes.

| File | Subject | Author / source | Licence |
|---|---|---|---|
| `hero-legal.jpg` | Law library of the Afghanistan Rule of Law Project (ARoLP), Kabul, 25 October 2008 | "Step" (Flickr user, Amherst, USA), via Wikimedia Commons — https://commons.wikimedia.org/wiki/File:ARoLP_Library-Kabul.jpg | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) — cropped |
| `hero-knowledge.jpg` | Kabul University Central Library, reading room, 26 October 2008 | stepnout (Flickr), via Wikimedia Commons — https://commons.wikimedia.org/wiki/File:Kabul_University_Central_Library.jpg | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) — cropped |
| `hero-corrections.jpg` | Illuminated double frontispiece of the *Makhzan al-Asrar* (Treasury of Mysteries), Herat, late 15th century; ink, opaque watercolour and gold on paper | Los Angeles County Museum of Art, Nasli M. Heeramaneck Collection (M.73.5.529), via Wikimedia Commons — https://commons.wikimedia.org/wiki/File:Illuminated_frontispiece_from_the_Makhzan_al-Asrar_(Treasury_of_Mysteries)_LACMA_M.73.5.529.jpg | Public domain (work of 15th century; LACMA public-domain image) — cropped |

Selection rules: freely licensed (CC BY / CC BY-SA / public domain) photographs with an Afghanistan
subject, no flags, no official seals or emblems, no identifiable private persons in the frame.

## hero-help.jpg

Photograph from Wikimedia Commons for the `/help` hero. Attribution is shown as a small caption on the
picture, linking to the Commons file page. Processing: cropped to a wide frame, resized (1600 px), slight
contrast adjustment (≈ +3 %), JPEG q78 progressive. No other changes.

| File | Subject | Author / source | Licence |
|---|---|---|---|
| `hero-help.jpg` | Computer lab at Herat University (empty room, 19 June 2011) | S.K. Vemmer, U.S. Department of State (U.S. Embassy Kabul), via Wikimedia Commons — https://commons.wikimedia.org/wiki/File:Computer_lab_at_Herat_University.jpg | Public domain (work of a U.S. federal government employee) — cropped |

## about-hero-kabul.jpg · about-minaret.jpg (About page)

Both files were supplied by the client on 2026-10-20 (replacing the earlier Wikimedia Commons crops
`hero-about.jpg` and `about-kabul.jpg`). Processing: resized to 1600 px, JPEG q78–80 progressive; no other changes.

| File | Used on | Subject | Author / source | Licence |
|---|---|---|---|---|
| `about-hero-kabul.jpg` | `/about` hero | "Morning Panorama of Kabul, Afghanistan" — city skyline with the mountains at sunrise, 16 Oct 2023 | Qasim Mirzaie, via Pexels — https://www.pexels.com/photo/morning-panorama-of-kabul-afghanistan-18776351/ | [Pexels licence](https://www.pexels.com/license/) (free to use; attribution shown as a caption on the page) |
| `about-minaret.jpg` | `/about` "TMistan in Numbers" band | Historic minaret in a rugged mountain valley | Artwork supplied by the client (`Historic Minaret in a Rugged Mountain Canyon.png`); rendered illustration, not a documentary photograph of a specific monument | Client-supplied; no external attribution |

## kc/ (Knowledge Center)

Screenshots of the TMistan interface itself (production build with the live registry data, English
locale, 1366 px viewport, captured 2026-10-13). No stock or generated imagery.

| File | Shows |
|---|---|
| `fig-search-results.jpg` | Search page with the results for the keyword "technology" |
| `fig-advanced-search.jpg` | Advanced Search panel of the Search page |
| `fig-class-picker.jpg` | Class picker open in Advanced Search (counts per class come from the database) |
| `fig-record-page.jpg` | Record page of 1022-073 (Edifier, OG 1022, page 15-16) |
| `fig-image-search.jpg` | Search by Image mode |
| `fig-data-sources.jpg` | Data Sources & Methodology page (top) |
| `<article-slug>.jpg` (launch articles) | 600×480 thumbnails cropped from the same captures |

Re-capture these after a visible change to the Search, record or Data Sources pages so the
figures keep matching the real interface.

### Law & procedure series (added 2026-11-15)

The fifteen articles on Afghan trademark law, procedure and treaties have no interface to
screenshot, so their 600×480 thumbnails are **typographic cards** rendered from the TMistan design
tokens (ivory background, brand-green band, Source Serif 4 / Inter from the app's own font packages,
the TMistan logo). They are produced by `tools/kc_cards/make_cards.py` — plain typography, no stock,
AI-generated or historic imagery. Re-run the script after changing a title or key fact.

| File | Card text |
|---|---|
| `trademark-registration-process-afghanistan.jpg` | "Application → Gazette" |
| `afghanistan-trademark-law-overview.jpg` | "5 chapters · 36 articles" |
| `what-can-be-registered-as-a-trademark-in-afghanistan.jpg` | "15 excluded categories" |
| `trademark-opposition-in-afghanistan.jpg` | "30 days" |
| `trademark-renewal-and-validity-afghanistan.jpg` | "10 years" |
| `madrid-protocol-afghanistan.jpg` | "26 June 2018" |
| `afghanistan-ip-treaties.jpg` | "2005 → 2021" |
| `trademark-assignment-and-ownership-changes.jpg` | "Assignment · Change · Merger" |
| `well-known-marks-afghanistan.jpg` | "Used in two or more countries" |
| `trademark-infringement-and-penalties-afghanistan.jpg` | "Compensation · Confiscation" |
| `first-use-and-ownership-afghanistan.jpg` | "First use" |
| `how-to-check-if-a-trademark-is-taken-in-afghanistan.jpg` | "6 steps" |
| `nice-classes-for-common-goods-and-services.jpg` | "45 classes" |
| `trademark-search-for-foreign-companies-afghanistan.jpg` | "6-month priority" |
| `glossary-of-afghanistan-trademark-terms.jpg` | "A → Z" |
