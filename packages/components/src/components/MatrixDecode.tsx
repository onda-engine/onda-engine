//! MatrixDecode — glyphs flicker through random chars then settle left-to-right,
//! a "decode" reveal. Ported from ondajs.
//!
//! Per character position: before its settle frame we show a random glyph from
//! the charset; after its settle frame we show the target char. Settling marches
//! left-to-right (each char settles `charDelay` frames after the previous), and
//! every char scrambles for `scrambleDuration` frames before it lands.
//!
//! Determinism (HARD RULE 1): the flicker is a pure function of frame. Each
//! scramble glyph is picked with `random(seed)` from '@onda/react' (no
//! `Math.random`, no wall clock), keyed by char index + a frame BUCKET
//! (`floor(local / scrambleSpeed)`) so the glyph swaps every `scrambleSpeed`
//! frames rather than every frame — same flicker cadence as ondajs.
//!
//! Rendering: ondajs renders one `<span>` per char with per-char color. Here the
//! whole line is a single engine-measured `<Text>` carrying a per-char `runs`
//! array, so still-scrambling glyphs take `scrambleColor` (the earned accent) and
//! settled glyphs take `color` — without manual per-glyph x math.
//!
//! Layout note (HARD RULE 2): a monospace family keeps the advance steady as
//! glyphs flicker, but the measured line width can still shift frame-to-frame
//! (and the charset can include wider glyphs). A changing-width `<Text>` inside a
//! `<Flex>`/`<AbsoluteFill>` would make the layout pass reflow/jiggle, so the
//! line is positioned ABSOLUTELY at an explicit `x`/`y` (defaulting to the canvas
//! center) — like `Typewriter`/`CountUp`.
//!
//! Approximations (engine vs the ondajs/CSS original):
//!  - No CSS `letter-spacing` in scene `<Text>`; the `--onda-*` CSS-var color
//!    defaults are resolved to their literal hex fallbacks.
//!  - No `text-align`/`placement` region system: `align` is approximated by
//!    anchoring the (single) line — `'left'` puts the left edge at `x`,
//!    `'center'`/`'right'` shift left by the MEASURED text width (via
//!    `useTextMetrics`; falls back to a glyph-count estimate until the wasm
//!    engine warms). Pass explicit `x`/`y` for exact placement.
//!  - Per-run colors render on the GPU (Vello) path; the CPU reference draws the
//!    concatenated text in the node's base `color`, so there the scramble accent
//!    is lost. GPU is the primary path.

import { Text, random, useCurrentFrame, useVideoConfig } from '@onda/react'
import type { TextRunInput } from '@onda/react'
import { useFittedFontSize } from '../bounds.js'
import { type Placement, usePlacement } from '../placement.js'
import { useTextMetrics } from '../text-metrics.js'
import { useTheme } from '../theme.js'

export interface MatrixDecodeProps {
  /** The text that decodes into place. */
  text?: string
  /** Frames before decoding starts. */
  delay?: number
  /** Frames between successive characters settling (left-to-right). */
  charDelay?: number
  /** Frames each character scrambles before it settles (min 1). */
  scrambleDuration?: number
  /** Frames between glyph swaps while scrambling. Lower = faster flicker (min 1). */
  scrambleSpeed?: number
  /** Seed for the (deterministic) glyph picks. */
  seed?: number
  /** Glyph pool drawn from while scrambling. */
  charset?: string
  /** Settled text color (default: theme `text`). */
  color?: string
  /** Color of still-scrambling glyphs — the earned accent (default: theme `accent`). */
  scrambleColor?: string
  /** Font size in px (default 120). */
  fontSize?: number
  /** Opt-in auto-fit: `'frame'` scales the font size DOWN (never up) so the
   *  measured line cannot exceed the frame minus the safe margins. Default
   *  `'none'` (the historical behavior). */
  fit?: 'none' | 'frame'
  /** Explicit width cap in px for the line; combines with `fit` (the smaller
   *  cap wins). */
  maxWidth?: number
  /** Monospace stack keeps the advance steady as glyphs flicker (default: theme `monoFamily`). */
  fontFamily?: string
  /** Font weight (default 600). */
  fontWeight?: number
  /** Italic text. */
  italic?: boolean
  /** Horizontal anchoring of the single line (approximate — see file notes).
   *  Only applies to the legacy default/`x` anchoring — `placement` anchors the
   *  line's measured center. */
  align?: 'left' | 'center' | 'right'
  /** Where the line sits: a region keyword (`'center'`, `'lower-third'`, …) or
   *  normalized `{x,y}` (0–1, line center). The shared placement contract;
   *  default `'center'`. */
  placement?: Placement
  /** @deprecated Legacy alias — absolute x of the line's left edge in px.
   *  Prefer `placement`. */
  x?: number
  /** @deprecated Legacy alias — absolute y (top-ish) of the line in px. Prefer
   *  `placement`. */
  y?: number
}

