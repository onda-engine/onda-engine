//! Callout — a speech bubble (rounded `<Rect>` body + pointer triangle `<Path>` +
//! `<Text>` label) that lands on the house spring to annotate a spot on the
//! canvas. Ported from ondajs.
//!
//! Two-phase reveal, matching the ondajs restraint signature (one move at a
//! time): the bubble lands first (scale 0.9 → 1 + fade, `entryScale` + `entryFade`
//! on SPRING_SMOOTH), then after a `lineDelay` beat the pointer triangle eases in
//! toward the anchor (`entryFadeRise`). The eye is never asked to track two
//! things at once.
//!
//! Divergence from the ondajs original: ondajs drew an anchor-relative arrow
//! LINE that strokes on via `@remotion/paths` `evolvePath` (a stroke-dash
//! reveal). The scene graph has NO stroke-dash animation, so the faithful
//! scene-graph equivalent of "an annotation that points" is a classic speech
//! bubble with a pointer triangle whose SIDE is chosen by `direction`. Prop
//! names that carry over (label, x, y, delay, duration, lineDelay, color,
//! bgColor, borderColor, fontSize, fontFamily) keep their ondajs meaning — in
//! particular `x`/`y` stay 0..1 fractions of the canvas (default 0.5/0.5 =
//! center), resolved to pixels via the composition size, exactly like ondajs.
//!
//! Scene-graph notes:
//! - No JS-side text measurement, so the bubble width is ESTIMATED from glyph
//!   count (`fontSize * label.length * WIDTH_RATIO` + horizontal padding). Pass
//!   `width` to override when the exact text extent is known.
//! - Scene scale pivots on a node's LOCAL ORIGIN (0,0), not its center. To make
//!   the bubble grow about its own center, the scaling `<Group>` is placed at the
//!   bubble center and the body/label/pointer are drawn relative to that center.
//! - The component anchors itself via the `x`/`y` props (canvas fractions), so it
//!   is NOT a layout child — drop it directly in a scene; do not place it inside a
//!   `<Flex>`/`<AbsoluteFill>` and also rely on its own x/y.

import { Group, Path, Rect, Text, useCurrentFrame, useVideoConfig } from '@onda/react'
import { entryFade, entryFadeRise, entryScale } from '../choreography.js'
import { DURATION } from '../motion.js'

/** Empirical advance ratio: average glyph advance ÷ font size for a display
 *  face. Used only to estimate the bubble width when `width` is omitted. */
const WIDTH_RATIO = 0.56

/** Which side of the bubble the pointer triangle sticks out from (and thus the
 *  rough direction the callout is aimed). */
export type CalloutDirection = 'top' | 'bottom' | 'left' | 'right'

export interface CalloutProps {
  /** Bubble label. Single line — no auto-wrap. */
  label?: string
  /** Bubble-center X as a 0..1 fraction of canvas width (default 0.5 = center). */
  x?: number
  /** Bubble-center Y as a 0..1 fraction of canvas height (default 0.5 = center). */
  y?: number
  /** Side the pointer triangle sticks out from (default `'bottom'`). */
  direction?: CalloutDirection
  /** Frames before the bubble starts revealing. */
  delay?: number
  /** Bubble scale-and-fade reveal duration in frames (default `DURATION.base`). */
  duration?: number
  /** Frames after the bubble starts before the pointer eases in (default 6). */
  lineDelay?: number
  /** Pointer reveal duration in frames (default `DURATION.base`). */
  lineDuration?: number
  /** Label color. */
  color?: string
  /** Bubble background fill. */
  bgColor?: string
  /** Bubble border color. */
  borderColor?: string
  /** Bubble border width in px (default 1). */
  borderWidth?: number
  /** Label font size in px (default 20). */
  fontSize?: number
  /** Loaded font family (the Onda display font). */
  fontFamily?: string
  /** Label font weight (default 500). */
  fontWeight?: number
  /** Horizontal padding inside the bubble (default 14). */
  paddingX?: number
  /** Vertical padding inside the bubble (default 8). */
  paddingY?: number
  /** Bubble corner radius (default 12). */
  cornerRadius?: number
  /** Pointer triangle base width in px (default 18). */
  pointerWidth?: number
  /** Pointer triangle length (how far it pokes out) in px (default 12). */
  pointerLength?: number
  /** Explicit bubble width in px. Overrides the glyph-count estimate. */
  width?: number
}

