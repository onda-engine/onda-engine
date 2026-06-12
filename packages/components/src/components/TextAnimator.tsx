//! TextAnimator — the general per-unit text choreography primitive (the AE "text
//! animator" model). Where `KineticText` is opinionated presets, this is the open
//! system: choose the UNIT granularity (`glyph` | `word` | `line`), a stagger
//! ORDER (`forward` | `backward` | `center` | `edges`), and the set of channels to
//! ANIMATE (`opacity`/`x`/`y`/`scale`/`rotate`/`blur`/`color`), each a `[from, to]`
//! pair driven over a per-unit progress.
//!
//! Layout (HARD RULE 2 — the line never reflows): each unit's RESTING x is its
//! true shaped pen position from a single kerning-accurate `glyphLayout()` call
//! (one per line), and units are placed ABSOLUTELY. Per-frame motion lives on each
//! unit's OWN transform/opacity/blur, so a growing/rotating unit never jiggles its
//! neighbours. Multi-line text (`\n`) stacks by line height and the block is
//! centered on the canvas.
//!
//! Timing: unit `i` settles on the house spring (or a custom ease) over
//! `durationInFrames`, staggered by `staggerFrames(order(i), stagger)` — so the
//! animation wipes across the units. `order` is set by `direction`.
//!
//! Determinism: every value is a pure function of `frame` (springs are frame-keyed),
//! so the same frame renders identically every run — in preview and in export.
//! Custom fonts: until author-time font loading lands (techspecs/text-animators.md
//! G4), positions are accurate only for the BUNDLED families; a custom `fontFamily`
//! measures against the default and may drift from the render.