export function MatrixDecode({
  text = 'ONDA',
  delay = 0,
  charDelay = 3,
  scrambleDuration = 18,
  scrambleSpeed = 2,
  seed = 7,
  charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=<>/',
  color: colorProp,
  scrambleColor: scrambleColorProp,
  fontSize: fontSizeProp = 120,
  fit,
  maxWidth,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
  italic = false,
  align = 'center',
  placement,
  x,
  y,
}: MatrixDecodeProps) {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const scrambleColor = scrambleColorProp ?? theme.accent
  const fontFamily = fontFamilyProp ?? theme.monoFamily

  // Opt-in auto-fit, measured on the TARGET text (the settled line). A wider
  // scramble glyph can exceed it by a glyph-width transiently; the settled
  // line cannot.
  const fontSize = useFittedFontSize(text, fontSizeProp, { fontFamily, fontWeight, fit, maxWidth })

  const local = frame - delay
  // Guard against degenerate props (the schema clamps these to >= 1).
  const scrambleFrames = Math.max(1, scrambleDuration)
  const swapEvery = Math.max(1, scrambleSpeed)
  const stepDelay = Math.max(0, charDelay)
  const pool = charset.length > 0 ? charset : ' '

  const chars = [...text]

  // Build a per-char run: settled chars get `color`, scrambling chars get a
  // deterministic glyph in `scrambleColor`. Spaces pass through untouched so the
  // word shape stays legible while the rest decodes.
  const runs: TextRunInput[] = chars.map((ch, i) => {
    if (ch === ' ') {
      return { text: ' ', color, fontSize, fontFamily, fontWeight, italic }
    }
    const settleAt = i * stepDelay + scrambleFrames
    const settled = local >= settleAt
    if (settled) {
      return { text: ch, color, fontSize, fontFamily, fontWeight, italic }
    }
    // Scramble: pick a glyph deterministically from (index, frame bucket). The
    // bucket changes every `swapEvery` frames, so the flicker swaps at that rate.
    const bucket = Math.floor(Math.max(0, local) / swapEvery)
    const r = random(seed + i * 9301 + bucket * 49297)
    const idx = Math.min(pool.length - 1, Math.floor(r * pool.length))
    const glyph = pool[idx] ?? ch
    return { text: glyph, color: scrambleColor, fontSize, fontFamily, fontWeight, italic }
  })

  // The plain concatenated string — used as the base child (CPU-reference draw)
  // and to measure width for `align` anchoring.
  const plain = runs.map((run) => run.text).join('')

  // Real shaped line width (the engine measures it — proportional, exact; falls
  // back to a glyph-count estimate until the wasm engine warms in the browser).
  const measured = useTextMetrics(plain, fontSize, { fontFamily, fontWeight })

  // Absolute placement so the (potentially width-varying) line never triggers a
  // Flex reflow. The shared placement contract anchors the line's MEASURED
  // center (corner regions sit flush on the safe margin); legacy `x`/`y` px and
  // the `align`-anchored default keep their exact pre-placement behavior.
  const estWidth = measured.width
  const resolved = usePlacement(placement, { width: estWidth, height: fontSize * 1.2 })
  let px: number
  if (x !== undefined) {
    px = x
  } else if (placement !== undefined) {
    px = Math.round(resolved.originX)
  } else if (align === 'left') {
    px = Math.round(width * 0.08)
  } else if (align === 'right') {
    px = Math.round(width * 0.92 - estWidth)
  } else {
    px = Math.round((width - estWidth) / 2)
  }
  const py =
    y ??
    (placement !== undefined
      ? Math.round(resolved.originY)
      : Math.round(height / 2 - fontSize * 0.6))

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
      {plain}
    </Text>
  )
}
