//! TrackingIn — letter-spacing tighten + fade. Ported from ondajs.
//!
//! The text begins spread wide and contracts to its resting tracking on the
//! house spring (SPRING_SMOOTH, no overshoot), fading as it settles — a
//! confident, cinematic title entrance.
//!
//! Per-glyph approximation: the engine `<Text>` node has NO letter-spacing
//! control, so each character is rendered as its own absolutely-positioned
//! `<Text>`. Glyph x-positions interpolate from spread-out to natural advance
//! as the spring settles. Because real per-glyph advances aren't known ahead of
//! the layout pass, the natural advance is ESTIMATED from `fontSize`
//! (`advanceFactor`, default 0.55× — a typical display-sans average). Tracking
//! (em) adds `tracking * fontSize` px between glyphs, matching the CSS
//! `letter-spacing: Xem` semantics of the original. Proportional fonts will
//! drift slightly from a true measured layout; tune `advanceFactor` per font if
//! exactness matters.
//!
//! Layout note: the line's measured width changes every frame as the tracking
//! tightens, so it is positioned ABSOLUTELY at an explicit `x`/`y` (centered by
//! default) rather than as a `<Flex>`/`<AbsoluteFill>` child, where a per-frame
//! width change would make the layout pass reflow/jiggle (HARD RULE 2). Glyphs
//! are laid out around a fixed center so the line stays put while it contracts.
//!
//! Approximation — blur: ondajs starts the text soft (CSS `blur(8px)`) and
//! sharpens as it settles; the engine has no blur/filter primitive. When `blur`
//! is enabled this is approximated with a faint, wider-spread ghost copy of
//! each glyph layered behind the crisp glyph, fading out as the line settles —
//! reading as a soft edge that sharpens. It is a nod to the effect, not a true
//! Gaussian blur.

import { Group, Text, useVideoConfig } from '@onda/react'
import { useSpringValue } from '../hooks.js'
import { DURATION } from '../motion.js'
import { useTheme } from '../theme.js'

export interface TrackingInProps {
  /** The text to settle in. */
  text?: string
  /** Frames before the entrance starts. */
  delay?: number
  /** Frames until the text settles (default `DURATION.slow` = 24). */
  durationInFrames?: number
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
  /** Estimated per-glyph advance as a fraction of `fontSize` (default 0.55 —
   *  a typical display-sans average; tune per font). */
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
  advanceFactor = 0.55,
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

  // Current tracking in em, contracting from spread → rest.
  const ls = fromTracking + (tracking - fromTracking) * progress
  // Tracking contributes this many px of extra gap after each glyph.
  const trackPx = ls * fontSize
  // Estimated natural advance per glyph (excluding tracking).
  const charAdvance = fontSize * advanceFactor
  // Per-glyph slot width including the current tracking. Floor the advance so
  // negative tracking can tighten the line but never collapse a glyph onto its
  // neighbour: the rendered glyphs are wider than `charAdvance` at display
  // weights, so unclamped negative tracking makes them overlap (O over N,
  // D/A merge). Keep each step at >= MIN_ADVANCE_FRACTION of the natural
  // advance so letters touch but stay legible.
  const MIN_ADVANCE_FRACTION = 0.85
  const slot = Math.max(charAdvance + trackPx, charAdvance * MIN_ADVANCE_FRACTION)

  // Split into characters, preserving spaces. Render every char as its own
  // <Text> so each can be positioned independently.
  const chars = [...text]
  const count = chars.length

  // Total width of the line at the current tracking. Each step advances by the
  // (clamped) `slot`; the last glyph adds its own advance, so width is
  // `slot * (count - 1) + charAdvance`. Using the clamped `slot` keeps the
  // centering anchor consistent with the actual glyph layout.
  const lineWidth = count > 0 ? slot * Math.max(0, count - 1) + charAdvance : 0

  // Anchor x: center by default. Resolve alignment about the anchor.
  const anchorX = x ?? Math.round(width / 2)
  const startX =
    align === 'center' ? anchorX - lineWidth / 2 : align === 'right' ? anchorX - lineWidth : anchorX

  // Vertical: roughly center the single line by offsetting the top by ~half the
  // cap height (matches Typewriter's convention).
  const py = y ?? Math.round(height / 2 - fontSize * 0.6)

  // Ghost-layer (blur approximation) parameters: visible only while settling,
  // spread slightly wider than the crisp glyphs, low opacity.
  const ghostOn = blur && progress < 1
  const ghostOpacity = ghostOn ? (1 - progress) * 0.45 * opacity : 0
  // Extra spread for the ghost so it reads as a soft halo around each glyph.
  const ghostExtra = (1 - progress) * fontSize * 0.06

  // Cumulative x as we walk the glyphs. `slot` advances each step.
  let cursor = startX

  return (
    <Group opacity={opacity}>
      {chars.map((ch, i) => {
        const gx = cursor
        cursor += slot
        // Skip rendering spaces (they only advance the cursor).
        if (ch === ' ') return null
        return (
          <Group key={`${i}-${ch}`}>
            {ghostOpacity > 0.001 ? (
              <Text
                x={gx - ghostExtra}
                y={py}
                fontSize={fontSize}
                color={color}
                fontFamily={fontFamily}
                fontWeight={fontWeight}
                italic={italic}
                opacity={ghostOpacity}
              >
                {ch}
              </Text>
            ) : null}
            <Text
              x={gx}
              y={py}
              fontSize={fontSize}
              color={color}
              fontFamily={fontFamily}
              fontWeight={fontWeight}
              italic={italic}
            >
              {ch}
            </Text>
          </Group>
        )
      })}
    </Group>
  )
}
