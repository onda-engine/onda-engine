//! StatCard — a single metric: a big value, a label beneath it, and a short
//! accent bar. Stacked and centered by the engine's layout pass (taffy) via an
//! `<AbsoluteFill>` + `<Flex>` column; each part fades in on a stagger.

import { AbsoluteFill, Flex, Rect, Text, useVideoConfig } from '@onda/react'
import { DURATION, staggerFrames } from '../motion.js'
import { type Placement, PlacementShift } from '../placement.js'
import { type TextStyleProps, applyTextCase } from '../text-style.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'
import { FadeIn } from './FadeIn.js'

export interface StatCardProps extends TextStyleProps {
  /** The headline metric, e.g. "26.8 fps" or "100×" (number is stringified).
   *  Defaults to "—" so an under-specified card renders a placeholder, not nothing. */
  value?: string | number
  /** The label beneath, e.g. "faster than Remotion". */
  label?: string
  valueSize?: number
  labelSize?: number
  /** Value color (default: theme `text`). */
  valueColor?: string
  /** Label color (default: theme `textMuted`). */
  labelColor?: string
  /** Show the accent rule beneath the value. `true`/undefined → show (theme
   *  accent); `false` → hide; a string → show in that color. Matches the
   *  ondajs/Studio `accent: boolean` contract (a color goes via `accentColor`). */
  accent?: boolean | string
  /** Accent rule color (default: theme `accent`). */
  accentColor?: string
  delay?: TimeInput
  /** Where the stat sits: a region keyword (`'center'`, `'lower-third'`, …) or
   *  normalized `{x,y}` (0–1, stat center). The shared placement contract;
   *  default `'center'` (the historical self-centering). */
  placement?: Placement
}

export function StatCard({
  value = '—',
  label = '',
  valueSize = 180,
  labelSize = 34,
  valueColor,
  labelColor,
  accent = true,
  accentColor,
  fontFamily,
  letterSpacing,
  uppercase,
  delay: delayIn = 0,
  placement,
}: StatCardProps) {
  const { fps } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const theme = useTheme()
  const valueCol = valueColor ?? theme.text
  const labelCol = labelColor ?? theme.textMuted
  // `accent` is a boolean flag in the Studio contract; a string is accepted as
  // a color shorthand. `accentColor` (explicit color) wins.
  const showAccent = accent !== false
  const accentCol = accentColor ?? (typeof accent === 'string' ? accent : theme.accent)
  const family = fontFamily ?? theme.fontFamily

  return (
    // The flex column self-centers; PlacementShift moves the centered stack by
    // the center→placement delta (no-op for the default 'center').
    <PlacementShift placement={placement}>
      <AbsoluteFill justify="center" align="center">
        <Flex direction="column" align="center" gap={Math.round(labelSize * 0.7)}>
          <FadeIn delay={delay} durationInFrames={DURATION.slow}>
            <Text
              fontSize={valueSize}
              color={valueCol}
              fontFamily={family}
              fontWeight={700}
              letterSpacing={letterSpacing ?? Math.round(valueSize * -0.02)}
            >
              {applyTextCase(String(value), { uppercase })}
            </Text>
          </FadeIn>
          {showAccent ? (
            <FadeIn delay={delay + staggerFrames(2)}>
              <Rect
                width={Math.round(valueSize * 0.6)}
                height={6}
                cornerRadius={3}
                fill={accentCol}
              />
            </FadeIn>
          ) : null}
          <FadeIn delay={delay + staggerFrames(4)}>
            <Text fontSize={labelSize} color={labelCol} fontFamily={family}>
              {label}
            </Text>
          </FadeIn>
        </Flex>
      </AbsoluteFill>
    </PlacementShift>
  )
}
