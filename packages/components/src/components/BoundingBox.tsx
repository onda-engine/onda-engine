//! BoundingBox — a stroked rectangle outline that reveals around a region, with
//! optional corner ticks and a label tag pinned to its top-left corner. A UI
//! annotation for docs / tutorial videos — the accent is earned here. Ported
//! from ondajs.
//!
//! Two-phase choreography, matching the ondajs original:
//!   1. The outline reveals on the house spring (`SPRING_SMOOTH`) over
//!      `drawDuration`, its opacity easing 0.4 → 1 so the line gains presence as
//!      it lands.
//!   2. Once the outline settles, the corner ticks fade in and the label tag
//!      fades + scales in alongside them — one thing at a time.
//!
//! Reveal approach vs ondajs: ondajs "draws" the perimeter with an animated SVG
//! stroke-dash (`evolvePath`). The engine has no stroke-dash draw-on, so the
//! outline is revealed by a centered fade + scale-in instead (a calm settle,
//! still on the house spring). To keep the scale anchored on the box's CENTER
//! (scene scale pivots on a node's local origin, not its center), the outline
//! subtree's origin is placed at the box center via a nested `<Group>`.
//!
//! Geometry follows the ondajs schema: `x`/`y`/`width`/`height` are `0..1`
//! fractions of the composition, resolved against `useVideoConfig()`. Corner
//! ticks are `<Path>` L-marks (GPU/Vello backend only, like all paths). The
//! label tag's width is ESTIMATED from glyph count — the engine measures text at
//! render time but a pure frame→scene function can't read that back (the
//! `Highlight`/`Underline` pattern).
//!
//! Corners are SHARP by default (`cornerRadius = 0`), matching ondajs's
//! selection-marquee look — the L-shaped corner ticks pin to the sharp corners.
//! `cornerRadius` is exposed as an optional rounding for the outline `<Rect>`.
//!
//! Approximation: ondajs adds a CSS `drop-shadow(0 0 8px color)` glow on the
//! outline; the engine has no blur/shadow filter, so the glow is omitted. The
//! outline color still reads as the earned accent. ondajs's `letter-spacing`
//! `0.02em` on the label is unsupported and omitted.

