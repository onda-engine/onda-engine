//! StatCard — a single metric: a big value, a label beneath it, and a short
//! accent bar. Stacked and centered by the engine's layout pass (taffy) via an
//! `<AbsoluteFill>` + `<Flex>` column; each part fades in on a stagger.

import { AbsoluteFill, Flex, Rect, Text } from '@onda/react'
import { DURATION, staggerFrames } from '../motion.js'
import { FadeIn } from './FadeIn.js'

export interface StatCardProps {
  /** The headline metric, e.g. "26.8 fps" or "100×". */
  value: string
  /** The label beneath, e.g. "faster than Remotion". */
  label: string
  valueSize?: number
  labelSize?: number
  valueColor?: string
  labelColor?: string
  /** Accent color for the underline bar (default the Onda rose). */
  accent?: string
  fontFamily?: string
  delay?: number
}

export function StatCard({
  value,
  label,
  valueSize = 140,
  labelSize = 34,
  valueColor = '#ffffff',
  labelColor = '#9aa4b2',
  accent = '#d96b82',
  fontFamily,
  delay = 0,
}: StatCardProps) {
  return (
    <AbsoluteFill justify="center" align="center">
      <Flex direction="column" align="center" gap={Math.round(labelSize * 0.7)}>
        <FadeIn delay={delay} durationInFrames={DURATION.slow}>
          <Text fontSize={valueSize} color={valueColor} fontFamily={fontFamily} fontWeight={700}>
            {value}
          </Text>
        </FadeIn>
        <FadeIn delay={delay + staggerFrames(2)}>
          <Rect width={Math.round(valueSize * 0.6)} height={6} cornerRadius={3} fill={accent} />
        </FadeIn>
        <FadeIn delay={delay + staggerFrames(4)}>
          <Text fontSize={labelSize} color={labelColor} fontFamily={fontFamily}>
            {label}
          </Text>
        </FadeIn>
      </Flex>
    </AbsoluteFill>
  )
}
