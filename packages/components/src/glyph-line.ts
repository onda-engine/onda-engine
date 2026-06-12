//! Glyph line — the ONE per-glyph text-layout primitive.
//!
//! SlotMachineRoll, KineticText(+wave) and MatrixDecode each re-implemented
//! glyph layout (cursor loops, byte decoding, alignment math, baseline nudges)
//! — which is exactly why their centering/positioning used to diverge. This
//! module is the single path:
//!
//! - {@link layoutGlyphLine} — one line → positioned cells. MEASURED advances
//!   by default (kerning-accurate `glyphLayout`, letter-spacing folded in), or
//!   a fixed {@link GlyphLineOpts.cellAdvance} for column-locked reels (the
//!   slot machine's monospace cell).
//! - {@link lineStartX} — the alignment anchor → left-edge x (left/center/right).
//! - {@link lineTopY} — the house vertical-centering nudge (anchor − 0.6×size,
//!   half the 1.2 line box) every single-line text component uses.
//!
//! Components built on this inherit the placement contract (#1), real
//! measurement (#2) and clip-aware timing (#3) for free — layout is no longer
//! something a text component re-invents.

import { type GlyphInfo, type MeasureOpts, glyphLayout } from './text-metrics.js'

/** Engine line-box height as a multiple of font size (typography crate). */
export const LINE_RATIO = 1.2

/** One laid-out character cluster. */
export interface GlyphCell {
  /** The cluster's text (one user-perceived character). */
  ch: string
  /** Pen x of the cluster's left edge, relative to the line's left edge. */
  x: number
  /** Advance width to the next cluster (kerning + letter-spacing included). */
  width: number
  /** Index among ALL cells (spaces included) — the historical stagger index. */
  index: number
  /** Index among RENDERED (non-space) cells, or -1 for whitespace. */
  renderIndex: number
  /** True for whitespace cells (advance only; usually not drawn). */
  space: boolean
}

/** A laid-out single line. */
export interface GlyphLine {
  /** Every cluster, spaces included, left-to-right. */
  cells: GlyphCell[]
  /** The non-space cells (what actually draws). */
  rendered: GlyphCell[]
  /** Total advance width of the line (px). */
  width: number
  /** Line-box height (`fontSize × 1.2`). */
  height: number
}

export interface GlyphLineOpts extends MeasureOpts {
  /** Fixed per-character advance instead of measured shaping — for column-
   *  locked layouts (e.g. the slot-roll's estimated monospace cell). Receives
   *  the character; returns its advance in px. */
  cellAdvance?: (ch: string) => number
}

/** Lay out one line of text as positioned glyph cells. Measured, kerning-
 *  accurate advances by default (one `glyphLayout` call; estimate fallback
 *  until the wasm engine warms); fixed `cellAdvance` when supplied. */
export function layoutGlyphLine(
  text: string,
  fontSize: number,
  opts: GlyphLineOpts = {},
): GlyphLine {
  const { cellAdvance, ...measure } = opts
  const cells: GlyphCell[] = []
  let rendered = 0

  if (cellAdvance) {
    // Fixed-cell path: a simple cursor over user-perceived characters.
    let x = 0
    for (const ch of text) {
      const width = cellAdvance(ch)
      const space = ch.trim().length === 0
      cells.push({ ch, x, width, index: cells.length, renderIndex: space ? -1 : rendered, space })
      if (!space) rendered++
      x += width
    }
  } else {
    // Measured path: one kerning-accurate glyphLayout call. Byte offsets are
    // UTF-8; decode each cluster's bytes by range (JS strings are UTF-16).
    const clusters: GlyphInfo[] = glyphLayout(text, fontSize, measure)
    const bytes = new TextEncoder().encode(text)
    const decoder = new TextDecoder()
    for (const g of clusters) {
      const ch = decoder.decode(bytes.subarray(g.start, g.end))
      const space = ch.trim().length === 0
      cells.push({
        ch,
        x: g.x,
        width: g.advance,
        index: cells.length,
        renderIndex: space ? -1 : rendered,
        space,
      })
      if (!space) rendered++
    }
  }

  const last = cells[cells.length - 1]
  return {
    cells,
    rendered: cells.filter((c) => !c.space),
    width: last ? last.x + last.width : 0,
    height: fontSize * LINE_RATIO,
  }
}

/** Left-edge x of a line of `lineWidth` aligned about `anchorX` — the single
 *  alignment formula ('center' centers on the anchor, 'right' ends at it,
 *  'left' starts at it). */
export function lineStartX(
  align: 'left' | 'center' | 'right',
  anchorX: number,
  lineWidth: number,
): number {
  return align === 'center'
    ? anchorX - lineWidth / 2
    : align === 'right'
      ? anchorX - lineWidth
      : anchorX
}

/** Top y of a single line whose VERTICAL CENTER should sit at `anchorY` — the
 *  house nudge (`anchor − 0.6×fontSize`, half the 1.2 line box), rounded like
 *  every text component historically did. */
export function lineTopY(anchorY: number, fontSize: number): number {
  return Math.round(anchorY - fontSize * 0.6)
}
