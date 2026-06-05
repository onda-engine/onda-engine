//! BoundingBox — a deliberate annotation that reveals around a region: four
//! corner ticks draw on in a staggered wave, a calm outline settles between
//! them, and a label tag pins to the top-left corner. The accent is earned
//! here. Ported from ondajs, then redesigned to read as an intentional
//! call-out (not a debug overlay).
//!
//! Choreography — corner-by-corner, one beat per element:
//!   1. The four corner ticks draw on as L-marks, staggered clockwise from the
//!      top-left via `staggerFrames(i)`, each "drawn" by an animated stroke-dash
//!      on the house ease + a short fade. The eye is led around the box.
//!   2. The outline `<Rect>` draws on underneath as a quiet base, its
//!      stroke-dash retreating over `drawDuration` so the perimeter fills in
//!      behind the ticks rather than snapping in.
//!   3. Once the box has landed, the corner ticks settle into a soft, slow pulse
//!      (a low-amplitude opacity breathe that decelerates into rest — restraint,
//!      not a strobe), and the label tag fades + scales in.
//!
//! Depth: the corner ticks and label tag carry a soft, large-radius accent glow
//! (the engine's `shadow` with a 0,0 offset reads as a centered halo) — the
//! call-out has presence without a hard edge. The big outline `<Rect>` is
//! stroke-only with NO glow: the engine's `shadow` is an analytic blurred
//! rounded-rect of the shape's box, so a glow on the large outline would wash
//! its whole interior; the crisp accent stroke carries it instead.
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
import { HOUSE_EASE } from '../easing.js'
import { DURATION, SPRING_SMOOTH, staggerFrames } from '../motion.js'
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
  /** Frames to reveal the full outline (default `DURATION.slow` = 28). */
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

  // A soft, centered accent glow tinted toward the bg — the call-out has
  // presence without a hard black edge. `(0,0)` offset reads as a halo.
  const glow = { color, blur: Math.max(8, strokeWidth * 4), offsetX: 0, offsetY: 0 }

  // The outline draws on underneath the ticks as a quiet base. A smooth eased
  // ramp (not a spring) gives the pen an even pace across the whole perimeter
  // rather than snapping most edges in the first few frames.
  const drawDur = Math.max(1, drawDuration)
  const drawProgress = interpolate(frame, [delay, delay + drawDur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: HOUSE_EASE,
  })
  // Real draw-on via animated stroke-dash: one dash as long as the whole
  // perimeter, its offset retreating to 0 as `drawProgress` → 1, so the outline
  // is "drawn" clockwise from the top-left like a pen. Renders on both backends.
  const perim = 2 * (bw + bh)
  const dashOffset = perim * (1 - drawProgress)

  // Corner ticks — the lead element. Length scales with the box but stays inside
  // it; the tick is an L-mark drawn from its inner elbow out along both edges.
  // Each tick draws on (stroke-dash) staggered clockwise from the top-left.
  const tickLen = Math.min(28, bw * 0.25, bh * 0.25)
  const tickDash = tickLen * 2

  // The four corners, clockwise from top-left: elbow point + the two L arms as
  // an SVG path (`M arm1 → L elbow → L arm2`). Drawn in local box space.
  const corners = [
    { d: `M0 ${tickLen} L0 0 L${tickLen} 0` }, // top-left
    { d: `M${bw - tickLen} 0 L${bw} 0 L${bw} ${tickLen}` }, // top-right
    { d: `M${bw} ${bh - tickLen} L${bw} ${bh} L${bw - tickLen} ${bh}` }, // bottom-right
    { d: `M${tickLen} ${bh} L0 ${bh} L0 ${bh - tickLen}` }, // bottom-left
  ]

  // Once the box has essentially landed, the ticks settle into a soft, slow
  // pulse: a low-amplitude opacity breathe on a sine. Restraint — a 6% swing,
  // never a strobe.
  const settleFrom = delay + drawDur + DURATION.base
  const pulse = interpolate(
    Math.sin(((frame - settleFrom) / (fps * 1.6)) * Math.PI * 2),
    [-1, 1],
    [0.94, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
  const pulseOpacity = frame > settleFrom ? pulse : 1

  // The label tag comes in last, once the outline has landed.
  const phaseTwoDelay = delay + drawDur
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
      {/* The outline base, drawn on by an animated stroke-dash around the
          perimeter (clockwise from the top-left). It settles quietly behind the
          corner ticks; `cornerRadius` rounds the corners. */}
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
          opacity={0.7}
        />
      ) : null}
      {/* Corner ticks — draw on in a staggered clockwise wave, then breathe in a
          soft pulse. The earned accent reads strongest here, on the corners. */}
      {corners.map((corner, i) => {
        const tickDelay = delay + staggerFrames(i)
        const tickDraw = spring({
          frame: frame - tickDelay,
          fps,
          config: SPRING_SMOOTH,
          durationInFrames: DURATION.base,
        })
        if (tickDraw <= 0.001) return null
        return (
          <Path
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed 4-corner list, order is stable
            key={i}
            d={corner.d}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeCap="round"
            strokeJoin="round"
            strokeDash={[tickDash, tickDash]}
            strokeDashOffset={tickDash * (1 - tickDraw)}
            opacity={tickDraw * pulseOpacity}
            shadow={glow}
          />
        )
      })}
      {/* Label tag pinned above the top-left corner. Fades + scales in once the
          outline lands. Scale pivots on the tag's bottom-left (its local origin
          sits there) so it grows up-and-out from the corner, matching ondajs's
          `transform-origin: bottom left`. */}
      {showTag ? (
        <Group y={-(tagHeight + tagGap)} opacity={tagFade.opacity}>
          <Group scaleX={tagScale.scaleX} scaleY={tagScale.scaleY}>
            <Rect
              width={tagWidth}
              height={tagHeight}
              cornerRadius={tagRadius}
              fill={color}
              shadow={glow}
            />
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
