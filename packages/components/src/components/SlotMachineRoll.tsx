//! SlotMachineRoll — each character spins down a reel of glyphs and lands on its
//! target, settling on the house spring, staggered left-to-right. Ported from
//! ondajs.
//!
//! Engine port notes (vs the ondajs/CSS original):
//!  - ondajs nests `overflow:hidden` spans and translates an inner block. Here
//!    each character is its own column: a `<Group clip={clipRect(cell, cell)}>`
//!    window (one glyph tall) with the reel — a vertical stack of `<Text>`s —
//!    translated upward inside it. The window masks every glyph except the one
//!    currently aligned to row 0.
//!  - The columns are positioned ABSOLUTELY at explicit `x` (an estimated
//!    monospace cell advance) rather than via `<Flex>`. The reel translates and
//!    glyphs change every frame, so a Flex would reflow/jiggle (HARD RULE 2);
//!    explicit x keeps the reels rock-steady and column-aligned. The engine
//!    measures text at render time but a pure frame→scene function can't read
//!    those measurements back, so cell width is estimated like `Marquee`
//!    (`fontSize * CELL_W`). A monospace stack keeps the estimate honest.
//!  - Filler glyphs are seeded with `random(seed + …)` from `@onda/react`
//!    (deterministic, §1) so the spin is identical every render. ondajs uses a
//!    `seededRandom(seed)` *generator* pulled `reelLength` times; here each
//!    filler gets a distinct composite seed — same spirit, same determinism.
//!  - Reel direction: ondajs maps the spring to `ty ∈ [-reelLength*cell, 0]`,
//!    which settles on the FIRST filler rather than the target. This port maps
//!    `ty ∈ [0, -reelLength*cell]` so it actually lands on the target glyph (the
//!    component's documented purpose). See `approximations`.
//!  - No CSS `letter-spacing` / `line-height` / `text-align`: spacing is folded
//!    into the cell advance, vertical centering into a per-glyph nudge, and
//!    `align` into the block's horizontal anchor.
//!
//! Pivot caveat: the whole reel block is anchored from its top-left local origin
//! and offset into place via `x`/`y`; there is no centered scale/rotate here, so
//! the local-origin pivot rule doesn't bite.

import {
  Group,
  Text,
  clipRect,
  interpolate,
  random,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import { DURATION, SPRING_SMOOTH } from '../motion.js'
import { useTheme } from '../theme.js'

/** Estimated cell advance as a fraction of font size — the per-character column
 *  width. Tuned for a monospace/display stack (matches the spirit of `Marquee`'s
 *  `AVG_CHAR_W`); only needs to be roughly proportional to keep reels aligned. */
const CELL_W = 0.62

export interface SlotMachineRollProps {
  /** The text that rolls into place. Best on short strings (years, counts). */
  text?: string
  /** Frames before rolling starts. */
  delay?: number
  /** Frames between successive characters starting their roll. */
  charDelay?: number
  /** Frames for each character's reel to settle (default `DURATION.slow` = 24). */
  durationInFrames?: number
  /** How many filler glyphs spin past before the target lands. */
  reelLength?: number
  /** Seed for the (deterministic) filler glyphs. */
  seed?: number
  /** Glyph pool the reel spins through. */
  charset?: string
  /** Text color (default: theme `text`). */
  color?: string
  /** Font size in px (default 140). The cell height equals this. */
  fontSize?: number
  /** Monospace/display stack keeps reels column-aligned (default: theme `fontFamily`). */
  fontFamily?: string
  /** Font weight (default 600). */
  fontWeight?: number
  /** Italic glyphs. */
  italic?: boolean
  /** Horizontal anchoring of the whole block (default `'center'`). */
  align?: 'left' | 'center' | 'right'
  /** Absolute x of the block's anchor. Defaults to the canvas horizontal center
   *  (respecting `align`). */
  x?: number
  /** Absolute y of the block's top. Defaults to vertically centering the row. */
  y?: number
}

export function SlotMachineRoll({
  text = '2026',
  delay = 0,
  charDelay = 4,
  durationInFrames = DURATION.slow,
  reelLength = 12,
  seed = 7,
  charset = '0123456789',
  color: colorProp,
  fontSize = 140,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
  italic = false,
  align = 'center',
  x,
  y,
}: SlotMachineRollProps) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  const cell = fontSize
  const chars = [...text]

  // Per-character cell advance. Spaces are a narrower gap (matches ondajs's
  // `cell * 0.4`); everything else gets a full estimated cell.
  const advance = (ch: string): number => (ch === ' ' ? cell * CELL_W * 0.65 : cell * CELL_W)

  // Lay out columns left-to-right at running-sum x offsets within the block.
  let cursor = 0
  const placed = chars.map((ch, i) => {
    const localX = cursor
    cursor += advance(ch)
    return { ch, i, localX }
  })
  const totalWidth = cursor

  // Anchor the block. `align` decides which edge `x` pins; default centers it on
  // the canvas. `y` defaults to vertically centering the single row of cells.
  const defaultCenterX = width / 2
  const anchorX = x ?? defaultCenterX
  const originX =
    align === 'left' ? anchorX : align === 'right' ? anchorX - totalWidth : anchorX - totalWidth / 2
  const originY = y ?? Math.round(height / 2 - cell / 2)

  // Nudge each glyph down within its cell so it reads vertically centered (the
  // engine measures from a top-ish origin; ~12% of the cell approximates the
  // cap-height inset). Deterministic, no measurement.
  const glyphInset = Math.round(cell * 0.12)

  const local = frame - delay

  return (
    <Group x={originX} y={originY}>
      {placed.map(({ ch, i, localX }) => {
        // Spaces occupy advance but render nothing — no reel, no window.
        if (ch === ' ') return null

        // Build this column's reel: `reelLength` deterministic fillers from the
        // charset, then the target glyph as the final (bottom) row. Each filler
        // gets a distinct composite seed so the sequence is stable per render.
        const pool = [...charset]
        const reel: string[] = []
        for (let k = 0; k < reelLength; k++) {
          const r = random(seed + i * 7919 + k * 31 + 1)
          const idx = Math.min(pool.length - 1, Math.floor(r * pool.length))
          reel.push(pool[idx] ?? ch)
        }
        reel.push(ch)

        // House spring, staggered per character. Reel translates from showing
        // the top filler (ty = 0) down to landing on the target at the bottom
        // (ty = -reelLength*cell), so the window settles on the target glyph.
        const p = spring({
          frame: local - i * charDelay,
          fps,
          config: SPRING_SMOOTH,
          durationInFrames,
        })
        const ty = interpolate(p, [0, 1], [0, -reelLength * cell], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })

        return (
          <Group key={`${i}-${ch}`} x={localX} clip={clipRect(advance(ch), cell)}>
            <Group y={ty}>
              {reel.map((g, k) => (
                <Text
                  key={k}
                  x={0}
                  y={k * cell + glyphInset}
                  fontSize={fontSize}
                  color={color}
                  fontFamily={fontFamily}
                  fontWeight={fontWeight}
                  italic={italic}
                >
                  {g}
                </Text>
              ))}
            </Group>
          </Group>
        )
      })}
    </Group>
  )
}
