//! TitleCard — a centered title with an optional subtitle, each fading in with a
//! short stagger. Composes `FadeIn` (layout-safe) inside an `<AbsoluteFill>` +
//! `<Flex>` column, so the engine's layout pass (taffy) handles the centering
//! and vertical stacking — no manual x/y math.
//!
//! Colors and font default to the active {@link useTheme} (text / textMuted /
//! heading family); pass explicit props to override.

import { AbsoluteFill, Flex, Text, useVideoConfig } from '@onda/react'
import { useFittedFontSize } from '../bounds.js'
import { DURATION, staggerFrames } from '../motion.js'
import { type Placement, PlacementShift } from '../placement.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'
import { FadeIn } from './FadeIn.js'

export interface TitleCardProps {
  title: string
  subtitle?: string
  /** Title font size in px (default 120). */
  titleSize?: number
  /** Opt-in auto-fit: `'frame'` scales the TITLE size DOWN (never up) so the
   *  title line cannot exceed the frame minus the safe margins. Default
   *  `'none'` (the historical behavior). */
  fit?: 'none' | 'frame'
  /** Explicit width cap in px for the title line; combines with `fit` (the
   *  smaller cap wins). */
  maxWidth?: number
  /** Subtitle font size in px (default 36). */
  subtitleSize?: number
  /** Title color (default: theme `text`). */
  titleColor?: string
  /** Subtitle color (default: theme `textMuted`). */
  subtitleColor?: string
  /** Loaded font family (default: theme heading family, else body family). */
  fontFamily?: string
  /** Frame the title begins fading in (subtitle follows by one stagger step). */
  delay?: TimeInput
  /** Where the card sits: a region keyword (`'center'`, `'lower-third'`, …) or
   *  normalized `{x,y}` (0–1, card center). The shared placement contract;
   *  default `'center'` (the historical self-centering). */
  placement?: Placement
}

export function TitleCard({
  title,
  subtitle,
  titleSize: titleSizeProp = 120,
  fit,
  maxWidth,
  subtitleSize = 36,
  titleColor,
  subtitleColor,
  fontFamily,
  delay: delayIn = 0,
  placement,
}: TitleCardProps) {
  const { fps } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const theme = useTheme()
  const titleCol = titleColor ?? theme.text
  const subtitleCol = subtitleColor ?? theme.textMuted
  const family = fontFamily ?? theme.headingFamily ?? theme.fontFamily

  // Opt-in auto-fit on the title line (tracking scales with the size).
  const titleSize = useFittedFontSize(title, titleSizeProp, {
    fontFamily: family,
    fontWeight: 700,
    letterSpacing: Math.round(titleSizeProp * -0.02),
    fit,
    maxWidth,
  })

  return (
    <PlacementShift placement={placement}>
      <AbsoluteFill justify="center" align="center">
        <Flex direction="column" align="center" gap={Math.round(subtitleSize * 0.8)}>
          <FadeIn delay={delay} durationInFrames={DURATION.slow}>
            <Text
              fontSize={titleSize}
              color={titleCol}
              fontFamily={family}
              fontWeight={700}
              letterSpacing={Math.round(titleSize * -0.02)}
            >
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
    </PlacementShift>
  )
}
