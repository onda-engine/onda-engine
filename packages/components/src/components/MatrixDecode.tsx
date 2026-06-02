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
//!    `'center'`/`'right'` shift left by an ESTIMATED text width (we can't read
//!    the engine's measured box back inside a pure frame→scene function), so
//!    centering is approximate. Pass explicit `x`/`y` for exact placement.
//!  - Per-run colors render on the GPU (Vello) path; the CPU reference draws the
//!    concatenated text in the node's base `color`, so there the scramble accent
//!    is lost. GPU is the primary path.

import { Text, random, useCurrentFrame, useVideoConfig } from '@onda/react'
import type { TextRunInput } from '@onda/react'

/** Approximate average monospace glyph advance as a fraction of font size, used
 *  only to *estimate* the line width for `align` anchoring (the engine measures
 *  the real box at render time, but we can't read it back here). */
const AVG_CHAR_W = 0.6

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
  /** Settled text color (default the Onda text `#f2f2f4`). */
  color?: string
  /** Color of still-scrambling glyphs — the earned accent (default rose `#d96b82`). */
  scrambleColor?: string
  /** Font size in px (default 120). */
  fontSize?: number
  /** Monospace stack keeps the advance steady as glyphs flicker. */
  fontFamily?: string
  /** Font weight (default 600). */
  fontWeight?: number
  /** Italic text. */
  italic?: boolean
  /** Horizontal anchoring of the single line (approximate — see file notes). */
  align?: 'left' | 'center' | 'right'
  /** Absolute x of the line. Defaults to the canvas center (per `align`). */
  x?: number
  /** Absolute y (top-ish) of the line. Defaults to vertical center. */
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
  color = '#f2f2f4',
  scrambleColor = '#d96b82',
  fontSize = 120,
  fontFamily = 'ui-monospace, monospace',
  fontWeight = 600,
  italic = false,
  align = 'center',
  x,
  y,
}: MatrixDecodeProps) {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

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
  // and to estimate width for `align` anchoring.
  const plain = runs.map((run) => run.text).join('')

  // Absolute placement so the (potentially width-varying) line never triggers a
  // Flex reflow. Estimate the line width to anchor non-left alignments.
  const estWidth = plain.length * fontSize * AVG_CHAR_W
  let px: number
  if (x !== undefined) {
    px = x
  } else if (align === 'left') {
    px = Math.round(width * 0.08)
  } else if (align === 'right') {
    px = Math.round(width * 0.92 - estWidth)
  } else {
    px = Math.round((width - estWidth) / 2)
  }
  const py = y ?? Math.round(height / 2 - fontSize * 0.6)

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