import {
  Group,
  Path,
  Rect,
  Text,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import { entryFade, entryScale } from '../choreography.js'
import { DURATION, SPRING_SMOOTH } from '../motion.js'
import { useTheme } from '../theme.js'

/** Mean glyph advance as a fraction of font size, for a display face. Used only
 *  to size the label tag (the engine measures the real glyphs at render time). */
const CHAR_WIDTH_FACTOR = 0.56
/** Engine line-box height as a multiple of font size (matches typography crate). */
const LINE_RATIO = 1.2

export interface BoundingBoxProps {
  /** Box left edge as a `0..1` fraction of the composition width. */
  x?: number
  /** Box top edge as a `0..1` fraction of the composition height. */
  y?: number
  /** Box width as a `0..1` fraction of the composition width. */
  width?: number
  /** Box height as a `0..1` fraction of the composition height. */
  height?: number
  /** Optional label tag pinned to the box's top-left corner. Empty hides it. */
  label?: string
  /** Outline / tick / tag color — the earned Onda rose by default (default: theme `accent`). */
  color?: string
  /** Frames before the outline starts revealing. */
  delay?: number
  /** Frames to reveal the full outline (default `DURATION.slow` = 24). */
  drawDuration?: number
  /** Outline stroke width in px. */
  strokeWidth?: number
  /** Corner radius of the outline in px. Defaults to `0` (sharp corners, like the
   *  ondajs selection marquee); set > 0 to round the outline. */
  cornerRadius?: number
  /** Draw small L-shaped tick marks at each corner after the outline lands. */
  corners?: boolean
  /** Label text color — a dark for contrast on the accent tag by default. */
  labelColor?: string
  /** Label font size in px. */
  fontSize?: number
  /** Label font family (must be loaded by the renderer) (default: theme `headingFamily`). */
  fontFamily?: string
}

export function BoundingBox({
  x = 0.3,
  y = 0.3,
  width = 0.4,
  height = 0.4,
  label = '',
  color: colorProp,
  delay = 0,
  drawDuration = DURATION.slow,
  strokeWidth = 3,
  cornerRadius = 0,
  corners = true,
  labelColor = '#08080a',
  fontSize = 16,
  fontFamily: fontFamilyProp,
}: BoundingBoxProps) {
  const frame = useCurrentFrame()
  const { fps, width: canvasW, height: canvasH } = useVideoConfig()
  const theme = useTheme()
  const color = colorProp ?? theme.accent
  const fontFamily = fontFamilyProp ?? theme.headingFamily ?? theme.fontFamily

  // Box geometry in pixel space.
  const bx = x * canvasW
  const by = y * canvasH
  const bw = width * canvasW
  const bh = height * canvasH

  // Phase 1 — outline reveal on the house spring. ondajs strokes the perimeter
  // on (dash); with no stroke-dash here we reveal via a centered fade + scale.
  const drawProgress = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: SPRING_SMOOTH,
    durationInFrames: Math.max(1, drawDuration),
  })
  // Match ondajs: a calm scale settle, no overshoot, and opacity easing 0.4 → 1
  // so the line gains presence as it lands rather than popping in at full.
  const outlineScale = interpolate(drawProgress, [0, 1], [0.92, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const outlineOpacity = interpolate(drawProgress, [0, 1], [0.4, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  // Phase 2 — ticks + tag come in once the outline has essentially landed.
  const phaseTwoDelay = delay + drawDuration
  const { opacity: tickOpacity } = entryFade({
    frame,
    fps,
    delay: phaseTwoDelay,
    durationInFrames: DURATION.fast,
  })
  const tagFade = entryFade({ frame, fps, delay: phaseTwoDelay, durationInFrames: DURATION.base })
  const tagScale = entryScale({ frame, fps, delay: phaseTwoDelay, durationInFrames: DURATION.base })

  // L-shaped tick length — a short mark hugging each corner just inside the box.
  const tickLen = Math.min(bw, bh) * 0.14
  // Corner ticks use a slightly heavier stroke than the outline (ondajs +1).
  const tickStroke = strokeWidth + 1

  // L-shaped tick at corner (cx, cy). `sx`/`sy` are the directions (±1) the two
  // legs extend inward from the corner. Coordinates are in the outline subtree's
  // local space (origin at the box center — see the centered `<Group>` below).
  const cornerTick = (cx: number, cy: number, sx: number, sy: number) =>
    `M ${cx + sx * tickLen} ${cy} L ${cx} ${cy} L ${cx} ${cy + sy * tickLen}`

  // Label tag geometry — pinned just above the top-left corner. Width estimated
  // from glyph count (no author-time text metrics). The tag is a rounded filled
  // Rect with the label drawn on top.
  const showTag = label !== ''
  const tagPadX = 10
  const tagPadY = 4
  const tagGap = 6
  const estTextWidth = label.length * fontSize * CHAR_WIDTH_FACTOR
  const tagWidth = estTextWidth + tagPadX * 2
  const tagHeight = fontSize * LINE_RATIO + tagPadY * 2
  const tagRadius = 6
  // Center the cap-height of the text within the tag box.
  const textY = (tagHeight - fontSize * LINE_RATIO) / 2

  return (
    <Group x={bx} y={by}>
      {/* Outline subtree, origin at the box center so the reveal scale grows
          from the middle (scene scale pivots on the local origin). */}
      <Group x={bw / 2} y={bh / 2}>
        <Group scaleX={outlineScale} scaleY={outlineScale} opacity={outlineOpacity}>
          {/* The stroked outline (no fill) — placed back at the box's top-left
              relative to the centered origin. */}
          <Rect
            x={-bw / 2}
            y={-bh / 2}
            width={bw}
            height={bh}
            cornerRadius={cornerRadius}
            stroke={color}
            strokeWidth={strokeWidth}
          />
          {corners && tickLen > 0 ? (
            <Group opacity={tickOpacity}>
              {/* Corner ticks in the centered local space (box spans
                  [-bw/2, -bh/2] .. [bw/2, bh/2]). */}
              <Path
                d={cornerTick(-bw / 2, -bh / 2, 1, 1)}
                stroke={color}
                strokeWidth={tickStroke}
              />
              <Path
                d={cornerTick(bw / 2, -bh / 2, -1, 1)}
                stroke={color}
                strokeWidth={tickStroke}
              />
              <Path
                d={cornerTick(bw / 2, bh / 2, -1, -1)}
                stroke={color}
                strokeWidth={tickStroke}
              />
              <Path
                d={cornerTick(-bw / 2, bh / 2, 1, -1)}
                stroke={color}
                strokeWidth={tickStroke}
              />
            </Group>
          ) : null}
        </Group>
      </Group>
      {/* Label tag pinned above the top-left corner. Fades + scales in alongside
          the ticks. Scale pivots on the tag's bottom-left (its local origin sits
          there) so it grows up-and-out from the corner, matching ondajs's
          `transform-origin: bottom left`. */}
      {showTag ? (
        <Group y={-(tagHeight + tagGap)} opacity={tagFade.opacity}>
          <Group scaleX={tagScale.scaleX} scaleY={tagScale.scaleY}>
            <Rect width={tagWidth} height={tagHeight} cornerRadius={tagRadius} fill={color} />
            <Text
              x={tagPadX}
              y={textY}
              fontSize={fontSize}
              color={labelColor}
              fontFamily={fontFamily}
              fontWeight={600}
            >
              {label}
            </Text>
          </Group>
        </Group>
      ) : null}
    </Group>
  )
}
