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
//! - The bubble width is sized to the MEASURED text extent (`useTextMetrics`,
//!   proportional/exact; falls back to a glyph-count estimate until the wasm
//!   engine warms) plus horizontal padding. Pass `width` to override when the
//!   exact text extent is known.
//! - Scene scale pivots on a node's LOCAL ORIGIN (0,0), not its center. To make
//!   the bubble grow about its own center, the scaling `<Group>` is placed at the
//!   bubble center and the body/label/pointer are drawn relative to that center.
//! - The component anchors itself via the `x`/`y` props (canvas fractions), so it
//!   is NOT a layout child — drop it directly in a scene; do not place it inside a
//!   `<Flex>`/`<AbsoluteFill>` and also rely on its own x/y.

import { Group, Path, Rect, Text, useCurrentFrame, useVideoConfig } from '@onda/react'
import { entryFade, entryFadeRise, entryScale } from '../choreography.js'
import { DURATION } from '../motion.js'
import { type Placement, usePlacement } from '../placement.js'
import { useTextMetrics } from '../text-metrics.js'
import { type TextStyleProps, applyTextCase } from '../text-style.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

/** Default bubble surface. The theme `surface` (~`#121217`) sits barely above
 *  the canvas (`#0a0d17`), so a speech bubble drawn with it vanishes. A callout
 *  is an annotation that must POP off the canvas, so its default fill is an
 *  elevated, lighter surface (a translucent white wash, `#rrggbbaa`, that lifts
 *  whatever the background is). An explicit `bgColor` prop still wins. */
const ELEVATED_SURFACE = '#ffffff1a' // white @ ~10%

/** Default bubble border — a brighter hairline than the theme `border`
 *  (~`#26262c`) so the bubble + pointer read a clear edge on the dark canvas. */
const ELEVATED_BORDER = '#ffffff47' // white @ ~28%

/** How far the pointer's base overlaps INTO the bubble body (px). The bubble is
 *  drawn on top of this overlap, so the tail and body share one continuous fill
 *  with no seam at the edge. A couple of px absorbs sub-pixel/anti-alias gaps. */
const POINTER_OVERLAP = 2

/** Which side of the bubble the pointer triangle sticks out from (and thus the
 *  rough direction the callout is aimed). */
export type CalloutDirection = 'top' | 'bottom' | 'left' | 'right'

export interface CalloutProps extends TextStyleProps {
  /** Bubble label. Single line — no auto-wrap. */
  label?: string
  /** Where the bubble sits: a region keyword (`'center'`, `'lower-third'`, …)
   *  or normalized `{x,y}` (0–1, bubble center). The shared placement contract;
   *  default `'center'`. */
  placement?: Placement
  /** @deprecated Legacy alias for `placement={{ x }}` — bubble-center X as a
   *  0..1 fraction of canvas width. */
  x?: number
  /** @deprecated Legacy alias for `placement={{ y }}` — bubble-center Y as a
   *  0..1 fraction of canvas height. */
  y?: number
  /** Side the pointer triangle sticks out from (default `'bottom'`). */
  direction?: CalloutDirection
  /** Frames before the bubble starts revealing. */
  delay?: TimeInput
  /** Bubble scale-and-fade reveal duration in frames (default `DURATION.base`). */
  duration?: TimeInput
  /** Frames after the bubble starts before the pointer eases in (default 6). */
  lineDelay?: TimeInput
  /** Pointer reveal duration in frames (default `DURATION.base`). */
  lineDuration?: TimeInput
  /** Bubble background fill (default: an elevated translucent-white surface that
   *  lifts the bubble off the dark canvas). */
  bgColor?: string
  /** Bubble border color (default: a bright translucent-white hairline). */
  borderColor?: string
  /** Bubble border width in px (default 1). */
  borderWidth?: number
  /** Label font size in px (default 20). */
  fontSize?: number
  /** Horizontal padding inside the bubble (default 14). */
  paddingX?: number
  /** Vertical padding inside the bubble (default 8). */
  paddingY?: number
  /** Bubble corner radius (default: theme `radius`). */
  cornerRadius?: number
  /** Pointer triangle base width in px (default 18). */
  pointerWidth?: number
  /** Pointer triangle length (how far it pokes out) in px (default 12). */
  pointerLength?: number
  /** Explicit bubble width in px. Overrides the measured text extent. */
  width?: number
}

