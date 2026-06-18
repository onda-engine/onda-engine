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

import { Text, useCurrentFrame, useVideoConfig } from '@onda-engine/react'
import { useFittedFontSize } from '../bounds.js'
import { useTextReveal } from '../hooks.js'
import { DURATION } from '../motion.js'
import { type Placement, usePlacement } from '../placement.js'
import { useTextMetrics } from '../text-metrics.js'
import { type TextStyleProps, applyTextCase } from '../text-style.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'
import { useTimeScale } from '../timing.js'

export interface TypewriterProps extends TextStyleProps {
  /** What to type out. */
  text?: string
  /** Time before typing starts — frames or '0.5s'. */
  delay?: TimeInput
  /** Time to type the full string. Linear pacing — chars-per-frame is
   *  constant. Default `DURATION.slow` (24 frames). */
  durationInFrames?: TimeInput
  /** Compress the whole timing envelope (delay, stagger, durations) so the
   *  entrance settles at least `hold` before the end of the enclosing clip
   *  (`useVideoConfig().durationInFrames`, Sequence-scoped). Opt-in. */
  fitToClip?: boolean
  /** Hard cap on the settle time (frames or '0.5s'). Wins over `fitToClip`. */
  maxSettle?: TimeInput
  /** Breathing room before the cut for `fitToClip` (default 6 frames). */
  hold?: TimeInput
  /** Show a blinking cursor at the leading edge while typing. Default `true`. */
  cursor?: boolean
  /** Cursor color (default: theme `accent`). */
  cursorColor?: string
  /** Font size in px (default 64). */
  fontSize?: number
  /** Opt-in auto-fit: `'frame'` scales the font size DOWN (never up) so the
   *  measured line cannot exceed the frame minus the safe margins. Default
   *  `'none'` (the historical behavior). */
  fit?: 'none' | 'frame'
  /** Explicit width cap in px for the line; combines with `fit` (the smaller
   *  cap wins). */
  maxWidth?: number
  /** Where the line sits: a region keyword (`'center'`, `'lower-third'`, …) or
   *  normalized `{x,y}` (0–1, anchored at the FULL line's measured center). The
   *  shared placement contract; default `'center'`. */
  placement?: Placement
  /** @deprecated Legacy alias — absolute x of the text's left edge in px.
   *  Prefer `placement`. */
  x?: number
  /** @deprecated Legacy alias — absolute y (baseline-ish top) in px. Prefer
   *  `placement`. */
  y?: number
}

export function Typewriter({
  text: textProp = 'motion graphics',
  delay: delayIn = 0,
  durationInFrames: durationIn = DURATION.slow,
  fitToClip,
  maxSettle,
  hold,
  cursor = true,
  cursorColor: cursorColorProp,
  color: colorProp,
  fontSize: fontSizeProp = 64,
  fit,
  maxWidth,
  fontFamily: fontFamilyProp,
  fontWeight = 500,
  italic = false,
  letterSpacing,
  uppercase,
  placement,
  x,
  y,
}: TypewriterProps) {
  const text = applyTextCase(textProp, { uppercase })
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const theme = useTheme()
  const cursorColor = cursorColorProp ?? theme.accent
  const color = colorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  // Timing: parse + clip-fit (typing compresses to land inside the clip).
  const delayBase = framesOf(delayIn, fps)
  const durationBase = framesOf(durationIn, fps, DURATION.slow)
  const timeScale = useTimeScale(delayBase + durationBase, { fitToClip, maxSettle, hold })
  const delay = delayBase * timeScale
  const durationInFrames = Math.max(1, durationBase * timeScale)

  // Opt-in auto-fit: scale the size down so the FULL line fits the cap.
  const fontSize = useFittedFontSize(text, fontSizeProp, { fontFamily, fontWeight, fit, maxWidth })

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
  // The anchor is derived from the MEASURED width of the FULL string via the
  // shared placement contract. Anchoring on the full width — not the growing
  // substring — keeps the origin rock-steady (the line would slide sideways
  // otherwise) while the completed line reads placed as asked. `placement` is
  // authoritative when set; legacy px `x`/`y` only anchor in the pre-placement
  // path (else a stray `x:0.5` reads as 0.5 px → top-left). Default: centered.
  const resolved = usePlacement(placement, { width: measured.width, height: fontSize * 1.2 })
  const useLegacy = placement === undefined
  const px = useLegacy && x !== undefined ? x : Math.round(resolved.originX)
  const py = useLegacy && y !== undefined ? y : Math.round(resolved.y - fontSize * 0.6)

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
      letterSpacing={letterSpacing}
      runs={runs}
    >
      {revealed}
    </Text>
  )
}
