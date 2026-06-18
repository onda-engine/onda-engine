//! responsive.ts — "Magic Resize" layout. Re-frame an absolutely-positioned element
//! from the canvas it was AUTHORED on (its "design" canvas) onto a DIFFERENT output
//! canvas, the way Canva's Magic Resize / Figma constraints do: each element pins to
//! the NEAR edge or tracks the CENTRE, per axis, and its SIZE scales uniformly so it
//! never distorts. This generalises the single uniform `cover`/`contain` fit — which
//! is just "every element pinned to centre at one shared scale" — to PER-ELEMENT
//! anchors, so one master composition adapts to 16:9 / 4:3 / 1:1 / 9:16 with no
//! hand-built per-format variants.
//!
//! Pure math, no React — shared by the @onda-engine/cinema EXPORT and the Studio live
//! PREVIEW so the two can't drift (the same contract as ./keyframes-sampler).

import type { PosKey, ValKey } from './keyframes-sampler.js'

export interface Box {
  width: number
  height: number
}

/** The `<Group>` transform that re-frames a design-space element onto the output. */
export interface ResponsiveTransform {
  x: number
  y: number
  scale: number
}

/** How close (as a fraction of the canvas) an element's anchor must sit to an edge
 *  to PIN to that edge instead of tracking the centre — the outer fifth each side. */
const EDGE = 0.2

const mean = (ns: number[]): number => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0)

/** The representative design-space point an element "lives at" — the mean of its
 *  position track, nudged to the visual CENTRE of image content (whose pivot defaults
 *  to a corner). Returns `null` for elements with NO absolute position: those already
 *  self-place against the output canvas (`placement`), so they must NOT be re-anchored. */
export function entryDesignAnchor(
  props: Record<string, unknown> | undefined,
): { x: number; y: number } | null {
  const position = props?.position as PosKey[] | undefined
  if (!Array.isArray(position) || position.length === 0) return null
  let x = mean(position.map((k) => k.x))
  let y = mean(position.map((k) => k.y))
  // Image tiles pivot at a corner (anchorX/anchorY) and are scaled down — shift the
  // anchor to the tile's visual centre so it pins by where it READS, not its corner.
  const content = props?.content as
    | { kind?: string; width?: number; height?: number; anchorX?: number; anchorY?: number }
    | undefined
  if (content?.kind === 'image' && content.width && content.height) {
    const scaleTrack = props?.scale as ValKey[] | undefined
    const s = Array.isArray(scaleTrack) && scaleTrack.length ? mean(scaleTrack.map((k) => k.v)) : 1
    x += (content.width / 2 - (content.anchorX ?? content.width / 2)) * s
    y += (content.height / 2 - (content.anchorY ?? content.height / 2)) * s
  }
  return { x, y }
}

/** One axis of the pin: map a design anchor coordinate onto the output — pinned to the
 *  near edge, the far edge, or the centre by where it sits — keeping the gap from the
 *  reference proportional to the element's own scale `s`. */
function pinAxis(a: number, design: number, out: number, s: number): number {
  const frac = a / design
  if (frac <= EDGE) return a * s // hug the start edge (left / top)
  if (frac >= 1 - EDGE) return out - (design - a) * s // hug the far edge (right / bottom)
  return out / 2 + (a - design / 2) * s // track the centre
}

/** The per-element Magic-Resize transform: anchor pinned per-axis, size scaled
 *  uniformly by the smaller axis ratio so the element always fits the frame and never
 *  distorts. A `null` anchor or a matching canvas ⇒ identity (the element self-places). */
export function responsiveEntryTransform(
  anchor: { x: number; y: number } | null,
  design: Box,
  out: Box,
): ResponsiveTransform {
  if (!anchor || (design.width === out.width && design.height === out.height)) {
    return { x: 0, y: 0, scale: 1 }
  }
  const s = Math.min(out.width / design.width, out.height / design.height)
  const ax = pinAxis(anchor.x, design.width, out.width, s)
  const ay = pinAxis(anchor.y, design.height, out.height, s)
  // Place the element's design anchor at (ax, ay) with its content scaled by s.
  return { x: ax - anchor.x * s, y: ay - anchor.y * s, scale: s }
}
