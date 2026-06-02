//! BlurReveal — the reference Onda reveal: opacity + a small rise + a subtle
//! focus-settle scale, all on the house spring (no overshoot). Ported from
//! ondajs.
//!
//! APPROXIMATION: the ondajs original also animates a CSS `blur(10px → 0)` so
//! the text resolves from soft to sharp. The engine has no blur/filter pass, so
//! the blur is DROPPED and the "focus in" sensation is suggested instead by a
//! subtle scale settle (0.97 → 1) running in lockstep with the opacity + rise.
//! When an engine blur pass lands, restore the literal blur ramp.
//!
//! Self-positioning: an `<AbsoluteFill>` centers the content, and the motion
//! (opacity + rise + scale) lives on a NESTED inner `<Group>` — the layout pass
//! owns the outer position, so a motion translate must not sit on a direct
//! AbsoluteFill child.
//!
//! Caveat: scene scale pivots on the inner group's LOCAL ORIGIN (0,0), not its
//! center, so the 0.97 → 1 settle drifts by a few px as it resolves. The
//! magnitude is tiny by design (matches `ScaleIn`'s restraint); for a perfectly
//! centered settle, anchor the subtree's origin at the pivot. (Per-node
//! transform-origin is a planned engine feature.)

import {
  AbsoluteFill,
  Group,
  Text,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import type { ReactNode } from 'react'
import { DURATION, SPRING_SMOOTH } from '../motion.js'

export interface BlurRevealProps {
  /** What to reveal. Rendered as a single-line `<Text>` unless `children` is
   *  provided. */
  text?: string
  /** Custom content to reveal instead of `text` (wins over `text` when both are
   *  given). Lets BlurReveal wrap any subtree, not just a string. */
  children?: ReactNode
  /** Frames before the reveal starts. */
  delay?: number
  /** Frames until the reveal fully settles (default `DURATION.base` = 18). With
   *  `SPRING_SMOOTH` the visible motion settles in roughly this range. */
  durationInFrames?: number
  /** Text color (hex `#rrggbb` / `#rrggbbaa`). Ignored when `children` is set. */
  color?: string
  /** Text size in px. Ignored when `children` is set. */
  fontSize?: number
  /** Loaded font family. Ignored when `children` is set. */
  fontFamily?: string
  /** Font weight (display default 600). Ignored when `children` is set. */
  fontWeight?: number
  /** Vertical placement within the composition. */
  placement?: 'center' | 'top' | 'bottom'
  /** Rise distance in px (the original's 16px envelope; small on purpose). */
  travelPx?: number
  /** Starting scale for the focus-settle (the dropped-blur approximation).
   *  Close to 1 by design — below ~0.92 it reads as a zoom, not a focus-in. */
  fromScale?: number
}

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export function BlurReveal({
  text = 'Onda',
  children,
  delay = 0,
  durationInFrames = DURATION.base,
  color = '#f2f2f4',
  fontSize = 96,
  fontFamily,
  fontWeight = 600,
  placement = 'center',
  travelPx = 16,
  fromScale = 0.97,
}: BlurRevealProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  // One house spring drives opacity, rise, and the focus-settle scale so they
  // read as a single motion — mirrors the ondajs original, where opacity, blur,
  // and the 16px rise all derive from one `SPRING_SMOOTH` progress.
  const progress = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: SPRING_SMOOTH,
    durationInFrames,
  })

  const opacity = interpolate(progress, [0, 1], [0, 1], CLAMP)
  const y = interpolate(progress, [0, 1], [travelPx, 0], CLAMP)
  // Scale stands in for the dropped CSS blur: text "comes into focus" as it
  // settles. Subtle by design.
  const scale = interpolate(progress, [0, 1], [fromScale, 1], CLAMP)

  const justify = placement === 'top' ? 'start' : placement === 'bottom' ? 'end' : 'center'

  const content: ReactNode = children ?? (
    <Text fontSize={fontSize} color={color} fontFamily={fontFamily} fontWeight={fontWeight}>
      {text}
    </Text>
  )

  return (
    <AbsoluteFill justify={justify} align="center">
      {/* Inner group carries the motion translate/scale/opacity; the outer
          AbsoluteFill owns positioning (don't translate a direct layout child). */}
      <Group y={y} scaleX={scale} scaleY={scale} opacity={opacity}>
        {content}
      </Group>
    </AbsoluteFill>
  )
}