export function Callout({
  label = 'Look here',
  placement,
  x,
  y,
  direction = 'bottom',
  delay: delayIn = 0,
  duration: durationIn = DURATION.base,
  lineDelay: lineDelayIn = 6,
  lineDuration: lineDurationIn = DURATION.base,
  color: colorProp,
  bgColor: bgColorProp,
  borderColor: borderColorProp,
  borderWidth = 1,
  fontSize = 20,
  fontFamily: fontFamilyProp,
  fontWeight = 500,
  letterSpacing,
  uppercase,
  paddingX = 14,
  paddingY = 8,
  cornerRadius: cornerRadiusProp,
  pointerWidth = 18,
  pointerLength = 12,
  width,
}: CalloutProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const duration = framesOf(durationIn, fps)
  const lineDelay = framesOf(lineDelayIn, fps)
  const lineDuration = framesOf(lineDurationIn, fps)
  const theme = useTheme()
  const color = colorProp ?? theme.text
  // Default to an elevated surface/border (not the near-black theme tokens) so
  // the bubble + pointer separate from the dark canvas; explicit props win.
  const bgColor = bgColorProp ?? ELEVATED_SURFACE
  const borderColor = borderColorProp ?? ELEVATED_BORDER
  const fontFamily = fontFamilyProp ?? theme.fontFamily
  const cornerRadius = cornerRadiusProp ?? theme.radius
  const labelText = applyTextCase(label, { uppercase })

  // Real shaped label width (overridable via `width`). The engine measures it
  // (proportional — exact); falls back to a glyph-count estimate until the wasm
  // engine warms in the browser, or if `width` is passed.
  const measured = useTextMetrics(labelText, fontSize, { fontFamily, fontWeight })

  // Bubble box, sized to the measured text extent unless `width` is given.
  const textWidth = measured.width
  const bubbleW = width ?? Math.round(textWidth + paddingX * 2)
  // Engine line box height ≈ fontSize * 1.2; add vertical padding.
  const bubbleH = Math.round(fontSize * 1.2 + paddingY * 2)

  // Bubble center via the shared placement contract. Legacy fractional `x`/`y`
  // were already bubble-center anchored (ondajs semantics), so they alias 1:1;
  // the default is centered, exactly as before.
  const resolved = usePlacement(placement ?? { x: x ?? 0.5, y: y ?? 0.5 }, {
    width: bubbleW,
    height: bubbleH,
  })
  const centerX = resolved.x
  const centerY = resolved.y

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

  // Half-extents — everything is drawn relative to the bubble CENTER so the
  // scale (which pivots on the scaling group's local origin) grows about center.
  const halfW = bubbleW / 2
  const halfH = bubbleH / 2

  // Pointer triangle in bubble-center-relative coordinates. Apex points outward
  // along `direction`; the base OVERLAPS into the bubble body (by `POINTER_OVERLAP`)
  // so the bubble — drawn on top — covers the base seam and the tail fuses with
  // the body into one continuous surface. `fill` is the closed (overlapping)
  // triangle drawn UNDER the bubble; `outline` is just the two outer edges
  // (apex → each base corner, no base line), drawn OVER the bubble so the border
  // wraps the tail and meets the bubble's edge stroke flush.
  const pointer = buildPointer(direction, halfW, halfH, pointerWidth, pointerLength)

  // Text top-left, centered in the bubble (relative to center). The engine's
  // line box is ~fontSize * 1.2 tall, so center on that to sit on the optical
  // baseline band.
  const textX = -textWidth / 2
  const textY = -(fontSize * 1.2) / 2

  return (
    // Outer Group: place the bubble center at (centerX, centerY).
    <Group x={centerX} y={centerY}>
      {/* Scaling group: origin at bubble center, so entryScale grows about center. */}
      <Group scaleX={grow.scaleX} scaleY={grow.scaleY} opacity={fade.opacity}>
        {/* Tail fill — fades/rises in slightly after the bubble (one-thing-at-a-
            time pacing). Drawn FIRST, with its base overlapping up into the body,
            so the bubble (next) paints over the base and no seam shows. Same fill
            as the body, so the tail reads as the same lifted surface. */}
        <Group opacity={pointerMotion.opacity} x={pointerMotion.x} y={pointerMotion.y}>
          <Path d={pointer.fill} fill={bgColor} />
        </Group>

        {/* Bubble body, drawn over the tail base to hide the overlap seam. */}
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

        {/* Tail outer edges (apex → each base corner, no base line), drawn OVER
            the bubble — and on the same pointer motion as the fill — so the border
            wraps the tail and joins the bubble's bottom-edge stroke flush. */}
        {borderWidth > 0 ? (
          <Group opacity={pointerMotion.opacity} x={pointerMotion.x} y={pointerMotion.y}>
            <Path d={pointer.outline} stroke={borderColor} strokeWidth={borderWidth} />
          </Group>
        ) : null}

        {/* Label. */}
        <Text
          x={textX}
          y={textY}
          fontSize={fontSize}
          color={color}
          fontFamily={fontFamily}
          fontWeight={fontWeight}
          letterSpacing={letterSpacing}
        >
          {labelText}
        </Text>
      </Group>
    </Group>
  )
}

