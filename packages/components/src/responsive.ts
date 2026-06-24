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

/** The aspect bucket of an output canvas — landscape (w>h) / portrait (h>w) / square. */
export type OutputAspect = 'portrait' | 'landscape' | 'square'

/** Per-entry Magic-Resize BEHAVIOUR — refines how `fit:"responsive"` re-frames THIS
 *  element onto an off-design output canvas. Every field is optional; absent = today's
 *  default (pin its design anchor + uniform fit). Only meaningful for positioned
 *  (Keyframes) entries on a responsive scene whose output differs from the design canvas.
 *  Read by the @onda-engine/cinema EXPORT and the Studio live PREVIEW so the two can't drift. */
export interface ResponsiveBehavior {
  /** Aspect buckets in which this entry is DROPPED entirely (culled, not rendered) —
   *  e.g. `['portrait']` hides a wide element that only reads in landscape. */
  hideOn?: OutputAspect[]
  /** Keep the re-anchored element inside the canvas SAFE AREA: `true` uses the default
   *  margin, a number (0–0.5) overrides it. Stops an element drifting to the very edge
   *  on an extreme aspect flip. */
  safeArea?: boolean | number
  /** Clamp the uniform fit SCALE so the element never shrinks below / grows past these
   *  multiples of its design size (e.g. keep a caption legible in a tall frame). */
  minScale?: number
  maxScale?: number
}

/** How close (as a fraction of the canvas) an element's anchor must sit to an edge
 *  to PIN to that edge instead of tracking the centre — the outer fifth each side. */
const EDGE = 0.2

/** Default safe-area inset (fraction of each axis) for `ResponsiveBehavior.safeArea` —
 *  matches placement.ts's `SAFE_MARGIN` so re-anchored and self-placing elements share
 *  the same breathing room. */
const SAFE_AREA = 0.1

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

/** An element whose rendered size reaches at least this fraction of BOTH design axes is
 *  treated as a full-bleed plate (a background) — re-framed by COVER, not the per-element FIT,
 *  so it keeps filling the frame on an aspect flip instead of letterboxing into dead space. */
const FULL_BLEED = 0.9

const mean = (ns: number[]): number => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0)

/** The mean of an element's scale track (default 1) — the uniform size multiplier on its content. */
function meanScale(props: Record<string, unknown> | undefined): number {
  const scaleTrack = props?.scale as ValKey[] | undefined
  return Array.isArray(scaleTrack) && scaleTrack.length ? mean(scaleTrack.map((k) => k.v)) : 1
}

/** Whether an element is a full-bleed background plate: image/video content whose rendered size
 *  (content size × scale) covers ≥{@link FULL_BLEED} of BOTH design axes. Such plates must COVER
 *  the output (scale by the LARGER axis ratio), never FIT it (the smaller ratio) — fitting a
 *  background on an aspect flip (16:9 → 9:16) shrinks it to a band with dead space top and bottom. */
export function isFullBleed(props: Record<string, unknown> | undefined, design: Box): boolean {
  const content = props?.content as { kind?: string; width?: number; height?: number } | undefined
  if (!content || (content.kind !== 'image' && content.kind !== 'video')) return false
  if (!content.width || !content.height) return false
  const s = meanScale(props)
  return (
    content.width * s >= FULL_BLEED * design.width &&
    content.height * s >= FULL_BLEED * design.height
  )
}

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

/** The aspect bucket of an output canvas. */
export function outputAspect(out: Box): OutputAspect {
  if (out.width > out.height) return 'landscape'
  if (out.height > out.width) return 'portrait'
  return 'square'
}

/** Whether a per-entry behaviour DROPS this element on the given output — the shared
 *  cull predicate (export + preview both call it so visibility can't drift between them). */
export function isHiddenForOutput(behavior: ResponsiveBehavior | undefined, out: Box): boolean {
  return !!behavior?.hideOn?.includes(outputAspect(out))
}

/** Clamp a fit scale to a behaviour's min/max bounds (no-op when neither is set). */
function clampScale(s: number, behavior: ResponsiveBehavior): number {
  let v = s
  if (typeof behavior.minScale === 'number') v = Math.max(v, behavior.minScale)
  if (typeof behavior.maxScale === 'number') v = Math.min(v, behavior.maxScale)
  return v
}

/** The per-element Magic-Resize transform: anchor pinned per-axis, size scaled
 *  uniformly by the smaller axis ratio so the element always fits the frame and never
 *  distorts. A `null` anchor or a matching canvas ⇒ identity (the element self-places).
 *  An optional `behavior` clamps the scale (legibility) and/or keeps the anchor inside
 *  the safe area; `hideOn` is handled by the caller via {@link isHiddenForOutput}. */
export function responsiveEntryTransform(
  anchor: { x: number; y: number } | null,
  design: Box,
  out: Box,
  behavior?: ResponsiveBehavior,
): ResponsiveTransform {
  if (!anchor || (design.width === out.width && design.height === out.height)) {
    return { x: 0, y: 0, scale: 1 }
  }
  // Uniform fit scale, optionally clamped so the element stays legible on extreme flips.
  let s = Math.min(out.width / design.width, out.height / design.height)
  if (behavior) s = clampScale(s, behavior)
  let ax = pinAxis(anchor.x, design.width, out.width, s)
  let ay = pinAxis(anchor.y, design.height, out.height, s)
  // Keep the re-anchored point inside the safe area so it can't hug the very edge.
  if (behavior?.safeArea) {
    const m = typeof behavior.safeArea === 'number' ? behavior.safeArea : SAFE_AREA
    ax = clamp(ax, m * out.width, (1 - m) * out.width)
    ay = clamp(ay, m * out.height, (1 - m) * out.height)
  }
  // Place the element's design anchor at (ax, ay) with its content scaled by s.
  return { x: ax - anchor.x * s, y: ay - anchor.y * s, scale: s }
}

/** COVER re-frame for a full-bleed plate ({@link isFullBleed}): uniformly scale the WHOLE design
 *  canvas by the LARGER axis ratio and centre it on the output, so the plate keeps filling the
 *  frame (overflowing the long axis) instead of fitting into a band with dead space. The translate
 *  is anchor-independent — it just centres the scaled design canvas, preserving every element's
 *  relative position within that plate. Matching canvas ⇒ identity. */
export function responsiveCoverTransform(design: Box, out: Box): ResponsiveTransform {
  if (design.width === out.width && design.height === out.height) {
    return { x: 0, y: 0, scale: 1 }
  }
  const s = Math.max(out.width / design.width, out.height / design.height)
  return {
    x: (out.width - design.width * s) / 2,
    y: (out.height - design.height * s) / 2,
    scale: s,
  }
}
