//! RotateIn — opacity + rotation from `fromDegrees` → 0° on the house spring.
//! Ported from ondajs. The calm landing of the original: no overshoot, a small
//! starting angle (safe zone [-12°, +12°]), one spring driving both fade and
//! settle.
//!
//! Rotation pivots on the transform origin, set here to the composition center
//! (matching ondajs's CSS `transform-origin: center` for centered content), so a
//! centered element settles in place rather than swinging about its top-left.

import { Group, interpolate, spring, useCurrentFrame, useVideoConfig } from '@onda/react'
import type { ReactNode } from 'react'
import { DURATION, SPRING_SMOOTH } from '../motion.js'

export interface RotateInProps {
  /** Frames to wait before starting. */
  delay?: number
  /** Frames to settle to 0° (default `DURATION.base` = 18). */
  durationInFrames?: number
  /** Starting angle in degrees (clockwise). Safe zone: `[-12, +12]`. Default -8. */
  fromDegrees?: number
  children?: ReactNode
}

export function RotateIn({
  delay = 0,
  durationInFrames = DURATION.base,
  fromDegrees = -8,
  children,
}: RotateInProps) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()

  // One spring drives both the fade and the angle settle, so they read as a
  // single motion — mirrors the ondajs source (no overshoot, calm landing).
  const progress = spring({
    frame: frame - delay,
    fps,
    config: SPRING_SMOOTH,
    durationInFrames,
  })

  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
  const opacity = interpolate(progress, [0, 1], [0, 1], clamp)
  const rotation = interpolate(progress, [0, 1], [fromDegrees, 0], clamp)

  return (
    <Group rotation={rotation} opacity={opacity} originX={width / 2} originY={height / 2}>
      {children}
    </Group>
  )
}
