//! SlotMachineRoll — each character spins down a reel of glyphs and lands cleanly
//! on its target: the reel decelerates hard into place on the house spring,
//! staggered left-to-right on the house cadence. Ported from ondajs, retuned
//! premium.
//!
//! Premium notes (vs the original linear roll): the reel rides `SPRING_SMOOTH`
//! over `DURATION.slower` for a slow, settled deceleration (no constant-velocity
//! spin) that lands square on the target — the glyph drops in and stops, with no
//! past-target kick (an over-roll that flashes a wrong glyph reads as a glitch, not
//! a premium settle). Columns sit on the house stagger; the cell advance is a touch
//! airier so the digits breathe. One earned accent: a soft, low-opacity accent glow
//! blooms behind the landed row as the reels settle — the only color in the piece,
//! the digits stay near-white.
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
  Ellipse,
  Flex,
  Group,
  Text,
  clipRect,
  interpolate,
  random,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import { fitMaxWidth } from '../bounds.js'
import { DURATION, SPRING_SMOOTH, STAGGER, staggerFrames } from '../motion.js'
import { type Placement, usePlacement } from '../placement.js'
import { useTheme } from '../theme.js'

/** Estimated cell advance as a fraction of font size — the per-character column
 *  width. Tuned for a monospace/display stack (matches the spirit of `Marquee`'s
 *  `AVG_CHAR_W`); only needs to be roughly proportional to keep reels aligned.
 *  Bumped a touch over the original `0.62` so the landed digits breathe — premium
 *  display type wants air between columns, not a cramped odometer. */
const CELL_W = 0.7

export interface SlotMachineRollProps {
  /** The text that rolls into place. Best on short strings (years, counts). */
  text?: string
  /** Frames before rolling starts. */
  delay?: number
  /** Frames between successive characters starting their roll (default the house
   *  `STAGGER` = 5 — a settled, orchestrated wave left-to-right). */
  charDelay?: number
  /** Frames for each character's reel to settle (default `DURATION.slower` = 34 —
   *  a slow, hard-decelerating odometer drop, not a constant-velocity spin). */
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
  /** Opt-in auto-fit: `'frame'` scales the font size DOWN (never up) so the
   *  line cannot exceed the frame minus the safe margins. Default `'none'`
   *  (the historical behavior). */
  fit?: 'none' | 'frame'
  /** Explicit width cap in px for the line; combines with `fit` (the smaller
   *  cap wins). */
  maxWidth?: number
  /** Monospace/display stack keeps reels column-aligned (default: theme `fontFamily`). */
  fontFamily?: string
  /** Font weight (default 600). */
  fontWeight?: number
  /** Italic glyphs. */
  italic?: boolean
  /** Horizontal anchoring of the whole block (default `'center'`). Only applies
   *  to the legacy `x` anchor — `placement` always anchors the block's center. */
  align?: 'left' | 'center' | 'right'
  /** Where the row sits: a region keyword (`'center'`, `'lower-third'`,
   *  `'top-left'`, …) or normalized `{x,y}` (0–1, block center). The shared
   *  placement contract; default `'center'`. */
  placement?: Placement
  /** @deprecated Legacy alias — absolute x of the block's anchor in px
   *  (respecting `align`). Prefer `placement`. */
  x?: number
  /** @deprecated Legacy alias — absolute y of the block's top in px. Prefer
   *  `placement`. */
  y?: number
}

