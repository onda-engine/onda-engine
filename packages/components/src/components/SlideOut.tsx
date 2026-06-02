//! SlideOut — directional translate + fade out on the house ease. `direction`
//! names where the element leaves toward (`'down'` drops it). Place absolutely
//! (it applies a translate the layout pass would otherwise own).

import { Group, useCurrentFrame } from '@onda/react'
import type { ReactNode } from 'react'
import { exitSlide } from '../choreography.js'
import { DURATION } from '../motion.js'

export interface SlideOutProps {
  delay?: number
  durationInFrames?: number
  /** Direction the element leaves toward (default `'down'`). */
  direction?: 'up' | 'down' | 'left' | 'right'
  distance?: number
  children?: ReactNode
}

export function SlideOut({
  delay = 0,
  durationInFrames = DURATION.fast,
  direction = 'down',
  distance = 12,
  children,
}: SlideOutProps) {
  const frame = useCurrentFrame()
  const { opacity, x, y } = exitSlide({ frame, delay, durationInFrames, direction, distance })
  return (
    <Group x={x} y={y} opacity={opacity}>
      {children}
    </Group>
  )
}
