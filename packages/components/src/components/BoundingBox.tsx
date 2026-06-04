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
//! label tag's width is MEASURED from the shaped glyphs via `useTextMetrics`
//! (proportional — exact); it falls back to a glyph-count estimate until the
//! wasm engine warms in the browser (the `Highlight`/`Underline` pattern).
//!
//! Corners are SHARP by default (`cornerRadius = 0`), matching ondajs's
//! selection-marquee look — the L-shaped corner ticks pin to the sharp corners.
//! `cornerRadius` is exposed as an optional rounding for the outline `<Rect>`.
//!
//! Approximation: ondajs adds a CSS `drop-shadow(0 0 8px color)` glow on the
//! outline; the engine has no blur/shadow filter, so the glow is omitted. The
//! outline color still reads as the earned accent. ondajs's `letter-spacing`
//! `0.02em` on the label is unsupported and omitted.

import { Group, Rect, Text, interpolate, useCurrentFrame, useVideoConfig } from '@onda/react'
import { entryFade, entryScale } from '../choreography.js'
import { HOUSE_EASE } from '../easing.js'
import { DURATION } from '../motion.js'
import { useTextMetrics } from '../text-metrics.js'
import { useTheme } from '../theme.js'

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
  /** Reserved (kept for API compatibility). The perimeter draw-on traces sharp
   *  corners (the selection-marquee look), so outline rounding is not applied. */
  cornerRadius?: number
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
  labelColor = '#08080a',
  fontSize = 16,
  fontFamily: fontFamilyProp,
}: BoundingBoxProps) {
  const frame = useCurrentFrame()
  const { fps, width: canvasW, height: canvasH } = useVideoConfig()
  const theme = useTheme()
  const color = colorProp ?? theme.accent
  const fontFamily = fontFamilyProp ?? theme.headingFamily ?? theme.fontFamily

  // Real shaped label width — the engine measures the glyphs (proportional —
  // exact); falls back to a glyph-count estimate until the wasm engine warms in
  // the browser.
  const measured = useTextMetrics(label, fontSize, { fontFamily })

  // Box geometry in pixel space.
  const bx = x * canvasW
  const by = y * canvasH
  const bw = width * canvasW
  const bh = height * canvasH

  // Phase 1 — the outline draws on. A smooth eased ramp (not a spring) gives the
  // pen an even pace across the whole perimeter rather than snapping most edges
  // in the first few frames.
  const drawProgress = interpolate(frame, [delay, delay + Math.max(1, drawDuration)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: HOUSE_EASE,
  })
  // Real draw-on via animated stroke-dash: one dash as long as the whole
  // perimeter, its offset retreating to 0 as `drawProgress` → 1, so the outline
  // is "drawn" clockwise from the top-left like a pen. Renders on both backends.
  const perim = 2 * (bw + bh)
  const dashOffset = perim * (1 - drawProgress)

  // Phase 2 — the label tag comes in once the outline has essentially landed.
  const phaseTwoDelay = delay + drawDuration
  const tagFade = entryFade({ frame, fps, delay: phaseTwoDelay, durationInFrames: DURATION.base })
  const tagScale = entryScale({ frame, fps, delay: phaseTwoDelay, durationInFrames: DURATION.base })

  // Label tag geometry — pinned just above the top-left corner. Width measured
  // from the shaped glyphs (see `useTextMetrics` above). The tag is a rounded
  // filled Rect with the label drawn on top.
  const showTag = label !== ''
  const tagPadX = 10
  const tagPadY = 4
  const tagGap = 6
  const tagWidth = measured.width + tagPadX * 2
  const tagHeight = fontSize * LINE_RATIO + tagPadY * 2
  const tagRadius = 6
  // Center the cap-height of the text within the tag box.
  const textY = (tagHeight - fontSize * LINE_RATIO) / 2

  return (
    <Group x={bx} y={by}>
      {/* The outline, drawn on by an animated stroke-dash around the perimeter
          (clockwise from the top-left). `cornerRadius` rounds the corners. */}
      {drawProgress > 0.001 ? (
        <Rect
          width={bw}
          height={bh}
          cornerRadius={cornerRadius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeCap="round"
          strokeJoin="round"
          strokeDash={[perim, perim]}
          strokeDashOffset={dashOffset}
        />
      ) : null}
      {/* Label tag pinned above the top-left corner. Fades + scales in once the
          outline lands. Scale pivots on the tag's bottom-left (its local origin
          sits there) so it grows up-and-out from the corner, matching ondajs's
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
