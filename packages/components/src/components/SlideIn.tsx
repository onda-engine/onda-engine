//! SlideIn — directional translate + fade on the house spring. `direction` names
//! the settling direction (`'up'` rises into place from below).
//!
//! Applies a translate, so place it in an absolute context (via `x`/`y` on a
//! parent, or inside an `<AbsoluteFill>`) rather than as a measured `<Flex>`
//! child, where the layout pass owns translation.

import { Group, useCurrentFrame, useVideoConfig } from '@onda-engine/react'
import type { ReactNode } from 'react'
import { entrySlide } from '../choreography.js'
import { DURATION } from '../motion.js'
import type { TimeInput } from '../time.js'

export interface SlideInProps {
  delay?: TimeInput
  durationInFrames?: TimeInput
  /** Settling direction (default `'up'`). */
  direction?: 'up' | 'down' | 'left' | 'right'
  /** Travel distance in px (12–24 Onda envelope; default 12). */
  distance?: number
  children?: ReactNode
}

export function SlideIn({
  delay = 0,
  durationInFrames = DURATION.base,
  direction = 'up',
  distance = 12,
  children,
}: SlideInProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const { opacity, x, y } = entrySlide({ frame, fps, delay, durationInFrames, direction, distance })
  return (
    <Group x={x} y={y} opacity={opacity}>
      {children}
    </Group>
  )
}