import {
  Group,
  type SpringConfig,
  Text,
  interpolate,
  interpolateColors,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import { useFittedFontSize } from '../bounds.js'
import { HOUSE_EASE } from '../easing.js'
import { DURATION, SPRING_SMOOTH, STAGGER, staggerFrames } from '../motion.js'
import { type Placement, usePlacement } from '../placement.js'
import { glyphLayout, measureText, useTextMetricsReady } from '../text-metrics.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'
import { staggeredSettle, useTimeScale } from '../timing.js'

/** What a unit is: a single glyph, a whitespace-delimited word, or a `\n` line. */
export type TextAnimatorUnit = 'glyph' | 'word' | 'line'

/** Stagger order across the units — which one leads the wipe. */
export type TextAnimatorDirection = 'forward' | 'backward' | 'center' | 'edges'

/** A `[from, to]` numeric pair animated over each unit's 0→1 progress. */
type Pair = readonly [number, number]

/** The channels a TextAnimator can drive per unit. Omitted channels stay at rest;
 *  a present channel eases from `from` (progress 0) to `to` (progress 1). */
export interface TextAnimate {
  /** Opacity `[from, to]` (e.g. `[0, 1]` to fade in). */
  opacity?: Pair
  /** translateX in px `[from, to]`. */
  x?: Pair
  /** translateY in px `[from, to]` (e.g. `[24, 0]` to rise). */
  y?: Pair
  /** Uniform scale `[from, to]`, pivoted about the unit's own center. */
  scale?: Pair
  /** Rotation in degrees `[from, to]`, pivoted about the unit's own center. */
  rotate?: Pair
  /** Blur sigma in px `[from, to]` (RTT focus-pull — judge on native/export). */
  blur?: Pair
  /** Color `[from, to]` (any ColorInput string). */
  color?: readonly [string, string]
}

export interface TextAnimatorProps {
  /** The text to choreograph. `\n` starts a new line. */
  text?: string
  /** Unit granularity (default `'glyph'`). */
  units?: TextAnimatorUnit
  /** Channels to animate per unit (default `{ opacity: [0, 1], y: [24, 0] }`). */
  animate?: TextAnimate
  /** Time between consecutive units entering (default `STAGGER` = 5 frames). */
  stagger?: TimeInput
  /** Time each unit takes to settle (default `DURATION.base`). */
  durationInFrames?: TimeInput
  /** Time before the FIRST unit starts (default 0). */
  delay?: TimeInput
  /** Compress the whole timing envelope (delay, stagger, durations) so the
   *  entrance settles at least `hold` before the end of the enclosing clip
   *  (`useVideoConfig().durationInFrames`, Sequence-scoped). Opt-in. */
  fitToClip?: boolean
  /** Hard cap on the settle time (frames or '0.5s'). Wins over `fitToClip`. */
  maxSettle?: TimeInput
  /** Breathing room before the cut for `fitToClip` (default 6 frames). */
  hold?: TimeInput
  /** Stagger order across units (default `'forward'`). */
  direction?: TextAnimatorDirection
  /** Physical settle spring; pass `false` to use `ease` instead (default `SPRING_SMOOTH`). */
  spring?: SpringConfig | false
  /** Easing used when `spring` is `false` (default the house ease-out). */
  ease?: (t: number) => number
  /** Font size in px (default 96). */
  fontSize?: number
  /** Opt-in auto-fit: `'frame'` scales the font size DOWN (never up) so the
   *  line cannot exceed the frame minus the safe margins. Default `'none'`
   *  (the historical behavior). */
  fit?: 'none' | 'frame'
  /** Explicit width cap in px for the line; combines with `fit` (the smaller
   *  cap wins). */
  maxWidth?: number
  /** Resting text color (default theme `text`). */
  color?: string
  /** Loaded font family (default theme `fontFamily`). */
  fontFamily?: string
  /** Font weight (display default 600). */
  fontWeight?: number
  /** Horizontal alignment of each line about the placement anchor (default `'center'`). */
  align?: 'left' | 'center' | 'right'
  /** Where the text block sits: a region keyword (`'center'`, `'lower-third'`,
   *  …) or normalized `{x,y}` (0–1, block center). The shared placement
   *  contract; default `'center'` (the historical centering). */
  placement?: Placement
}

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** One absolutely-placed unit ready to animate. */
interface PlacedUnit {
  content: string
  /** Pen x within its line (from glyphLayout). */
  lineX: number
  /** 0-based line index (for vertical stacking + per-line alignment). */
  lineIndex: number
  /** Unit width in px — the pivot width for scale/rotate. */
  width: number
}

/** Stagger order for unit `i` of `n`, per `direction`. */
function orderOf(i: number, n: number, direction: TextAnimatorDirection): number {
  const mid = (n - 1) / 2
  switch (direction) {
    case 'backward':
      return n - 1 - i
    case 'center': // center leads, edges trail
      return Math.round(Math.abs(i - mid))
    case 'edges': // edges lead, center trails
      return Math.round(mid - Math.abs(i - mid))
    default:
      return i
  }
}

export function TextAnimator({
  text = 'Animate',
  units = 'glyph',
  animate,
  stagger: staggerIn = STAGGER,
  durationInFrames: durationIn = DURATION.base,
  delay: delayIn = 0,
  fitToClip,
  maxSettle,
  hold,
  direction = 'forward',
  spring: springConfig = SPRING_SMOOTH,
  ease = HOUSE_EASE,
  fontSize: fontSizeProp = 96,
  fit,
  maxWidth,
  color: colorProp,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
  align = 'center',
  placement,
}: TextAnimatorProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.fontFamily
  const channels = animate ?? { opacity: [0, 1] as Pair, y: [24, 0] as Pair }

  // `useTextMetricsReady` warms the engine in the browser (re-renders when ready);
  // `glyphLayout` is the sync, kerning-accurate read used per line below.
  useTextMetricsReady()
  const measureOpts = { fontFamily, fontWeight }

  // Opt-in auto-fit against the WIDEST line (measured at the requested size);
  // every line then lays out at the fitted size.
  const lines = text.split('\n')
  let widest = lines[0] ?? ''
  if (lines.length > 1) {
    let widestW = -1
    for (const line of lines) {
      const w = measureText(line, fontSizeProp, measureOpts).width
      if (w > widestW) {
        widestW = w
        widest = line
      }
    }
  }
  const fontSize = useFittedFontSize(widest, fontSizeProp, { ...measureOpts, fit, maxWidth })
  const lineHeight = fontSize * 1.2 // engine default (Metrics line height)

  // Build absolutely-placed units, one pass per line. glyphLayout byte offsets are
  // UTF-8; JS string indices are UTF-16, so decode each line's bytes by range.
  const decoder = new TextDecoder()
  const placed: PlacedUnit[] = []
  const lineWidths: number[] = []
  lines.forEach((line, lineIndex) => {
    const clusters = glyphLayout(line, fontSize, measureOpts)
    const lineBytes = new TextEncoder().encode(line)
    const sliceCluster = (s: number, e: number) => decoder.decode(lineBytes.subarray(s, e))
    const lastCluster = clusters[clusters.length - 1]
    lineWidths[lineIndex] = lastCluster ? lastCluster.x + lastCluster.advance : 0

    if (units === 'line') {
      if (line.trim().length > 0) {
        placed.push({ content: line, lineX: 0, lineIndex, width: lineWidths[lineIndex] })
      }
      return
    }

    if (units === 'word') {
      let startX: number | null = null
      let endX = 0
      let chars: string[] = []
      const flush = () => {
        if (chars.length > 0 && startX !== null) {
          placed.push({ content: chars.join(''), lineX: startX, lineIndex, width: endX - startX })
        }
        startX = null
        endX = 0
        chars = []
      }
      for (const g of clusters) {
        const ch = sliceCluster(g.start, g.end)
        if (ch.trim().length === 0) {
          flush() // whitespace ends a word
          continue
        }
        if (startX === null) startX = g.x
        endX = g.x + g.advance
        chars.push(ch)
      }
      flush()
      return
    }

    // glyph
    for (const g of clusters) {
      const ch = sliceCluster(g.start, g.end)
      if (ch.trim().length === 0) continue // space advances, emits no node
      placed.push({ content: ch, lineX: g.x, lineIndex, width: g.advance })
    }
  })

  const n = placed.length

  // Timing: parse the TimeInput props, then compress the envelope when the
  // last unit wouldn't settle inside the clip.
  const staggerBase = framesOf(staggerIn, fps, STAGGER)
  const durationBase = framesOf(durationIn, fps, DURATION.base)
  const delayBase = framesOf(delayIn, fps)
  const naturalSettle = staggeredSettle(n, staggerBase, durationBase, delayBase)
  const timeScale = useTimeScale(naturalSettle, { fitToClip, maxSettle, hold })
  const stagger = staggerBase * timeScale
  const durationInFrames = Math.max(1, durationBase * timeScale)
  const delay = delayBase * timeScale

  // Anchor the block on the shared placement contract (block CENTER at the
  // resolved point; corner regions sit flush on the safe margin). The default
  // `'center'` reproduces the historical canvas-centering exactly.
  const blockWidth = lineWidths.length > 0 ? Math.max(...lineWidths) : 0
  const blockHeight = (lines.length - 1) * lineHeight + fontSize * 1.2
  const resolved = usePlacement(placement, { width: blockWidth, height: blockHeight })
  const anchorX = Math.round(resolved.x)
  const startXOf = (lineIndex: number) => {
    const lw = lineWidths[lineIndex] ?? 0
    return align === 'center' ? anchorX - lw / 2 : align === 'right' ? anchorX - lw : anchorX
  }
  // Center the whole block vertically about the anchor; one line reduces to
  // KineticText's baseline.
  const blockOffset = ((lines.length - 1) * lineHeight) / 2
  const baseYOf = (lineIndex: number) =>
    Math.round(resolved.y - fontSize * 0.6) + lineIndex * lineHeight - blockOffset

  return (
    <Group>
      {placed.map((unit, i) => {
        const order = orderOf(i, n, direction)
        const local = Math.max(0, frame - delay - staggerFrames(order, stagger))
        const progress = springConfig
          ? spring({ frame: local, fps, config: springConfig, durationInFrames })
          : interpolate(
              frame,
              [
                delay + staggerFrames(order, stagger),
                delay + staggerFrames(order, stagger) + durationInFrames,
              ],
              [0, 1],
              { ...CLAMP, easing: ease },
            )

        const at = (p: Pair | undefined, fallback: number) =>
          p ? interpolate(progress, [0, 1], p, CLAMP) : fallback

        const opacity = at(channels.opacity, 1)
        const dx = at(channels.x, 0)
        const dy = at(channels.y, 0)
        const scale = at(channels.scale, 1)
        const rot = at(channels.rotate, 0)
        const blur = at(channels.blur, 0)
        const unitColor = channels.color
          ? interpolateColors(progress, [0, 1], channels.color, CLAMP)
          : color

        // Pivot scale/rotate about the unit's own center so it transforms in place.
        const pivoted = scale !== 1 || rot !== 0
        const originX = pivoted ? unit.width / 2 : 0
        const originY = pivoted ? fontSize / 2 : 0

        return (
          <Text
            key={`${unit.lineIndex}:${i}:${unit.content}`}
            x={startXOf(unit.lineIndex) + unit.lineX + dx}
            y={baseYOf(unit.lineIndex) + dy}
            scaleX={scale}
            scaleY={scale}
            originX={originX}
            originY={originY}
            rotation={rot}
            blur={blur > 0.01 ? blur : undefined}
            opacity={opacity}
            fontSize={fontSize}
            color={unitColor}
            fontFamily={fontFamily}
            fontWeight={fontWeight}
          >
            {unit.content}
          </Text>
        )
      })}
    </Group>
  )
}
