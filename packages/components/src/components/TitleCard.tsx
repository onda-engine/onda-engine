//! TitleCard — a centered title with an optional subtitle, each fading in with a
//! short stagger. Composes `FadeIn` (layout-safe) inside an `<AbsoluteFill>` +
//! `<Flex>` column, so the engine's layout pass (taffy) handles the centering
//! and vertical stacking — no manual x/y math.
//!
//! Colors and font default to the active {@link useTheme} (text / textMuted /
//! heading family); pass explicit props to override.

import { AbsoluteFill, Flex, Text } from '@onda/react'
import { DURATION, staggerFrames } from '../motion.js'
import { useTheme } from '../theme.js'
import { FadeIn } from './FadeIn.js'

export interface TitleCardProps {
  title: string
  subtitle?: string
  /** Title font size in px (default 96). */
  titleSize?: number
  /** Subtitle font size in px (default 36). */
  subtitleSize?: number
  /** Title color (default: theme `text`). */
  titleColor?: string
  /** Subtitle color (default: theme `textMuted`). */
  subtitleColor?: string
  /** Loaded font family (default: theme heading family, else body family). */
  fontFamily?: string
  /** Frame the title begins fading in (subtitle follows by one stagger step). */
  delay?: number
}

export function TitleCard({
  title,
  subtitle,
  titleSize = 96,
  subtitleSize = 36,
  titleColor,
  subtitleColor,
  fontFamily,
  delay = 0,
}: TitleCardProps) {
  const theme = useTheme()
  const titleCol = titleColor ?? theme.text
  const subtitleCol = subtitleColor ?? theme.textMuted
  const family = fontFamily ?? theme.headingFamily ?? theme.fontFamily

  return (
    <AbsoluteFill justify="center" align="center">
      <Flex direction="column" align="center" gap={Math.round(subtitleSize * 0.8)}>
        <FadeIn delay={delay} durationInFrames={DURATION.slow}>
          <Text fontSize={titleSize} color={titleCol} fontFamily={family} fontWeight={700}>
            {title}
          </Text>
        </FadeIn>
        {subtitle ? (
          <FadeIn delay={delay + staggerFrames(2)} durationInFrames={DURATION.base}>
            <Text fontSize={subtitleSize} color={subtitleCol} fontFamily={family}>
              {subtitle}
            </Text>
          </FadeIn>
        ) : null}
      </Flex>
    </AbsoluteFill>
  )
}
