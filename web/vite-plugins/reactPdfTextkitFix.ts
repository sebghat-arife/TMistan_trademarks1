import type { Plugin } from 'vite'

/**
 * Build-time fixes for @react-pdf/textkit 7.0.1 (react-pdf 4.9.0) — Arabic/Persian/Pashto text.
 *
 * Fonts such as Noto Naskh Arabic shape most letters as a dotless base glyph plus a
 * zero-advance "dot" mark glyph positioned through GPOS. textkit mishandles those marks in
 * three places; without the fixes a Dari/Pashto PDF prints "شماره" as "ٔماره" and puts the
 * dots of every letter over its neighbour. The transforms below apply the smallest possible
 * source changes to the shipped ESM; each one is a no-op when the pattern is not found, so a
 * future react-pdf upgrade that includes the upstream fixes cannot break the build.
 *
 *  1. run/slice start boundary dropped the base glyph of a decomposed letter at the start of
 *     every line/run.           https://github.com/diegomura/react-pdf/issues/3555 (PR #3577)
 *  2. GPOS xOffset/yOffset were scaled to points but rendered as 1/1000 em, and the GPOS
 *     yOffset was overwritten.  https://github.com/diegomura/react-pdf/issues/3576
 *  3. Bidi reordering reverses the glyph array so a mark now *precedes* its base, but its
 *     x offset was measured from the pen position *after* the base; add the base advance.
 *  4. `letterSpacing` was added to the advance of zero-advance mark glyphs too, detaching the
 *     dots from their letters (and defeating fix 3, which identifies marks by zero advance).
 *
 * Verified against fontkit's native RTL layout (same glyph positions) — see docs/PDF_REPORT.md.
 * Remove this plugin once the project is on a react-pdf release that renders Arabic marks
 * correctly (the plugin logs "nothing to patch" at build time in that case).
 */

interface Patch {
  name: string
  needle: string
  replacement: string
}

const PATCHES: Patch[] = [
  {
    name: 'slice start boundary (react-pdf#3555)',
    needle: 'const startIndex = glyphIndexAt(start, run);',
    replacement: [
      'let startIndex = glyphIndexAt(start, run);',
      '/* tmistan: start boundary must use the FIRST glyph of a decomposed character */',
      'if (run.glyphIndices) { while (startIndex > 0 && startIndex < run.glyphIndices.length && run.glyphIndices[startIndex - 1] === run.glyphIndices[startIndex]) startIndex -= 1; }',
    ].join('\n    '),
  },
  {
    name: 'letter spacing on zero-advance marks',
    needle: '        const xSpacing = isLast ? 0 : characterSpacing;',
    replacement: [
      '        /* tmistan: letter spacing must not push a zero-advance mark away from its base glyph */',
      '        const xSpacing = isLast || position.xAdvance === 0 ? 0 : characterSpacing;',
    ].join('\n'),
  },
  {
    name: 'GPOS mark offsets units (react-pdf#3576)',
    needle: [
      '    for (let i = 0; i < run.positions.length; i += 1) {',
      '        run.positions[i].yOffset = yOffset;',
      '    }',
    ].join('\n'),
    replacement: [
      '    /* tmistan: keep the GPOS offsets (scaled to points by scalePositions) and convert them to the',
      '       1/1000 em unit that @react-pdf/render expects, instead of discarding them */',
      '    const toPerMille = run.attributes?.fontSize ? 1000 / run.attributes.fontSize : 0;',
      '    for (let i = 0; i < run.positions.length; i += 1) {',
      '        const p = run.positions[i];',
      '        p.xOffset = (p.xOffset || 0) * toPerMille;',
      '        p.yOffset = yOffset + (p.yOffset || 0) * toPerMille;',
      '    }',
    ].join('\n'),
  },
  {
    name: 'mark offsets after bidi reversal',
    needle: '    const positions = [...(run.positions || [])].reverse();\n    return {\n        run: {\n            ...run,\n            glyphs,\n            positions,',
    replacement: [
      '    const positions = [...(run.positions || [])].reverse();',
      '    /* tmistan: after reversal a zero-advance mark precedes its base glyph; its GPOS x offset was',
      '       measured from the pen position after the base, so shift it by the base advance */',
      '    {',
      '        const toPerMille = run.attributes?.fontSize ? 1000 / run.attributes.fontSize : 0;',
      '        for (let i = 0; i < positions.length; i += 1) {',
      '            if (positions[i].xAdvance !== 0) continue;',
      '            let j = i + 1;',
      '            while (j < positions.length && positions[j].xAdvance === 0) j += 1;',
      '            if (j < positions.length) positions[i] = { ...positions[i], xOffset: (positions[i].xOffset || 0) + positions[j].xAdvance * toPerMille };',
      '        }',
      '    }',
      '    return {',
      '        run: {',
      '            ...run,',
      '            glyphs,',
      '            positions,',
    ].join('\n'),
  },
]

/** Apply the patches to the textkit source. Pure; returns the names of the patches applied. */
export function patchTextkitSource(code: string): { code: string; applied: string[]; missing: string[] } {
  const applied: string[] = []
  const missing: string[] = []
  let out = code
  for (const p of PATCHES) {
    if (out.includes(p.needle)) {
      out = out.replace(p.needle, p.replacement)
      applied.push(p.name)
    } else {
      missing.push(p.name)
    }
  }
  return { code: out, applied, missing }
}

export function reactPdfTextkitFix(): Plugin {
  let reported = false
  return {
    name: 'tmistan:react-pdf-textkit-fix',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]@react-pdf[\\/]textkit[\\/]/.test(id)) return null
      const { code: patched, applied, missing } = patchTextkitSource(code)
      if (!reported) {
        reported = true
        if (applied.length === 0) this.info('@react-pdf/textkit: nothing to patch — vite-plugins/reactPdfTextkitFix.ts can probably be removed')
        else if (missing.length) this.warn(`@react-pdf/textkit: applied ${applied.join(', ')}; NOT found: ${missing.join(', ')} — re-check Arabic PDF output`)
        else this.info(`@react-pdf/textkit: applied ${applied.length} fixes — ${applied.join(', ')}`)
      }
      if (applied.length === 0) return null
      return { code: patched, map: null }
    },
  }
}
