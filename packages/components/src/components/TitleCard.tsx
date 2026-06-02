//! TitleCard — a centered title with an optional subtitle, each fading in with a
//! short stagger. Composes `FadeIn` (layout-safe) inside an `<AbsoluteFill>` +
//! `<Flex>` column, so the engine's layout pass (taffy) handles the centering
//! and vertical stacking — no manual x/y math.

import { AbsoluteFill, Flex, Text } from '@onda/react'
import { DURATION, staggerFrames } from '../motion.js'
import { FadeIn } from './FadeIn.js'

export interface TitleCardProps {
  title: string
  subtitle?: string
  /** Title font size in px (default 96). */
  titleSize?: number
  /** Subtitle font size in px (default 36). */
  subtitleSize?: number
  titleColor?: string
  subtitleColor?: string
  /** Loaded font family for both lines (e.g. a `--font` passed to `onda render`). */
  fontFamily?: string
  /** Frame the title begins fading in (subtitle follows by one stagger step). */
  delay?: number
}

export function TitleCard({
  title,
  subtitle,
  titleSize = 96,
  subtitleSize = 36,
  titleColor = '#ffffff',
  subtitleColor = '#9aa4b2',
  fontFamily,
  delay = 0,
}: TitleCardProps) {
  return (
    <AbsoluteFill justify="center" align="center">
      <Flex direction="column" align="center" gap={Math.round(subtitleSize * 0.8)}>
        <FadeIn delay={delay} durationInFrames={DURATION.slow}>
          <Text fontSize={titleSize} color={titleColor} fontFamily={fontFamily} fontWeight={700}>
            {title}
          </Text>
        </FadeIn>
        {subtitle ? (
          <FadeIn delay={delay + staggerFrames(2)} durationInFrames={DURATION.base}>
            <Text fontSize={subtitleSize} color={subtitleColor} fontFamily={fontFamily}>
              {subtitle}
            </Text>
          </FadeIn>
        ) : null}
      </Flex>
    </AbsoluteFill>
  )
}
