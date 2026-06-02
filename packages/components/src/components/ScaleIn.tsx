//! ScaleIn — opacity + scale from `from` → 1 on the house spring. Restrained by
//! design (default 0.9).
//!
//! Scene scale is about the node's local origin (0,0), not its center, so a
//! centered element will drift slightly as it scales. For true center growth,
//! anchor the subtree's origin where you want it. (Per-node transform-origin is
//! a planned engine feature.)

import { Group, useCurrentFrame, useVideoConfig } from '@onda/react'
import type { ReactNode } from 'react'
import { entryScale } from '../choreography.js'
import { DURATION } from '../motion.js'

export interface ScaleInProps {
  delay?: number
  durationInFrames?: number
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
  const { fps } = useVideoConfig()
  const { opacity, scaleX, scaleY } = entryScale({ frame, fps, delay, durationInFrames, from })
  return (
    <Group scaleX={scaleX} scaleY={scaleY} opacity={opacity}>
      {children}
    </Group>
  )
}