export function SlotMachineRoll({
  text = '2026',
  delay = 0,
  charDelay = STAGGER,
  durationInFrames = DURATION.slower,
  reelLength = 12,
  seed = 7,
  charset = '0123456789',
  color: colorProp,
  fontSize: fontSizeProp = 140,
  fit,
  maxWidth,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
  italic = false,
  align = 'center',
  placement,
  x,
  y,
}: SlotMachineRollProps) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  const chars = [...text]

  // Opt-in auto-fit: the row's estimated width is proportional to the font
  // size (fixed cell advances), so the cap resolves in closed form.
  const unitsW = chars.reduce((sum, ch) => sum + (ch === ' ' ? CELL_W * 0.65 : CELL_W), 0)
  const cap = fitMaxWidth({ fit, maxWidth }, width)
  const fontSize =
    cap !== undefined && unitsW > 0 && fontSizeProp * unitsW > cap
      ? Math.max(1, cap / unitsW)
      : fontSizeProp

  const cell = fontSize

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

  // Anchor the block on the shared placement contract (block CENTER at the
  // resolved point; corner regions sit flush on the safe margin). Legacy px
  // `x`/`y` win per-axis when given: `align` decides which edge `x` pins, `y`
  // pins the block's top — exactly the pre-placement behavior.
  const resolved = usePlacement(placement, { width: totalWidth, height: cell })
  const originX =
    x !== undefined
      ? align === 'left'
        ? x
        : align === 'right'
          ? x - totalWidth
          : x - totalWidth / 2
      : resolved.originX
  const originY = y ?? Math.round(resolved.originY)

  const local = frame - delay

  // One earned accent: a soft, low-opacity glow that blooms behind the landed row
  // as the reels settle — the only color in the piece (the digits stay near-white).
  // It eases in on the house spring once the LAST column has nominally landed, so
  // the bloom reads as the payoff of the roll, not a competing entrance.
  const lastStart = staggerFrames(Math.max(0, placed.length - 1), charDelay)
  const glowP = spring({
    frame: local - lastStart - durationInFrames + 8,
    fps,
    config: SPRING_SMOOTH,
    durationInFrames: DURATION.base,
  })
  const glowOpacity = interpolate(glowP, [0, 1], [0, 0.5], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const glowW = totalWidth + cell * 0.9
  const glowH = cell * 1.35

  return (
    <Group x={originX} y={originY}>
      {/* Accent bloom behind the row — drawn first so the digits read on top of it.
          Centered on the block; a wide, soft, low-opacity wash, not a hard fill. */}
      <Ellipse
        x={totalWidth / 2 - glowW / 2}
        y={cell / 2 - glowH / 2}
        width={glowW}
        height={glowH}
        fill={theme.accentSoft}
        opacity={glowOpacity}
        shadow={{ color: theme.accent, blur: cell * 0.7, offsetY: 0 }}
      />
      {placed.map(({ ch, i, localX }) => {
        // Spaces occupy advance but render nothing — no reel, no window.
        if (ch === ' ') return null

        // Build this column's reel: `reelLength` deterministic fillers from the
        // charset, then the target glyph the reel lands on. Each filler gets a
        // distinct composite seed (stable per render).
        const pool = [...charset]
        const reel: string[] = []
        for (let k = 0; k < reelLength; k++) {
          const r = random(seed + i * 7919 + k * 31 + 1)
          const idx = Math.min(pool.length - 1, Math.floor(r * pool.length))
          reel.push(pool[idx] ?? ch)
        }
        reel.push(ch)

        // House spring, staggered per character on the house cadence. The reel
        // translates from the top filler (ty = 0) down to landing on the target
        // (ty = -reelLength*cell). The spring decelerates HARD into rest — a slow
        // odometer drop, never constant-velocity — so the digit settles, not spins.
        const charStart = staggerFrames(i, charDelay)
        const localChar = local - charStart
        const p = spring({
          frame: localChar,
          fps,
          config: SPRING_SMOOTH,
          durationInFrames,
        })
        // The reel lands cleanly on the target: the spring's hard deceleration is
        // the whole settle — the digit drops in and stops, no past-target kick.
        const ty = interpolate(p, [0, 1], [0, -reelLength * cell], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })

        // Window is EXACTLY one cell tall, anchored at the column origin, so the
        // block stays vertically centered via `originY`. The reel translates
        // inside it; each glyph sits in its own `cell`-tall <Flex> cell that the
        // ENGINE centers (no font-metric estimate), so the landed row is centered
        // in the band and its neighbours — a full `cell` away — are fully masked.
        return (
          <Group key={`${i}-${ch}`} x={localX} clip={clipRect(advance(ch), cell)}>
            <Group y={ty}>
              {reel.map((g, k) => (
                <Flex
                  key={k}
                  y={k * cell}
                  width={advance(ch)}
                  height={cell}
                  justify="center"
                  align="center"
                >
                  <Text
                    fontSize={fontSize}
                    color={color}
                    fontFamily={fontFamily}
                    fontWeight={fontWeight}
                    italic={italic}
                  >
                    {g}
                  </Text>
                </Flex>
              ))}
            </Group>
          </Group>
        )
      })}
    </Group>
  )
}
