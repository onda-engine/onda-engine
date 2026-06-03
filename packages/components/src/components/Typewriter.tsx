//! Typewriter — reveal text character-by-character with an optional blinking
//! cursor. Ported from ondajs.
//!
//! Linear cadence is deliberate (the one documented exception to the house
//! spring rule): typing has to feel constant-rate, so it uses
//! `useTextReveal` (linear interpolation) rather than a spring.
//!
//! Layout note: the visible string grows one glyph per step, so its measured
//! width changes every frame. A growing-width `<Text>` inside a `<Flex>`/
//! `<AbsoluteFill>` makes the layout pass reflow/jiggle each frame (HARD RULE
//! 2). To keep the reveal rock-steady the text is positioned absolutely at an
//! explicit `x`/`y` (left-anchored, vertically centered by default) instead of
//! being laid out by Flex. The cursor is appended as a second styled `runs`
//! entry so the engine measures and glues it right after the last revealed
//! glyph — no manual text-width math.
//!
//! Backend caveat: per-run colors render on the GPU (Vello) path; the CPU
//! reference rasterizer draws the concatenated run text in the node's style, so
//! there the cursor inherits `color` rather than `cursorColor`. GPU is the
//! primary path, so this is an acceptable degradation.

import { Text, useCurrentFrame, useVideoConfig } from '@onda/react'
import { useTextReveal } from '../hooks.js'
import { DURATION } from '../motion.js'
import { useTextMetrics } from '../text-metrics.js'
import { useTheme } from '../theme.js'

export interface TypewriterProps {
  /** What to type out. */
  text?: string
  /** Frames before typing starts. */
  delay?: number
  /** Frames to type the full string. Linear pacing — chars-per-frame is
   *  constant. Default `DURATION.slow` (24). */
  durationInFrames?: number
  /** Show a blinking cursor at the leading edge while typing. Default `true`. */
  cursor?: boolean
  /** Cursor color (default: theme `accent`). */
  cursorColor?: string
  /** Text color (default: theme `text`). */
  color?: string
  /** Font size in px (default 64). */
  fontSize?: number
  /** Loaded font family (e.g. a `--font` passed to `onda render`) (default: theme `fontFamily`). */
  fontFamily?: string
  /** Font weight (default 500 — reads more "terminal"). */
  fontWeight?: number
  /** Italic text. */
  italic?: boolean
  /** Absolute x of the text's left edge. Defaults to a centered origin derived
   *  from the measured full-text width. */
  x?: number
  /** Absolute y baseline-ish top of the text. Defaults to vertical center. */
  y?: number
}

export function Typewriter({
  text = 'motion graphics',
  delay = 0,
  durationInFrames = DURATION.slow,
  cursor = true,
  cursorColor: cursorColorProp,
  color: colorProp,
  fontSize = 64,
  fontFamily: fontFamilyProp,
  fontWeight = 500,
  italic = false,
  x,
  y,
}: TypewriterProps) {
  const frame = useCurrentFrame()
  const { width, height, fps } = useVideoConfig()
  const theme = useTheme()
  const cursorColor = cursorColorProp ?? theme.accent
  const color = colorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  // Real shaped width of the FULL string (proportional — exact); falls back to
  // a glyph-count estimate until the wasm engine warms in the browser.
  const measured = useTextMetrics(text, fontSize, { fontFamily, fontWeight })

  // Linear char count — constant cadence (the intentional non-spring case).
  const shown = useTextReveal({ length: text.length, delay, durationInFrames })
  const revealed = text.slice(0, Math.max(0, shown))

  const done = shown >= text.length

  // Deterministic blink derived purely from the current frame: toggles every
  // half second (fps/2 frames). Hidden once typing completes.
  const half = Math.max(1, Math.round(fps / 2))
  const cursorVisible = Math.floor(frame / half) % 2 === 0
  const showCursor = cursor && !done && cursorVisible

  // Absolute placement so the growing string never triggers a Flex reflow.
  // The centered left origin is derived from the MEASURED width of the FULL
  // string. Centering on the full width — not the growing substring — keeps the
  // origin rock-steady (the line would slide sideways otherwise) while the
  // completed line reads centered on the canvas. The single line is vertically
  // centered by offsetting the top by ~half the cap height.
  const px = x ?? Math.round(width / 2 - measured.width / 2)
  const py = y ?? Math.round(height / 2 - fontSize * 0.6)

  // Append the cursor as a separate styled run so the engine measures the text
  // and positions the "|" right after the last revealed glyph.
  const runs = showCursor
    ? [
        { text: revealed, color, fontSize, fontFamily, fontWeight, italic },
        { text: '|', color: cursorColor, fontSize, fontFamily, fontWeight, italic },
      ]
    : undefined

  return (
    <Text
      x={px}
      y={py}
      fontSize={fontSize}
      color={color}
      fontFamily={fontFamily}
      fontWeight={fontWeight}
      italic={italic}
      runs={runs}
    >
      {revealed}
    </Text>
  )
}
