//! Spotlight — a soft radial light that grows from radius 0 to its target on the
//! house spring. Ported from ondajs.
//!
//! A full-composition `<Rect>` filled with a radial gradient that is alpha-aware:
//! solid `color` at the center, fading to transparent at the lit edge. This is a
//! reveal, not a fill — anything rendered beneath stays visible outside the disc.
//!
//! ondajs renders this as a CSS `radial-gradient` on an `AbsoluteFill`. Here the
//! same shape is expressed as a scene `radialGradient` on a canvas-sized `Rect`,
//! with the gradient's `radius` (not the Rect) animating — so the node's measured
//! size never changes and no layout reflow occurs.
//!
//! Backend caveat: gradients render only on the Vello/GPU backend. The CPU
//! reference rasterizer collapses a gradient to its first stop (the solid light
//! color), so the soft reveal is a GPU-only effect.

import { Rect, radialGradient, useVideoConfig } from '@onda/react'
import { useSpringValue } from '../hooks.js'
import { DURATION } from '../motion.js'

export interface SpotlightProps {
  /** Horizontal center of the spotlight as a 0–1 fraction of canvas width. */
  x?: number
  /** Vertical center of the spotlight as a 0–1 fraction of canvas height. */
  y?: number
  /** Final radius as a percentage of the canvas's smaller dimension. */
  radius?: number
  /** Frames before the reveal starts. */
  delay?: number
  /** Frames until the spotlight reaches its full radius. */
  durationInFrames?: number
  /** Light color (hex `#rrggbb` / `#rrggbbaa`). */
  color?: string
  /** Gradient softness — % of the radius given over to the fade-to-transparent
   *  tail. `0` is a hard disc; `100` fades from the very center. */
  softness?: number
}

export function Spotlight({
  x = 0.5,
  y = 0.5,
  radius = 40,
  delay = 0,
  durationInFrames = DURATION.slow,
  color = '#f2f2f4',
  softness = 60,
}: SpotlightProps) {
  const { width, height } = useVideoConfig()

  // House spring (SPRING_SMOOTH, no overshoot), matching ondajs.
  const progress = useSpringValue({ delay, durationInFrames })

  // Map the % radius onto the smaller canvas dimension so the spotlight reads
  // the same regardless of aspect ratio, then grow it 0 → target.
  const minDimension = Math.min(width, height)
  const radiusPx = progress * (radius / 100) * minDimension

  // Center in the Rect's local space (the Rect is the full canvas at origin).
  const cx = x * width
  const cy = y * height

  // The inner solid stop holds `color` for the first (100 - softness)% of the
  // radius, then fades to transparent across the last `softness`%.
  const innerOffset = Math.min(1, Math.max(0, 1 - softness / 100))

  // A transparent version of `color`: same RGB, zero alpha. Append/replace the
  // 2-hex alpha channel so the fade is to fully transparent (not to black).
  const transparent = toTransparent(color)

  // Below ~1px the gradient is degenerate; render a fully-transparent fill until
  // the disc opens (visually identical to "no light yet").
  if (radiusPx < 1) {
    return <Rect width={width} height={height} fill={transparent} />
  }

  // Three stops, always ending transparent: solid `color` from the center out to
  // `innerOffset`, then fading to transparent at offset 1. The engine pads a
  // gradient's LAST stop beyond `radius` (peniko `Extend::Pad`), so the
  // transparent tail must be the final stop — otherwise the canvas-sized Rect
  // would fill opaque beyond the disc and the reveal would become a fill. At
  // `softness=0` the solid stop sits at offset 1 alongside the transparent one
  // (a hard disc edge), matching ondajs's CSS `color radiusPx, transparent
  // radiusPx`.
  return (
    <Rect
      width={width}
      height={height}
      gradient={radialGradient([cx, cy], radiusPx, [
        { offset: 0, color },
        { offset: innerOffset, color },
        { offset: 1, color: transparent },
      ])}
    />
  )
}

/** Return `color` with its alpha channel forced to `00` (fully transparent),
 *  preserving the RGB so the gradient fades out rather than toward black. */
function toTransparent(color: string): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    if (hex.length === 6 || hex.length === 8) {
      return `#${hex.slice(0, 6)}00`
    }
    if (hex.length === 3) {
      const r = hex[0] ?? '0'
      const g = hex[1] ?? '0'
      const b = hex[2] ?? '0'
      return `#${r}${r}${g}${g}${b}${b}00`
    }
  }
  // Unknown format — fall back to a known-transparent value.
  return '#00000000'
}
