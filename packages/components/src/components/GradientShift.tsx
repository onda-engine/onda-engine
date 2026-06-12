//! GradientShift — a quiet, drifting two-color linear gradient background whose
//! angle rotates at a constant degrees-per-frame. Ported from ondajs.
//!
//! Linear-by-design: the angle is a pure arithmetic function of (frame - delay),
//! with no spring driver. A spring would settle and stop, killing the constant
//! drift that is the whole point. GradientShift joins Typewriter / Marquee as a
//! documented linear-by-design member of the catalog. Low-saturation defaults
//! keep it atmospheric, never focal.
//!
//! Engine port: ondajs renders a CSS `linear-gradient(${angle}deg, from, to)` on
//! an `AbsoluteFill`. Here the same shape is a scene `linearGradient` on a
//! canvas-sized `<Rect>`. CSS gradient angles are direction-based (0deg points
//! up, increasing clockwise) and the gradient line is sized so the two stops land
//! exactly on the canvas's bounding edges; we reproduce that by projecting the
//! gradient line's endpoints through the canvas center for the current angle. The
//! `<Rect>` itself never changes size — only the two endpoint coordinates move —
//! so no layout reflow occurs.
//!
//! Backend caveat: gradients render only on the Vello/GPU backend. The CPU
//! reference rasterizer collapses a gradient to its first stop, so the drift is a
//! GPU-only effect; the CPU output is a flat fill of `from` (the meaningful
//! color, deliberately the first stop).

import { Rect, linearGradient, useCurrentFrame, useVideoConfig } from '@onda/react'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

export interface GradientShiftProps {
  /** Gradient start color (`#rrggbb` / `#rrggbbaa`). Default is the canvas tone
   *  — near-identical to `to`, so the drift reads as a dark-on-dark breath
   *  (default: theme `background`). */
  from?: string
  /** Gradient end color. Default is one step warmer than `from`, intentionally
   *  near-identical so the shift is a whisper rather than a colored wash
   *  (default: theme `surface`). */
  to?: string
  /** Starting gradient angle in degrees (CSS convention: `0deg` points up,
   *  increasing clockwise). Default `135`. */
  angle?: number
  /** Rotation rate in degrees per frame. Keep low — atmospheric, not focal.
   *  At 30fps the default `0.5` produces a 24-second full rotation. */
  speed?: number
  /** Frames before the drift starts. While `frame < delay` the gradient sits at
   *  `angle`. Default `0`. */
  delay?: TimeInput
}

export function GradientShift({
  from: fromProp,
  to: toProp,
  angle = 135,
  speed = 0.5,
  delay: delayIn = 0,
}: GradientShiftProps) {
  const frame = useCurrentFrame()
  const { width, height, fps } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const theme = useTheme()
  const from = fromProp ?? theme.background
  const to = toProp ?? theme.surface

  // Linear-by-design: the angle is a pure function of (frame - delay), clamped so
  // nothing drifts before `delay`. No spring — a constant drift is the point.
  const local = Math.max(0, frame - delay)
  const currentAngle = angle + speed * local

  // Reproduce the CSS linear-gradient geometry. CSS angle 0deg points the
  // gradient "up" (toward bottom→top color travel) and increases clockwise, so
  // the direction unit vector is (sin θ, -cos θ) in screen space (y grows down).
  const rad = (currentAngle * Math.PI) / 180
  const dirX = Math.sin(rad)
  const dirY = -Math.cos(rad)

  // The CSS gradient line passes through the center; its half-length is the
  // projection of the box half-extents onto the line, so the two stops land on
  // the bounding edges for any angle: (|W·sinθ| + |H·cosθ|) / 2.
  const halfLen = (Math.abs(width * dirX) + Math.abs(height * dirY)) / 2

  const cx = width / 2
  const cy = height / 2

  // `from` sits at the start of the gradient line, `to` at the end (CSS: the
  // start is the side the gradient points away from). Keep `from` as the FIRST
  // stop so the CPU fallback collapses to the meaningful color.
  const startX = cx - dirX * halfLen
  const startY = cy - dirY * halfLen
  const endX = cx + dirX * halfLen
  const endY = cy + dirY * halfLen

  return (
    <Rect
      width={width}
      height={height}
      fill={from}
      gradient={linearGradient(
        [startX, startY],
        [endX, endY],
        [
          { offset: 0, color: from },
          { offset: 1, color: to },
        ],
      )}
    />
  )
}
