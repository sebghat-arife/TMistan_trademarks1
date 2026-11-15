#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * Serve dist/ locally the way the Render static site does
 * (`npm run build && node scripts/serve-dist.mjs [port]`):
 *   • a real file wins (/robots.txt, /assets/…, /sitemap.xml)
 *   • a directory with index.html answers both /path and /path/
 *   • everything else is rewritten to /app.html (the SPA shell), status 200
 *   • /admin/* gets X-Robots-Tag: noindex, nofollow  (render.yaml headers)
 * Local check only — not used in production.
 * ------------------------------------------------------------------------- */
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4180)
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm', '.gz': 'application/gzip',
}

function resolve(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]).replace(/\/+$/, '') || '/'
  const candidate = path.normalize(path.join(DIST, clean))
  if (!candidate.startsWith(DIST)) return null
  if (existsSync(candidate)) {
    const st = statSync(candidate)
    if (st.isFile()) return candidate
    if (st.isDirectory() && existsSync(path.join(candidate, 'index.html'))) return path.join(candidate, 'index.html')
  }
  return null
}

createServer((req, res) => {
  const file = resolve(req.url ?? '/') ?? path.join(DIST, 'app.html')
  const ext = path.extname(file)
  res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream')
  if ((req.url ?? '').startsWith('/admin')) res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  res.statusCode = 200
  createReadStream(file).pipe(res)
}).listen(PORT, '0.0.0.0', () => console.log(`serving ${DIST} on http://127.0.0.1:${PORT} (Render-like rules)`))
