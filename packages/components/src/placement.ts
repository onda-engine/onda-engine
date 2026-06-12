//! Placement — the ONE placement contract every placeable component speaks.
//!
//! A `placement` prop accepts either a region keyword (`'center'`,
//! `'lower-third'`, `'top-left'`, …) or a normalized point `{ x, y }` (0..1
//! fractions of the canvas, anchored at the ELEMENT'S CENTER). Default is
//! `'center'`. Components resolve it through {@link usePlacement} (or wrap
//! content in {@link Placed}), so "where does this thing sit" is answered the
//! same way everywhere — no more per-component x/y/centerY dialects. Legacy
//! positioning props (`x`/`y`/`centerX`/`centerY`) remain as deprecated aliases
//! that each component maps onto this contract.
//!
//! Region semantics:
//! - `center` / `upper-third` / `lower-third` anchor the element's CENTER at the
//!   region point (matching the cinema bridge's `PLACEMENT_COORDS`, so existing
//!   Studio compositions keep their geometry).
//! - Edge/corner regions (`top`, `bottom-left`, …) are SAFE-AREA FLUSH when the
//!   element's size is known: the element's edge sits on the 10% safe margin
//!   (the broadcast inset `LowerThird` always used), guaranteed on-frame. When
//!   the size is unknown they fall back to centering on the region point — the
//!   bridge's historical approximation.
//! - `{ x, y }` points are ALWAYS element-center anchored (never flushed).
//!
//! Double-placement note: the cinema bridge keeps a `SELF_ANCHORING` list of
//! components that consume `placement` themselves; every component migrated to
//! this contract must be on that list, or the bridge shifts it a second time.

import { Group, useVideoConfig } from '@onda/react'
import type { ReactNode } from 'react'
import { Fragment, createElement } from 'react'
import { z } from 'zod'

/** The region keywords the placement contract understands. */
export type PlacementRegion =
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'upper-third'
  | 'lower-third'

/** A normalized canvas point — 0..1 fractions, anchored at the element CENTER.
 *  Omitted axes default to 0.5 (centered on that axis). */
export interface PlacementPoint {
  x?: number
  y?: number
}

/** What a `placement` prop accepts: a region keyword or a normalized point. */
export type Placement = PlacementRegion | PlacementPoint

/** Region → fraction of the canvas the element's CENTER targets. Mirrors the
 *  cinema bridge's `PLACEMENT_COORDS` exactly so geometry is stable when a
 *  component graduates from bridge-offset to self-anchoring. */
export const PLACEMENT_REGIONS: Record<PlacementRegion, readonly [number, number]> = {
  center: [0.5, 0.5],
  top: [0.5, 0.1],
  bottom: [0.5, 0.9],
  left: [0.1, 0.5],
  right: [0.9, 0.5],
  'top-left': [0.1, 0.1],
  'top-right': [0.9, 0.1],
  'bottom-left': [0.1, 0.9],
  'bottom-right': [0.9, 0.9],
  'upper-third': [0.5, 0.28],
  'lower-third': [0.5, 0.72],
}

/** Safe-area inset as a fraction of each canvas axis — the broadcast 10% margin
 *  (`LowerThird`'s `REGION_MAP` inset). Edge/corner regions flush to this. */
export const SAFE_MARGIN = 0.1

/** Canvas size in px. */
export interface FrameSize {
  width: number
  height: number
}

/** The element's laid-out size in px, when the component knows it (measured
 *  text, explicit width/height). Lets edge/corner regions sit flush on the safe
 *  margin instead of approximating with a centered anchor. */
export interface ElementSize {
  width?: number
  height?: number
}

/** A resolved placement, in px. */
export interface ResolvedPlacement {
  /** The element's center point. */
  x: number
  y: number
  /** Top-left origin for an element of the given {@link ElementSize} (equals
   *  `x`/`y` when the size is unknown — treat as the center then). */
  originX: number
  originY: number
  /** Offset from the canvas center — what a self-centering component adds to
   *  move its (already centered) assembly onto the placement. (0,0) for
   *  `'center'`. */
  dx: number
  dy: number
}

/** Narrowing helper: is this value a placement region/point at all? Useful for
 *  components that accept legacy props alongside `placement`. */
export function isPlacement(value: unknown): value is Placement {
  if (typeof value === 'string') return value in PLACEMENT_REGIONS
  if (value !== null && typeof value === 'object') {
    const o = value as { x?: unknown; y?: unknown }
    return (
      (o.x === undefined || typeof o.x === 'number') &&
      (o.y === undefined || typeof o.y === 'number')
    )
  }
  return false
}

