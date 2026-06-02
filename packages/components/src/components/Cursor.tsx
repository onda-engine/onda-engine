//! Cursor — an animated mouse pointer that travels between two canvas points on
//! the house spring and emits a single restrained click ripple on arrival.
//! Ported from ondajs.
//!
//! A full-composition layer: position it with the `from*` / `to*` 0..1 fractions,
//! not placement. The pointer is a scene `<Path>` (the classic arrow outline from
//! ondajs's viewBox `0 0 40 64`), uniformly scaled to `size`. The click ripple is
//! an `<Ellipse>` ring (stroke, no fill) that scales out and fades on arrival.
//!
//! Geometry / pivot notes:
//! - The pointer travels via `useSpringValue` (the house spring, matching
//!   ondajs), with x/y linearly interpolated between the from/to fractions × the
//!   canvas size. The whole pointer hot-spot is placed with an outer `<Group x y>`.
//! - The engine composes a node transform as `point * scale + translate` (scale
//!   about the local origin, then translate). To reproduce ondajs's
//!   `transformOrigin: '4px 2px'`, the pointer tip (viewBox `4,2`) is moved to
//!   the local origin so the click "press" (a brief dip to 0.86 and back) scales
//!   about the tip: outer `<Group x y>` (places the tip) > `<Group scale=press>`
//!   (pivots on the tip) > `<Group scale=size/VIEWBOX>` (px scale) >
//!   `<Group x=-TIP_X y=-TIP_Y>` (tip → origin, in viewBox units) > `<Path>`.
//! - The ripple `<Ellipse>` is centered on the tip via a `-ring/2` offset inside
//!   a tip-origin group, mirroring the `PulsingIndicator` pattern. Everything
//!   uses explicit x/y (no `<Flex>`) so the per-frame scale changes can't trigger
//!   a layout reflow.
//!
//! Backend caveat: `<Path>` renders only on the Vello/GPU backend; the CPU
//! reference rasterizer skips paths, so the pointer is a GPU-only visual.
//!
//! Approximation: ondajs draws the pointer with a CSS `drop-shadow` filter, which
//! the engine has no equivalent for. The shadow is dropped; the pointer keeps its
//! dark edge stroke (`#08080a`) for definition, which is the load-bearing part of
//! the original look.

import { Ellipse, Group, Path, interpolate, useCurrentFrame, useVideoConfig } from '@onda/react'
import { useSpringValue } from '../hooks.js'
import { DURATION } from '../motion.js'

export interface CursorProps {
  /** Start X as a 0..1 fraction of canvas width. */
  fromX?: number
  /** Start Y as a 0..1 fraction of canvas height. */
  fromY?: number
  /** End X as a 0..1 fraction of canvas width. */
  toX?: number
  /** End Y as a 0..1 fraction of canvas height. */
  toY?: number
  /** Frames before the cursor starts moving. */
  delay?: number
  /** Frames to travel from start to end on the house spring. */
  travelDuration?: number
  /** Emit a click ripple on arrival. */
  click?: boolean
  /** Frames after arrival before the click fires. */
  clickDelay?: number
  /** Pointer + ripple color (hex `#rrggbb` / `#rrggbbaa`). */
  color?: string
  /** Pointer height in px. */
  size?: number
}

// ondajs's pointer is authored in a 0..64 (height) viewBox. We scale the path by
// `size / VIEWBOX_H` so the rendered pointer is `size` px tall (and ~0.62·size
// wide, matching the original 40×64 box).
const VIEWBOX_H = 64
// The arrow outline, verbatim from ondajs, in viewBox coordinates.
const POINTER_D = 'M4 2 L4 46 L15 36 L22 54 L30 50 L23 33 L38 33 Z'
// The pointer hot-spot / tip in viewBox coordinates (ondajs's transform origin).
const TIP_X = 4
const TIP_Y = 2

export function Cursor({
  fromX = 0.28,
  fromY = 0.72,
  toX = 0.6,
  toY = 0.42,
  delay = 6,
  travelDuration = DURATION.slow,
  click = true,
  clickDelay = 6,
  color = '#f2f2f4',
  size = 56,
}: CursorProps) {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

  // House spring travel (SPRING_SMOOTH, no overshoot), matching ondajs's
  // `useSpringValue` default.
  const p = useSpringValue({ delay, durationInFrames: travelDuration })

  // Linear x/y between the from/to fractions, driven by the spring progress.
  const x = interpolate(p, [0, 1], [fromX, toX]) * width
  const y = interpolate(p, [0, 1], [fromY, toY]) * height

  // The click fires once the pointer has arrived plus a short beat.
  const clickFrame = delay + travelDuration + clickDelay
  const ripple = click
    ? interpolate(frame, [clickFrame, clickFrame + 14], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 0
  // A brief press-down on the pointer at the click moment.
  const press = click
    ? interpolate(frame, [clickFrame, clickFrame + 4, clickFrame + 9], [1, 0.86, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 1

  // Uniform scale from viewBox units to px so the pointer is `size` tall.
  const scale = size / VIEWBOX_H

  // The ripple ring sizing, mirroring ondajs (ring ≈ 1.4·size, scaling 0.2→1.4).
  const ringSize = size * 1.4
  const rippleScale = interpolate(ripple, [0, 1], [0.2, 1.4])
  const rippleOpacity = interpolate(ripple, [0, 1], [0.6, 0])
  // Match ondajs's small visual nudge of the ring relative to the tip.
  const ringOffsetX = 6
  const ringOffsetY = 4

  return (
    // Outer group places the pointer tip at the interpolated canvas point.
    <Group x={x} y={y}>
      {/* Click ripple — a stroked ring centered on the tip, scaling + fading.
          Drawn first so it reads beneath the pointer. (Scale pivots on the
          ellipse's local origin, the PulsingIndicator-blessed pattern.) */}
      {click && ripple > 0 && ripple < 1 ? (
        <Group x={ringOffsetX} y={ringOffsetY}>
          <Ellipse
            x={-ringSize / 2}
            y={-ringSize / 2}
            width={ringSize}
            height={ringSize}
            stroke={color}
            strokeWidth={2}
            scaleX={rippleScale}
            scaleY={rippleScale}
            opacity={rippleOpacity}
          />
        </Group>
      ) : null}

      {/* Pointer arrow. The press scales about this group's origin — which is
          the hot-spot / tip — so the dip pivots on the tip, matching ondajs's
          `transformOrigin: '4px 2px'`. The path is px-scaled, then offset back
          by the tip (in viewBox units) so viewBox (4,2) lands on the origin. */}
      <Group scaleX={press} scaleY={press}>
        <Group scaleX={scale} scaleY={scale}>
          <Group x={-TIP_X} y={-TIP_Y}>
            <Path d={POINTER_D} fill={color} stroke="#08080a" strokeWidth={2} />
          </Group>
        </Group>
      </Group>
    </Group>
  )
}
