//! RgbGlitch — RGB channel-split glitch text. Ported from ondajs (rgb-glitch-text).
//!
//! Renders the text three times — a red copy and a cyan copy offset just off a
//! white center copy — to fake the chromatic-aberration look. A constant
//! `baseSplit` gives the always-on coloured edge; periodic glitch bursts kick the
//! split wider and add vertical jitter. All randomness is a pure function of
//! `random(seed + bucket)` (deterministic per §1) keyed by a 2-frame bucket, so
//! it renders identically every time.
//!
//! DETERMINISM NOTE: ondajs uses a *stateful* `seededRandom(...)` generator and
//! calls it twice per bucket (x-burst, then y-jitter). Onda's `random(seed)` is a
//! single-step pure function, so we draw two independent values from two distinct
//! seeds (`base` and `base + 104729`). Not bit-identical to ondajs, but the same
//! behaviour: two independent jitter draws per 2-frame bucket, fully deterministic.
//!
//! BLEND-MODE APPROXIMATION: ondajs composites the coloured copies with CSS
//! `mix-blend-mode: screen` over the dark canvas, so the overlaps brighten toward
//! white. The scene graph has NO blend modes — nodes alpha-composite (source-
//! over) only. We approximate by drawing the two coloured copies at reduced
//! opacity UNDER the solid white center copy: on the intended dark background the
//! offset coloured fringes read as the red/cyan split, and the center stays clean
//! white. It is not a true additive screen (overlapping fringes won't lighten),
//! but on the dark Onda canvas the chromatic-edge read is faithful.
//!
//! LAYOUT: self-positioning. `<Text>` is single-line and LEFT-anchored, so to
//! centre/right-align the line we estimate its width (length * fontSize *
//! AVG_CHAR_W — the engine can't be measured back from a pure frame function) and
//! offset x accordingly. The three copies share that base x/y so they stack, and
//! the whole effect is wrapped in a single `<Group>` so it composes as one node.
//!
//! letter-spacing (ondajs `-0.02em`) has no scene-graph equivalent and is dropped.

import { Group, Text, random, useCurrentFrame, useVideoConfig } from '@onda/react'
import { useTheme } from '../theme.js'

/** Approximate average glyph advance as a fraction of font size, for
 *  proportional display fonts (used only to centre/right-align the line). */
const AVG_CHAR_W = 0.6

export interface RgbGlitchProps {
  /** The text to glitch. */
  text?: string
  /** Frames before the effect starts. */
  delay?: number
  /** Constant baseline channel split in px (the always-on chromatic edge). */
  baseSplit?: number
  /** Peak extra split in px during a glitch burst. */
  intensity?: number
  /** Frames between glitch bursts. */
  glitchPeriod?: number
  /** Frames a glitch burst lasts. */
  glitchDuration?: number
  /** Seed for the (deterministic) burst jitter. */
  seed?: number
  /** Base (center) text color (default: theme `text`). */
  color?: string
  /** Red-channel copy color (default: theme `accent`). */
  redColor?: string
  /** Cyan-channel copy color (default: theme `palette[1]`). */
  cyanColor?: string
  /** Opacity of the coloured channel copies (the screen-blend approximation —
   *  lower keeps the center read as clean white). Default 0.85. */
  channelOpacity?: number
  /** Font size in px. */
  fontSize?: number
  /** Loaded font family (e.g. a `--font` passed to `onda render`) (default: theme `fontFamily`). */
  fontFamily?: string
  /** Font weight (default 600). */
  fontWeight?: number
  /** Italic text. */
  italic?: boolean
  /** Line alignment relative to the placement point. Default `'center'`. */
  align?: 'left' | 'center' | 'right'
  /** Absolute x of the alignment anchor. Defaults to canvas horizontal center. */
  x?: number
  /** Absolute y (top-ish) of the line. Defaults to vertical center. */
  y?: number
}

export function RgbGlitch({
  text = 'GLITCH',
  delay = 0,
  baseSplit = 2,
  intensity = 10,
  glitchPeriod = 48,
  glitchDuration = 8,
  seed = 7,
  color: colorProp,
  redColor: redColorProp,
  cyanColor: cyanColorProp,
  channelOpacity = 0.85,
  fontSize = 120,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
  italic = false,
  align = 'center',
  x,
  y,
}: RgbGlitchProps) {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const redColor = redColorProp ?? theme.accent
  const cyanColor = cyanColorProp ?? theme.palette[1] ?? '#4de2ff'
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  const local = Math.max(0, frame - delay)

  // Burst window + 2-frame bucket, matching the ondajs PRNG keying so the jitter
  // is deterministic and steps every other frame (a chunky, digital cadence).
  const inBurst = local % glitchPeriod < glitchDuration
  const bucket = Math.floor(local / 2)
  // Two independent draws per bucket (x-burst, y-jitter), offset so they differ.
  const rx = random(seed + bucket * 7919)
  const ry = random(seed + bucket * 7919 + 104729)
  const burst = inBurst ? rx * 2 - 1 : 0
  const dx = baseSplit + burst * intensity
  const dy = inBurst ? (ry * 2 - 1) * intensity * 0.4 : 0

  // Single-line width estimate (no measurement available in a pure frame fn) for
  // centre/right alignment. Slightly rough, but only shifts the anchor point.
  const lineWidth = text.length * fontSize * AVG_CHAR_W
  const anchorX = x ?? Math.round(width / 2)
  const anchorY = y ?? Math.round(height / 2 - fontSize * 0.6)
  const baseX =
    align === 'center' ? anchorX - lineWidth / 2 : align === 'right' ? anchorX - lineWidth : anchorX

  const common = { fontSize, fontFamily, fontWeight, italic } as const

  // Draw order matters for the screen-blend approximation: coloured copies first
  // (under, reduced opacity), white center last (on top, fully opaque) so the
  // center text stays clean and the offset copies read as chromatic fringes.
  return (
    <Group>
      <Text x={baseX - dx} y={anchorY - dy} color={redColor} opacity={channelOpacity} {...common}>
        {text}
      </Text>
      <Text x={baseX + dx} y={anchorY + dy} color={cyanColor} opacity={channelOpacity} {...common}>
        {text}
      </Text>
      <Text x={baseX} y={anchorY} color={color} {...common}>
        {text}
      </Text>
    </Group>
  )
}
