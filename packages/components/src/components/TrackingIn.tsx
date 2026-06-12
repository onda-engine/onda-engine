//! TrackingIn — letter-spacing tighten + fade. Ported from ondajs.
//!
//! The text begins spread wide and contracts to its resting tracking on the
//! house spring (SPRING_SMOOTH, no overshoot), fading as it settles — a
//! confident, cinematic title entrance.
//!
//! The whole line is ONE engine `<Text>` with real **letter-spacing** (the scene
//! `<Text>` carries a `letterSpacing` prop; `tracking * fontSize` px between
//! glyphs = the CSS `letter-spacing: Xem` semantics of the original) — exact
//! shaping, no per-glyph estimate.
//!
//! Layout note: the line's width changes every frame as the tracking tightens,
//! so it is MEASURED (letter-spacing-aware `useTextMetrics`) and positioned
//! ABSOLUTELY at an explicit `x`/`y`, not as a `<Flex>`/`<AbsoluteFill>` child,
//! where a per-frame width change would make the layout pass reflow (HARD RULE 2).
//!
//! Approximation — blur: ondajs starts the text soft (CSS `blur(8px)`) and
//! sharpens as it settles; the engine has no content-blur primitive. When `blur`
//! is enabled this is a nod — a faint, wider-tracked ghost of the line layered
//! behind the crisp text, fading out as it settles — not a true Gaussian blur.

import { Group, Text, useVideoConfig } from '@onda/react'
import { useSpringValue } from '../hooks.js'
import { DURATION } from '../motion.js'
import { useTextMetrics } from '../text-metrics.js'
import { useTheme } from '../theme.js'
import type { TimeInput } from '../time.js'

export interface TrackingInProps {
  /** The text to settle in. */
  text?: string
  /** Frames before the entrance starts. */
  delay?: TimeInput
  /** Frames until the text settles (default `DURATION.slow` = 24). */
  durationInFrames?: TimeInput
  /** Text color (hex `#rrggbb` / `#rrggbbaa`) (default: theme `text`). */
  color?: string
  /** Starting letter-spacing in em — the text begins spread wide and contracts. */
  fromTracking?: number
  /** Resting letter-spacing in em. */
  tracking?: number
  /** Start the text soft and sharpen as it settles (approximated; see doc). */
  blur?: boolean
  /** Font size in px. */
  fontSize?: number
  /** Loaded font family (e.g. a `--font` passed to `onda render`) (default: theme `fontFamily`). */
  fontFamily?: string
  /** Font weight (display default 600). */
  fontWeight?: number
  /** Italic text. */
  italic?: boolean
  /** Horizontal alignment of the line about `x`. Default `'center'`. */
  align?: 'left' | 'center' | 'right'
  /** @deprecated No longer used — the line now uses real shaped letter-spacing
   *  metrics, so no per-glyph advance estimate is needed. Accepted for compat. */
  advanceFactor?: number
  /** Absolute x anchor of the line (default canvas center). */
  x?: number
  /** Absolute y of the line's top (default vertical center). */
  y?: number
}

export function TrackingIn({
  text = 'Onda',
  delay = 0,
  durationInFrames = DURATION.slow,
  color: colorProp,
  fromTracking = 0.5,
  tracking = -0.02,
  blur = true,
  fontSize = 96,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
  italic = false,
  align = 'center',
  x,
  y,
}: TrackingInProps) {
  const { width, height } = useVideoConfig()
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  // House spring (SPRING_SMOOTH, no overshoot), matching ondajs.
  const progress = useSpringValue({ delay, durationInFrames })

  // Opacity fades 0 → 1 across the settle.
  const opacity = progress

  // Current tracking, contracting from spread → rest: em → engine px.
  const ls = fromTracking + (tracking - fromTracking) * progress
  const trackPx = ls * fontSize

  // ONE engine <Text> with real letter-spacing (exact shaping + tracking, no
  // per-glyph estimate). The line's width changes every frame as it contracts;
  // we MEASURE it (letter-spacing-aware) to keep it centered. Positioned at an
  // explicit x/y, NOT a flex child, so the per-frame width change can't reflow.
  const measured = useTextMetrics(text, fontSize, {
    fontFamily,
    fontWeight,
    letterSpacing: trackPx,
  })
  const lineWidth = measured.width

  const anchorX = x ?? Math.round(width / 2)
  const startX =
    align === 'center' ? anchorX - lineWidth / 2 : align === 'right' ? anchorX - lineWidth : anchorX
  // Vertical: roughly center the single line by offsetting the top by ~half the
  // cap height (matches Typewriter's convention).
  const py = y ?? Math.round(height / 2 - fontSize * 0.6)

  // Optional soft-edge "nod to blur" (the engine has no content blur): a faint,
  // wider-tracked ghost of the line behind the crisp text, fading as it settles.
  const ghostOn = blur && progress < 1
  const ghostOpacity = ghostOn ? (1 - progress) * 0.45 * opacity : 0
  const ghostTrack = trackPx + (1 - progress) * fontSize * 0.06

  return (
    <Group opacity={opacity}>
      {ghostOpacity > 0.001 ? (
        <Text
          x={startX}
          y={py}
          fontSize={fontSize}
          letterSpacing={ghostTrack}
          color={color}
          fontFamily={fontFamily}
          fontWeight={fontWeight}
          italic={italic}
          opacity={ghostOpacity}
        >
          {text}
        </Text>
      ) : null}
      <Text
        x={startX}
        y={py}
        fontSize={fontSize}
        letterSpacing={trackPx}
        color={color}
        fontFamily={fontFamily}
        fontWeight={fontWeight}
        italic={italic}
      >
        {text}
      </Text>
    </Group>
  )
}
