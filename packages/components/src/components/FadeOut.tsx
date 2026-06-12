//! FadeOut — opacity 1 → 0 on the house ease. The exit counterpart to FadeIn;
//! `delay` is when the exit begins. Layout-safe (opacity only).

import { Group, useCurrentFrame } from '@onda/react'
import type { ReactNode } from 'react'
import { exitFade } from '../choreography.js'
import { DURATION } from '../motion.js'
import type { TimeInput } from '../time.js'

export interface FadeOutProps {
  /** Frame at which the exit begins. */
  delay?: TimeInput
  /** Frames the fade-out takes (default `DURATION.fast` = 10 — exits are quick). */
  durationInFrames?: TimeInput
  children?: ReactNode
}

export function FadeOut({ delay = 0, durationInFrames = DURATION.fast, children }: FadeOutProps) {
  const frame = useCurrentFrame()
  const { opacity } = exitFade({ frame, delay, durationInFrames })
  return <Group opacity={opacity}>{children}</Group>
}