// Flush a center coordinate so the element edge sits on the safe margin: an
// anchor at the 0.1 edge pushes the element fully inside it; 0.9 pulls it back.
function flushAxis(frac: number, frameDim: number, elemDim: number | undefined): number {
  if (elemDim === undefined || elemDim <= 0) return frac * frameDim
  if (frac <= SAFE_MARGIN) return SAFE_MARGIN * frameDim + elemDim / 2
  if (frac >= 1 - SAFE_MARGIN) return (1 - SAFE_MARGIN) * frameDim - elemDim / 2
  return frac * frameDim
}

/** Resolve a `placement` to canvas px. Pure — see {@link usePlacement} for the
 *  hook form. `element` (when known) lets edge/corner regions sit flush on the
 *  safe margin; `{x,y}` points are always element-center anchored. */
export function resolvePlacement(
  placement: Placement | undefined,
  frame: FrameSize,
  element?: ElementSize,
): ResolvedPlacement {
  let cx: number
  let cy: number
  if (placement !== undefined && typeof placement === 'object') {
    cx = (placement.x ?? 0.5) * frame.width
    cy = (placement.y ?? 0.5) * frame.height
  } else {
    const [fx, fy] = PLACEMENT_REGIONS[placement ?? 'center'] ?? PLACEMENT_REGIONS.center
    cx = flushAxis(fx, frame.width, element?.width)
    cy = flushAxis(fy, frame.height, element?.height)
  }
  const w = element?.width
  const h = element?.height
  return {
    x: cx,
    y: cy,
    originX: w !== undefined && w > 0 ? cx - w / 2 : cx,
    originY: h !== undefined && h > 0 ? cy - h / 2 : cy,
    dx: cx - frame.width / 2,
    dy: cy - frame.height / 2,
  }
}

/** Resolve a `placement` against the live video config. The hook every
 *  placeable component calls. */
export function usePlacement(
  placement: Placement | undefined,
  element?: ElementSize,
): ResolvedPlacement {
  const { width, height } = useVideoConfig()
  return resolvePlacement(placement, { width, height }, element)
}

export interface PlacedProps {
  /** Where the box sits (region keyword or normalized `{x,y}`). Default `'center'`. */
  placement?: Placement
  /** The content's local box width in px (content drawn in `[0,width]×[0,height]`). */
  width?: number
  /** The content's local box height in px. */
  height?: number
  children?: ReactNode
}

/** Place an origin-relative subtree (content drawn from its local top-left in a
 *  `width`×`height` box) per the shared contract: wraps it in a `<Group>` whose
 *  origin puts the box's CENTER at the resolved placement point. */
export function Placed({ placement, width, height, children }: PlacedProps) {
  const resolved = usePlacement(placement, { width, height })
  return createElement(Group, { x: resolved.originX, y: resolved.originY }, children)
}

export interface PlacementShiftProps {
  /** Where the (self-centered) content should sit. `undefined`/`'center'` → no
   *  shift, the tree renders exactly as before. */
  placement?: Placement
  children?: ReactNode
}

/** Move an already self-centering subtree (e.g. an `<AbsoluteFill
 *  justify="center">` card) onto a placement by shifting it by the
 *  center→target delta. The cheap migration path for layout-centered
 *  components whose laid-out size isn't known author-side. */
export function PlacementShift({ placement, children }: PlacementShiftProps) {
  const { dx, dy } = usePlacement(placement)
  // No shift → no wrapper node, so existing (un-placed) scenes stay byte-identical.
  if (dx === 0 && dy === 0) return createElement(Fragment, null, children)
  return createElement(Group, { x: dx, y: dy }, children)
}

/** The Zod schema for a `placement` prop — shared by every component schema so
 *  the Studio agent validates one contract, not eighty dialects. */
export const placementSchema = z.union([
  z.enum([
    'center',
    'top',
    'bottom',
    'left',
    'right',
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right',
    'upper-third',
    'lower-third',
  ]),
  z.object({
    x: z.number().min(0).max(1).optional(),
    y: z.number().min(0).max(1).optional(),
  }),
])

/** Manifest prop-metadata blurb for `placement` — one wording everywhere. */
export const PLACEMENT_DESCRIPTION =
  "Where the element sits: a region keyword ('center', 'lower-third', 'upper-third', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right') or normalized {x,y} (0-1 canvas fractions, anchored at the element's center)."
