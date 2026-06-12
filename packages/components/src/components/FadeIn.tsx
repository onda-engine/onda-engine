//! FadeIn — pure opacity reveal (no motion). Layout-safe: applies only opacity,
//! so it composes cleanly as a child of a `<Flex>`/`<AbsoluteFill>` layout.

import { Group, useCurrentFrame, useVideoConfig } from '@onda/react'
import type { ReactNode } from 'react'
import { entryFade } from '../choreography.js'
import { DURATION } from '../motion.js'
import type { TimeInput } from '../time.js'

export interface FadeInProps {
  /** Frames to wait before starting. */
  delay?: TimeInput
  /** Frames the fade takes to settle (default `DURATION.base` = 18). */
  durationInFrames?: TimeInput
  children?: ReactNode
}

export function FadeIn({ delay = 0, durationInFrames = DURATION.base, children }: FadeInProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const { opacity } = entryFade({ frame, fps, delay, durationInFrames })
  return <Group opacity={opacity}>{children}</Group>
}