export function Callout({
  label = 'Look here',
  x = 0.5,
  y = 0.5,
  direction = 'bottom',
  delay = 0,
  duration = DURATION.base,
  lineDelay = 6,
  lineDuration = DURATION.base,
  color = '#f2f2f4',
  bgColor = '#0e0e12',
  borderColor = '#26262e',
  borderWidth = 1,
  fontSize = 20,
  fontFamily,
  fontWeight = 500,
  paddingX = 14,
  paddingY = 8,
  cornerRadius = 12,
  pointerWidth = 18,
  pointerLength = 12,
  width,
}: CalloutProps) {
  const frame = useCurrentFrame()
  const { fps, width: compWidth, height: compHeight } = useVideoConfig()

  // Bubble center in pixels. x/y are 0..1 canvas fractions (ondajs semantics),
  // so the default 0.5/0.5 centers the bubble regardless of resolution.
  const centerX = x * compWidth
  const centerY = y * compHeight

  // Bubble reveal — entryScale (0.9 → 1) for the transform, entryFade for the
  // matching opacity. Both on SPRING_SMOOTH so fade and scale stay locked.
  const fade = entryFade({ frame, fps, delay, durationInFrames: duration })
  const grow = entryScale({ frame, fps, delay, durationInFrames: duration })

  // Pointer eases in after the bubble lands — one-thing-at-a-time pacing. Rises
  // toward the bubble (replacing the ondajs arrow's draw-on beat).
  const pointerMotion = entryFadeRise({
    frame,
    fps,
    delay: delay + lineDelay,
    durationInFrames: lineDuration,
    travelPx: 6,
  })

  // Bubble box. Estimate the text extent from glyph count unless given.
  const estTextWidth = label.length * fontSize * WIDTH_RATIO
  const bubbleW = width ?? Math.round(estTextWidth + paddingX * 2)
  // Engine line box height ≈ fontSize * 1.2; add vertical padding.
  const bubbleH = Math.round(fontSize * 1.2 + paddingY * 2)

  // Half-extents — everything is drawn relative to the bubble CENTER so the
  // scale (which pivots on the scaling group's local origin) grows about center.
  const halfW = bubbleW / 2
  const halfH = bubbleH / 2

  // Pointer triangle in bubble-center-relative coordinates. Apex points outward
  // along `direction`; base sits flush against the corresponding bubble edge.
  const pointerPath = buildPointer(direction, halfW, halfH, pointerWidth, pointerLength)

  // Text top-left, centered in the bubble (relative to center). The engine's
  // line box is ~fontSize * 1.2 tall, so center on that to sit on the optical
  // baseline band.
  const textX = -estTextWidth / 2
  const textY = -(fontSize * 1.2) / 2

  return (
    // Outer Group: place the bubble center at (centerX, centerY).
    <Group x={centerX} y={centerY}>
      {/* Scaling group: origin at bubble center, so entryScale grows about center. */}
      <Group scaleX={grow.scaleX} scaleY={grow.scaleY} opacity={fade.opacity}>
        {/* Pointer triangle — fades/rises in slightly after the bubble. */}
        <Group opacity={pointerMotion.opacity} x={pointerMotion.x} y={pointerMotion.y}>
          <Path d={pointerPath} fill={bgColor} />
          {borderWidth > 0 ? (
            <Path d={pointerPath} stroke={borderColor} strokeWidth={borderWidth} />
          ) : null}
        </Group>

        {/* Bubble body. */}
        <Rect
          x={-halfW}
          y={-halfH}
          width={bubbleW}
          height={bubbleH}
          cornerRadius={cornerRadius}
          fill={bgColor}
          stroke={borderWidth > 0 ? borderColor : undefined}
          strokeWidth={borderWidth}
        />

        {/* Label. */}
        <Text
          x={textX}
          y={textY}
          fontSize={fontSize}
          color={color}
          fontFamily={fontFamily}
          fontWeight={fontWeight}
        >
          {label}
        </Text>
      </Group>
    </Group>
  )
}

/** SVG path for the pointer triangle, in bubble-center-relative space. The base
 *  sits flush along the chosen edge; the apex pokes out by `length`. */
function buildPointer(
  direction: CalloutDirection,
  halfW: number,
  halfH: number,
  base: number,
  length: number,
): string {
  const h = base / 2
  switch (direction) {
    case 'top':
      // Apex above the top edge.
      return `M ${-h} ${-halfH} L ${h} ${-halfH} L 0 ${-halfH - length} Z`
    case 'left':
      // Apex left of the left edge.
      return `M ${-halfW} ${-h} L ${-halfW} ${h} L ${-halfW - length} 0 Z`
    case 'right':
      // Apex right of the right edge.
      return `M ${halfW} ${-h} L ${halfW} ${h} L ${halfW + length} 0 Z`
    default:
      // 'bottom' — apex below the bottom edge.
      return `M ${-h} ${halfH} L ${h} ${halfH} L 0 ${halfH + length} Z`
  }
}
