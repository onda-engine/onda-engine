//! ScaleIn — opacity + scale from `from` → 1 on the house spring. Restrained by
//! design (default 0.9).
//!
//! Scale pivots on the transform origin, set here to the composition center
//! (matching ondajs's CSS `transform-origin: center` for centered content), so a
//! centered element grows in place instead of drifting toward its top-left.

import { Group, useCurrentFrame, useVideoConfig } from '@onda-engine/react'
import type { ReactNode } from 'react'
import { entryScale } from '../choreography.js'
import { DURATION } from '../motion.js'
import type { TimeInput } from '../time.js'

export interface ScaleInProps {
  delay?: TimeInput
  durationInFrames?: TimeInput
  /** Starting scale (default 0.9; below ~0.85 reads as dramatic zoom). */
  from?: number
  children?: ReactNode
}

export function ScaleIn({
  delay = 0,
  durationInFrames = DURATION.base,
  from = 0.9,
  children,
}: ScaleInProps) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const { opacity, scaleX, scaleY } = entryScale({ frame, fps, delay, durationInFrames, from })
  return (
    <Group
      scaleX={scaleX}
      scaleY={scaleY}
      opacity={opacity}
      originX={width / 2}
      originY={height / 2}
    >
      {children}
    </Group>
  )
}
