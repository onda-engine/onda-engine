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
//! airier so the digits breathe. An opt-in accent (`glow`, default OFF): a soft
//! radial bloom behind the landed row as the reels settle — a TRUE falloff to
//! transparent (not a solid wash with a fake shadow), the digits stay near-white.
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
  parseColor,
  radialGradient,
  random,
  spring,
  useCurrentFrame,
  useVideoConfig,
  variantSeed,
} from '@onda/react'
import { fitMaxWidth } from '../bounds.js'
import { layoutGlyphLine } from '../glyph-line.js'
import { DURATION, SPRING_SMOOTH, STAGGER, staggerFrames } from '../motion.js'
import { type Placement, usePlacement } from '../placement.js'
import { type TextStyleProps, applyTextCase } from '../text-style.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'
import { staggeredSettle, useTimeScale } from '../timing.js'

/** Estimated cell advance as a fraction of font size — the per-character column
 *  width. Tuned for a monospace/display stack (matches the spirit of `Marquee`'s
 *  `AVG_CHAR_W`); only needs to be roughly proportional to keep reels aligned.
 *  Bumped a touch over the original `0.62` so the landed digits breathe — premium
 *  display type wants air between columns, not a cramped odometer. */
const CELL_W = 0.7

export interface SlotMachineRollProps extends TextStyleProps {
  /** The text that rolls into place. Best on short strings (years, counts). */
  text?: string
  /** Time before rolling starts — frames or '0.5s'. */
  delay?: TimeInput
  /** Time between successive characters starting their roll (default the house
   *  `STAGGER` = 5 frames — a settled, orchestrated wave left-to-right). */
  charDelay?: TimeInput
  /** Time for each character's reel to settle (default `DURATION.slower` = 34
   *  frames — a slow, hard-decelerating odometer drop, not a constant-velocity
   *  spin). */
  durationInFrames?: TimeInput
  /** Compress the whole timing envelope (delay, stagger, durations) so the
   *  entrance settles at least `hold` before the end of the enclosing clip
   *  (`useVideoConfig().durationInFrames`, Sequence-scoped). Opt-in. */
  fitToClip?: boolean
  /** Hard cap on the settle time (frames or '0.5s'). Wins over `fitToClip`. */
  maxSettle?: TimeInput
  /** Breathing room before the cut for `fitToClip` (default 6 frames). */
  hold?: TimeInput
  /** How many filler glyphs spin past before the target lands. */
  reelLength?: number
  /** Seed for the (deterministic) filler glyphs. */
  seed?: number
  /** Integer "take" selector: derives a new deterministic seed from (seed,
   *  variant), so alternates never require hand-edited magic seeds. 0/omitted
   *  = the default take (identical to today's output). */
  variant?: number
  /** Glyph pool the reel spins through. */
  charset?: string
  /** Font size in px (default 140). The cell height equals this. */
  fontSize?: number
  /** Opt-in auto-fit: `'frame'` scales the font size DOWN (never up) so the
   *  line cannot exceed the frame minus the safe margins. Default `'none'`
   *  (the historical behavior). */
  fit?: 'none' | 'frame'
  /** Explicit width cap in px for the line; combines with `fit` (the smaller
   *  cap wins). */
  maxWidth?: number
  /** Render a soft accent bloom behind the landed row. Default `false` — OFF.
   *  It was a filled ellipse at half opacity faking a glow, so it read as a
   *  muddy lozenge (a shape, not light), not a real radial falloff. Opt in with
   *  `true` only if you know a theme's accent wants it. */
  glow?: boolean
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
  text: textProp = '2026',
  delay: delayIn = 0,
  charDelay: charDelayIn = STAGGER,
  durationInFrames: durationIn = DURATION.slower,
  fitToClip,
  maxSettle,
  hold,
  reelLength = 12,
  seed: seedProp = 7,
  variant,
  charset = '0123456789',
  color: colorProp,
  fontSize: fontSizeProp = 140,
  fit,
  maxWidth,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
  italic = false,
  letterSpacing,
  uppercase,
  glow = false,
  align = 'center',
  placement,
  x,
  y,
}: SlotMachineRollProps) {
  const text = applyTextCase(textProp, { uppercase })
  // The variant knob derives an alternate deterministic seed (identity at 0).
  const seed = variantSeed(seedProp, variant)
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  const chars = [...text]

  // Timing: parse the TimeInput props, then compress the WHOLE envelope when
  // the entrance (incl. the glow payoff) wouldn't land inside the clip.
  const delayBase = framesOf(delayIn, fps)
  const charDelayBase = framesOf(charDelayIn, fps, STAGGER)
  const durationBase = framesOf(durationIn, fps, DURATION.slower)
  const naturalSettle =
    staggeredSettle(chars.length, charDelayBase, durationBase, delayBase) + (DURATION.base - 8)
  const timeScale = useTimeScale(naturalSettle, { fitToClip, maxSettle, hold })
  const delay = delayBase * timeScale
  const charDelay = charDelayBase * timeScale
  const durationInFrames = Math.max(1, durationBase * timeScale)

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

  // Lay out columns on the SHARED glyph-line primitive — fixed cell advances
  // (column-locked reels), so the family shares ONE layout/alignment path.
  const laid = layoutGlyphLine(text, fontSize, { cellAdvance: advance })
  const totalWidth = laid.width

  // Anchor the block on the shared placement contract (block CENTER at the
  // resolved point; corner regions sit flush on the safe margin). Legacy px
  // `x`/`y` win per-axis when given: `align` decides which edge `x` pins, `y`
  // pins the block's top — exactly the pre-placement behavior.
  const resolved = usePlacement(placement, { width: totalWidth, height: cell })
  // `placement` is authoritative when set; the legacy pixel `x`/`y` apply ONLY
  // in the pre-placement path (no `placement`). Otherwise a stray `x`/`y` would
  // silently override an explicit placement (a 0.5 meant as a fraction reads as
  // 0.5 px → top-left).
  const useLegacy = placement === undefined
  const originX =
    useLegacy && x !== undefined
      ? align === 'left'
        ? x
        : align === 'right'
          ? x - totalWidth
          : x - totalWidth / 2
      : resolved.originX
  const originY = useLegacy && y !== undefined ? y : Math.round(resolved.originY)

  const local = frame - delay

  // One earned accent: a soft, low-opacity glow that blooms behind the landed row
  // as the reels settle — the only color in the piece (the digits stay near-white).
  // It eases in on the house spring once the LAST column has nominally landed, so
  // the bloom reads as the payoff of the roll, not a competing entrance.
  const lastStart = staggerFrames(Math.max(0, laid.cells.length - 1), charDelay)
  const glowP = spring({
    frame: local - lastStart - durationInFrames + 8,
    fps,
    config: SPRING_SMOOTH,
    durationInFrames: DURATION.base,
  })
  const glowOpacity = interpolate(glowP, [0, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  // A REAL bloom (not a solid ellipse): a circular accent falloff to FULLY
  // TRANSPARENT — so you read light, not a lozenge — stretched wide to hug the
  // row. The shape edge sits where the gradient is already transparent, so it's
  // invisible; the spring drives the reveal, the stop alphas set the softness.
  const glowCx = totalWidth / 2
  const glowCy = cell / 2
  const glowR = cell * 1.1
  const glowScaleX = Math.max(1, (totalWidth / 2 + cell * 0.45) / glowR)
  const accentRGB = parseColor(theme.accent)

  return (
    <Group x={originX} y={originY}>
      {/* One earned accent (opt-in via `glow`): a soft radial bloom behind the
          landed row. A circular accent falloff to FULLY TRANSPARENT — light, not
          a shape — stretched wide to hug the row. No hard body, no drop-shadow
          (those made it a muddy lozenge). Drawn first; digits read on top. */}
      {glow && (
        <Group originX={glowCx} originY={glowCy} scaleX={glowScaleX} scaleY={0.92}>
          <Ellipse
            x={glowCx - glowR * 1.1}
            y={glowCy - glowR * 1.1}
            width={glowR * 2.2}
            height={glowR * 2.2}
            opacity={glowOpacity}
            gradient={radialGradient([glowR * 1.1, glowR * 1.1], glowR, [
              { offset: 0, color: { ...accentRGB, a: 0.42 } },
              { offset: 0.45, color: { ...accentRGB, a: 0.14 } },
              { offset: 1, color: { ...accentRGB, a: 0 } },
            ])}
          />
        </Group>
      )}
      {laid.cells.map(({ ch, index: i, x: localX, space }) => {
        // Spaces occupy advance but render nothing — no reel, no window.
        if (space) return null

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
                    letterSpacing={letterSpacing}
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
