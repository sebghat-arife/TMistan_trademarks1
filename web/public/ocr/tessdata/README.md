# Tesseract language data served to the browser

Search by Image recognises the words in a trademark image **inside the visitor's
browser** (Tesseract.js, WebAssembly). The language models below are fetched
from this directory the first time text recognition is used and are then cached
by the browser (IndexedDB), so the download happens once per device.

| File | Language | Source | Size (gzip) | SHA-256 of the uncompressed file |
| --- | --- | --- | --- | --- |
| `eng.traineddata.gz` | English / Latin script | tesseract-ocr/tessdata_fast @ `87416418657359cb625c412a48b6e1d6d41c29bd` | 1.98 MB | `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2` |
| `fas.traineddata.gz` | Persian / Dari | same | 0.31 MB | `db1c0a91208aff00d3cf1ed2c1d23f76419afd5f024688b4f71adc3f2ce4a505` |
| `pus.traineddata.gz` | Pashto | same | 1.43 MB | `f15550bfe3a20ca781cf5afb7b2af6ee769c6521cf4bb990848e72856b484600` |

These are byte-identical to the files shipped by Debian's `tesseract-ocr-eng`,
`tesseract-ocr-fas` and `tesseract-ocr-pus` packages (Tesseract 5), so the
offline indexer (`tools/image_index`, native Tesseract) and the browser produce
comparable readings. License: Apache-2.0 (tesseract-ocr/tessdata_fast).

Do not rename the files: Tesseract.js requests `<langPath>/<code>.traineddata.gz`.
If a model is replaced, bump `OCR_MODEL_VERSION` in `web/src/lib/imageSearch/ocr.ts`
(and `tools/image_index/version.py`) so previously indexed rows are re-analysed
and the browser cache key changes.