/** Pointer-triangle geometry in bubble-center-relative space, as two SVG paths:
 *  - `fill`: a CLOSED triangle whose base sits `POINTER_OVERLAP` px INSIDE the
 *    bubble edge, so the bubble (painted on top) covers the base and the tail
 *    fuses with the body into one seamless surface.
 *  - `outline`: an OPEN path of just the two outer edges (base corner → apex →
 *    base corner, no base line), with the corners ON the bubble edge so the tail
 *    border meets the bubble's edge stroke flush — no chevron, no seam.
 *  The apex pokes out by `length` along `direction`. */
function buildPointer(
  direction: CalloutDirection,
  halfW: number,
  halfH: number,
  base: number,
  length: number,
): { fill: string; outline: string } {
  const h = base / 2
  const o = POINTER_OVERLAP
  switch (direction) {
    case 'top':
      // Apex above the top edge; base overlaps down into the body.
      return {
        fill: `M ${-h} ${-halfH + o} L ${h} ${-halfH + o} L 0 ${-halfH - length} Z`,
        outline: `M ${-h} ${-halfH} L 0 ${-halfH - length} L ${h} ${-halfH}`,
      }
    case 'left':
      // Apex left of the left edge; base overlaps right into the body.
      return {
        fill: `M ${-halfW + o} ${-h} L ${-halfW + o} ${h} L ${-halfW - length} 0 Z`,
        outline: `M ${-halfW} ${-h} L ${-halfW - length} 0 L ${-halfW} ${h}`,
      }
    case 'right':
      // Apex right of the right edge; base overlaps left into the body.
      return {
        fill: `M ${halfW - o} ${-h} L ${halfW - o} ${h} L ${halfW + length} 0 Z`,
        outline: `M ${halfW} ${-h} L ${halfW + length} 0 L ${halfW} ${h}`,
      }
    default:
      // 'bottom' — apex below the bottom edge; base overlaps up into the body.
      return {
        fill: `M ${-h} ${halfH - o} L ${h} ${halfH - o} L 0 ${halfH + length} Z`,
        outline: `M ${-h} ${halfH} L 0 ${halfH + length} L ${h} ${halfH}`,
      }
  }
}
