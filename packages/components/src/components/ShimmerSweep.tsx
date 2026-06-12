//! ShimmerSweep — a single bright band of light sweeps across text. Ported from ondajs.
//!
//! Restrained emphasis, not a disco: the base text sits in a dim `color`; a
//! brighter band travels through once (or loops on an interval), drawing the eye
//! without moving the layout. Linear motion by design — a sweep with spring
//! acceleration reads as broken.
//!
//! Scene-graph rendition of the ondajs (CSS) original:
//! - ondajs paints the shine with a `linear-gradient` clipped to the glyphs via
//!   `background-clip: text` and animates `backgroundPositionX`. We reproduce that
//!   faithfully: a translating `<Rect>` filled with a soft `linearGradient`
//!   (transparent → `shimmerColor` → transparent) is masked to the TEXT GLYPHS via
//!   an **alpha matte** (`matte={<Text/>}`) — the scene-graph equivalent of
//!   `background-clip: text`. The bright band rides OVER the dim base text and is
//!   revealed only where the letterforms are, so the shine shows ON the glyphs and
//!   never in the gaps around them. (Earlier versions clipped to a rectangular text
//!   BOX, which leaked the shine into the empty space between/around letters.)
//! - The sweep extent uses the REAL shaped width (`measureText`, warm in the
//!   browser preview and the Node export bake); pass `width` to override.
//! - `<Text>` is single-line (no wrap); pass a single line of `text`.
//! - `angle` is approximated by tilting the gradient's start/end points; the band
//!   itself translates horizontally (the dominant axis of the original sweep).
//! - `letterSpacing` and `lineHeight` from ondajs have no scene equivalent and
//!   are dropped (the engine owns line-box metrics).
//!
//! Backend caveat: the shine (gradient + matte) is a Vello/GPU effect. The CPU
//! reference collapses a gradient to its first stop (here fully transparent), so on
//! CPU the band is invisible and only the dim base text shows. On the WebGPU preview
//! the matte resolves via the async pre-pass — judge the look on a native render.
//! The base text is always legible on every backend.

import {
  Group,
  Rect,
  Text,
  interpolate,
  linearGradient,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import { HOUSE_EASE } from '../easing.js'
import { DURATION } from '../motion.js'
import { measureText, useTextMetricsReady } from '../text-metrics.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

/** Engine line-box height as a multiple of font size (typography crate). */
const LINE_RATIO = 1.2
/** Band width as a fraction of the text box — a soft, generous shine. */
const BAND_RATIO = 0.5

export interface ShimmerSweepProps {
  /** The single line of text to sweep light across. */
  text?: string
  /** Frames before the sweep starts. */
  delay?: TimeInput
  /** Frames for one sweep pass (default `DURATION.slower` = 30). */
  duration?: TimeInput
  /** Loop the sweep instead of a single pass. */
  loop?: boolean
  /** Frames between sweeps when looping. */
  interval?: TimeInput
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
  /** Explicit text-box width in px. Overrides the measured width. */
  width?: number
  /** Top-left x in px. Defaults to centering the word on the canvas. */
  x?: number
  /** Top-left y in px. Defaults to centering the word on the canvas. */
  y?: number
}

export function ShimmerSweep({
  text = 'Onda',
  delay: delayIn = 0,
  duration: durationIn = DURATION.slower,
  loop = false,
  interval: intervalIn = 60,
  color: colorProp,
  shimmerColor: shimmerColorProp,
  angle = 110,
  fontSize = 96,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
  width,
  x,
  y,
}: ShimmerSweepProps) {
  const frame = useCurrentFrame()
  const { width: canvasW, height: canvasH, fps } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const duration = framesOf(durationIn, fps)
  const interval = framesOf(intervalIn, fps)
  const theme = useTheme()
  useTextMetricsReady()
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

  // Real shaped text width drives the sweep extent (overridable via `width`); the
  // alpha matte below masks the shine to the actual glyphs regardless.
  const boxWidth = width ?? measureText(text, fontSize, { fontFamily, fontWeight }).width
  const boxHeight = fontSize * LINE_RATIO

  // Center the word on the canvas by default; `x`/`y` override the top-left.
  const groupX = x ?? Math.round(canvasW / 2 - boxWidth / 2)
  const groupY = y ?? Math.round(canvasH / 2 - boxHeight / 2)

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
    <Group x={groupX} y={groupY}>
      {/* Base text — dim, always legible, never moves. */}
      <Text fontSize={fontSize} color={color} fontFamily={fontFamily} fontWeight={fontWeight}>
        {text}
      </Text>
      {/* Bright shine band, masked to the TEXT GLYPHS via an alpha matte — the
          scene-graph `background-clip: text`. The matte Text sits at this Group's
          local origin (0,0), exactly over the base text, so the shine is revealed
          only on the letterforms (not the box around them). The band rides over the
          dim base text, brightening each glyph as it passes. */}
      <Group
        matte={
          <Text
            fontSize={fontSize}
            color={shimmerColor}
            fontFamily={fontFamily}
            fontWeight={fontWeight}
          >
            {text}
          </Text>
        }
        matteMode="alpha"
      >
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
