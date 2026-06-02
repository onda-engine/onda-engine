//! ShimmerSweep — a single bright band of light sweeps across text. Ported from ondajs.
//!
//! Restrained emphasis, not a disco: the base text sits in a dim `color`; a
//! brighter band travels through once (or loops on an interval), drawing the eye
//! without moving the layout. Linear motion by design — a sweep with spring
//! acceleration reads as broken.
//!
//! Scene-graph approximation vs the ondajs (CSS) original:
//! - ondajs paints the shine with a `linear-gradient` clipped to the glyphs via
//!   `background-clip: text` and animates `backgroundPositionX`. The scene graph
//!   has no text-clipped fills, so the band is reproduced as a translating
//!   `<Rect>` filled with a soft `linearGradient` (transparent → `shimmerColor`
//!   → transparent), clipped to the estimated TEXT BOX (not the glyph outlines)
//!   via `clip={clipRect(...)}`. The bright band rides OVER the base text and is
//!   masked to the box, so it reads as a shine passing across the word.
//! - No author-time text metrics exist, so the box width is ESTIMATED from glyph
//!   count × fontSize × an advance ratio (the Marquee/Underline heuristic). Pass
//!   `width` to override when the exact extent is known.
//! - `<Text>` is single-line (no wrap); pass a single line of `text`.
//! - `angle` is approximated by tilting the gradient's start/end points; the band
//!   itself translates horizontally (the dominant axis of the original sweep).
//! - `letterSpacing` and `lineHeight` from ondajs have no scene equivalent and
//!   are dropped (the engine owns line-box metrics).
//!
//! Backend caveat: gradients render only on the Vello/GPU backend. The CPU
//! reference rasterizer collapses a gradient to its first stop (here fully
//! transparent), so on CPU the band is invisible and only the base text shows —
//! the shine is a GPU-only effect. The base text is always legible.

import {
  Group,
  Rect,
  Text,
  clipRect,
  interpolate,
  linearGradient,
  useCurrentFrame,
} from '@onda/react'
import { HOUSE_EASE } from '../easing.js'
import { DURATION } from '../motion.js'
import { useTheme } from '../theme.js'

/** Mean glyph advance as a fraction of font size — a display-sans heuristic used
 *  only to estimate the text box (the engine measures the real glyphs). Matches
 *  the ratio Underline uses. */
const CHAR_WIDTH_FACTOR = 0.52
/** Engine line-box height as a multiple of font size (typography crate). */
const LINE_RATIO = 1.2
/** Band width as a fraction of the text box — a soft, generous shine. */
const BAND_RATIO = 0.5

export interface ShimmerSweepProps {
  /** The single line of text to sweep light across. */
  text?: string
  /** Frames before the sweep starts. */
  delay?: number
  /** Frames for one sweep pass (default `DURATION.slower` = 30). */
  duration?: number
  /** Loop the sweep instead of a single pass. */
  loop?: boolean
  /** Frames between sweeps when looping. */
  interval?: number
  /** Base (dim) text color so the bright band reads as a highlight (default: theme `textMuted`). */
  color?: string
  /** The sweeping highlight color (default: theme `text`). */
  shimmerColor?: string
  /** Sweep angle in degrees (approximated by tilting the gradient band). */
  angle?: number
  /** Font size in px (default 96). */
  fontSize?: number
  /** Loaded font family (e.g. a `--font` passed to `onda render`) (default: theme `fontFamily`). */
  fontFamily?: string
  /** Font weight (display default 600). */
  fontWeight?: number
  /** Explicit text-box width in px. Overrides the glyph-count estimate. */
  width?: number
  /** Local-space placement of the component's top-left. */
  x?: number
  /** Local-space placement of the component's top-left. */
  y?: number
}

export function ShimmerSweep({
  text = 'Onda',
  delay = 0,
  duration = DURATION.slower,
  loop = false,
  interval = 60,
  color: colorProp,
  shimmerColor: shimmerColorProp,
  angle = 110,
  fontSize = 96,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
  width,
  x = 0,
  y = 0,
}: ShimmerSweepProps) {
  const frame = useCurrentFrame()
  const theme = useTheme()
  const color = colorProp ?? theme.textMuted
  const shimmerColor = shimmerColorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  const local = frame - delay

  // Progress 0 → 1 across one pass. Loop wraps on `interval` (linear); a single
  // pass eases on HOUSE_EASE and clamps, matching the ondajs timing.
  const safeInterval = Math.max(1, interval)
  const t = loop
    ? (((local % safeInterval) + safeInterval) % safeInterval) / safeInterval
    : interpolate(local, [0, Math.max(1, duration)], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: HOUSE_EASE,
      })

  // Estimated text box (overridable). The clip masks the shine to this region.
  const boxWidth = width ?? Math.max(0, text.length) * fontSize * CHAR_WIDTH_FACTOR
  const boxHeight = fontSize * LINE_RATIO

  // The bright band is wider than the visible window so its soft edges live
  // off-box at the extremes of the pass. It travels from fully off the right to
  // fully off the left across `t` (linear within the pass).
  const bandWidth = Math.max(1, boxWidth * BAND_RATIO)
  const startX = boxWidth // band's left edge starts just off the right edge
  const endX = -bandWidth // band's left edge ends just off the left edge
  const bandX = interpolate(t, [0, 1], [startX, endX], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  // Transparent ends, bright middle. The FIRST stop is transparent so the CPU
  // reference (which collapses to the first stop) shows nothing rather than a
  // hard block — leaving the base text clean.
  const transparent = toTransparent(shimmerColor)

  // Approximate `angle` by tilting the gradient axis. 90° is a vertical band
  // (a clean horizontal sweep); deviation from 90° leans the band. Local space.
  const rad = (angle * Math.PI) / 180
  const tilt = Math.cos(rad) // 0 at 90°, ±1 at 0/180°
  const gx0 = 0
  const gy0 = 0
  const gx1 = bandWidth
  const gy1 = boxHeight * tilt

  return (
    <Group x={x} y={y}>
      {/* Base text — dim, always legible, never moves. */}
      <Text fontSize={fontSize} color={color} fontFamily={fontFamily} fontWeight={fontWeight}>
        {text}
      </Text>
      {/* Bright shine band, masked to the estimated text box. The clip region
          sits at this Group's local origin (0,0), matching the text top-left. */}
      <Group clip={clipRect(boxWidth, boxHeight)}>
        <Group x={bandX}>
          <Rect
            width={bandWidth}
            height={boxHeight}
            gradient={linearGradient(
              [gx0, gy0],
              [gx1, gy1],
              [
                { offset: 0, color: transparent },
                { offset: 0.5, color: shimmerColor },
                { offset: 1, color: transparent },
              ],
            )}
          />
        </Group>
      </Group>
    </Group>
  )
}

/** Return `color` with its alpha channel forced to `00` (fully transparent),
 *  preserving the RGB so the band fades out rather than toward black. */
function toTransparent(color: string): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    if (hex.length === 6 || hex.length === 8) {
      return `#${hex.slice(0, 6)}00`
    }
    if (hex.length === 3) {
      const r = hex[0] ?? '0'
      const g = hex[1] ?? '0'
      const b = hex[2] ?? '0'
      return `#${r}${r}${g}${g}${b}${b}00`
    }
  }
  return '#00000000'
}
