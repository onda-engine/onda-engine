//! PieReveal — a pie/donut chart whose slices grow from 0. Each slice is a
//! `<Path>` arc whose end angle sweeps from its start to its full extent on the
//! house spring, staggered slice-to-slice. A donut hole is a center `<Ellipse>`
//! filled with the background color. Ported from ondajs (`pie-reveal`).
//!
//! ondajs renders a single-arc ring by animating an SVG `stroke-dashoffset`. The
//! engine has no stroke-dash draw-on, so this port expresses the reveal as the
//! closest faithful primitive: a filled wedge `<Path>` per slice
//! ("M cx cy L x0 y0 A r r 0 largeArc 1 x1 y1 Z") whose terminal angle animates.
//! Arcs start at 12 o'clock and sweep clockwise; in the engine's y-down space a
//! clockwise sweep is the SVG `sweep-flag=1`. The full 360° edge case (a single
//! 100% slice) can't be one arc, so it is drawn as two half-sweeps.
//!
//! Layout: the chart has a FIXED footprint and the wedge geometry changes every
//! frame, so nothing is laid out by `<Flex>` (which would reflow/jiggle). The
//! disc is centered by computing its center from the composition size and all
//! parts are placed with explicit x/y inside one `<Group>`.
//!
//! Backend caveat: `<Path>` (and gradients) render only on the Vello/GPU backend;
//! the CPU reference rasterizer skips paths, so the wedges are a GPU-only effect.
//! The donut hole `<Ellipse>` and center label do render on both backends.

import {
  Ellipse,
  Group,
  Path,
  Text,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda-engine/react'
import { DURATION, SPRING_SMOOTH, STAGGER, staggerFrames } from '../motion.js'
import { useTextMetrics } from '../text-metrics.js'
import type { TextStyleProps } from '../text-style.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

/** One pie slice: a numeric weight and its color. */
export interface PieRevealSlice {
  /** Relative weight of the slice. The full circle is split proportionally. */
  value: number
  /** Slice fill color (hex `#rrggbb` / `#rrggbbaa`). */
  color: string
  /** Optional label, drawn just outside the ring at the slice's mid-angle when
   *  {@link PieRevealProps.showLabel} is set. Also used for React keying. */
  label?: string
}

export interface PieRevealProps extends TextStyleProps {
  /** Slices to render, drawn clockwise from 12 o'clock in array order. */
  data?: PieRevealSlice[]
  /** Outer radius of the pie, in px. */
  radius?: number
  /** Inner radius (donut hole) in px. `0` is a solid pie. The hole is filled
   *  with {@link holeColor}, so set that to match the background. */
  innerRadius?: number
  /** Color filling the donut hole — match the composition background (default: theme `background`). */
  holeColor?: string
  /** Frames before the **first** slice starts sweeping. */
  delay?: TimeInput
  /** Per-slice sweep duration on the house spring. */
  duration?: TimeInput
  /** Frames between consecutive slices starting (default canonical `STAGGER`). */
  stagger?: TimeInput
  /** Horizontal center as a 0–1 fraction of canvas width. */
  x?: number
  /** Vertical center as a 0–1 fraction of canvas height. */
  y?: number
  /** Show labels: the center total (donut only) plus each slice's `label`
   *  drawn just outside the ring. */
  showLabel?: boolean
  /** Center label text. Defaults to the slice count. */
  label?: string
  /** Center label color (default: theme `text`). */
  labelColor?: string
  /** Center label font size in px. */
  fontSize?: number
}

const DEFAULT_DATA: PieRevealSlice[] = [
  { value: 64, color: '#d96b82', label: 'A' },
  { value: 22, color: '#8e8e98', label: 'B' },
  { value: 14, color: '#3a3a44', label: 'C' },
]

/** Build a filled-wedge SVG path from `cx,cy` sweeping clockwise between two
 *  angles (radians, measured clockwise from 12 o'clock). Returns `''` for a
 *  zero/negative sweep so the caller can skip rendering it. */
function wedgePath(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle
  if (sweep <= 0) return ''

  // 12 o'clock = angle 0. x = cx + r*sin(a), y = cy - r*cos(a): increasing the
  // angle rotates the point clockwise on screen (y-down), so SVG sweep-flag=1.
  const point = (a: number): [number, number] => [cx + r * Math.sin(a), cy - r * Math.cos(a)]

  // A single arc can't span a full circle (start would equal end). For a near-
  // full sweep, split into two arcs through an intermediate angle.
  if (sweep >= Math.PI * 2 - 1e-4) {
    const mid = startAngle + Math.PI
    const [x0, y0] = point(startAngle)
    const [xm, ym] = point(mid)
    return (
      `M ${cx} ${cy} L ${x0} ${y0} ` +
      `A ${r} ${r} 0 0 1 ${xm} ${ym} ` +
      `A ${r} ${r} 0 0 1 ${x0} ${y0} Z`
    )
  }

  const [x0, y0] = point(startAngle)
  const [x1, y1] = point(endAngle)
  const largeArc = sweep > Math.PI ? 1 : 0
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1} Z`
}

export function PieReveal({
  data = DEFAULT_DATA,
  radius = 180,
  innerRadius = 0,
  holeColor: holeColorProp,
  delay: delayIn = 0,
  duration: durationIn = DURATION.slow,
  stagger: staggerIn = STAGGER,
  x = 0.5,
  y = 0.5,
  showLabel = false,
  label,
  labelColor: labelColorProp,
  fontSize = 56,
  fontFamily: fontFamilyProp,
}: PieRevealProps) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const duration = framesOf(durationIn, fps)
  const stagger = framesOf(staggerIn, fps)
  const theme = useTheme()
  const holeColor = holeColorProp ?? theme.background
  const labelColor = labelColorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.headingFamily ?? theme.fontFamily

  // Center the fixed-size disc by mapping the 0–1 fractions onto the canvas.
  const cx = x * width
  const cy = y * height

  // Total weight; guard against an empty/zero array so angles stay finite.
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0)

  // Precompute each slice's [startAngle, fullEndAngle] (radians, clockwise from
  // 12 o'clock) so the per-frame work is just the spring + path string.
  let cursor = 0
  const slices = data.map((d) => {
    const frac = total > 0 ? Math.max(0, d.value) / total : 0
    const startAngle = cursor
    const fullSweep = frac * Math.PI * 2
    cursor += fullSweep
    return {
      ...d,
      startAngle,
      fullEndAngle: startAngle + fullSweep,
      midAngle: startAngle + fullSweep / 2,
    }
  })

  // Clamp the donut hole to the disc; only draw it when it has area.
  const holeRadius = Math.max(0, Math.min(innerRadius, radius - 1))

  const centerText = label ?? `${data.length}`

  // Real shaped width of the center label, used to center it on the disc (the
  // engine draws from the text origin and has no centering). Falls back to a
  // glyph-count estimate until the wasm engine warms in the browser.
  const centerMetrics = useTextMetrics(centerText, fontSize, { fontFamily })

  // Per-slice labels sit just outside the ring, sized relative to the center
  // label. The engine has no text metrics, so width ≈ len * fontSize * 0.6.
  const sliceFontSize = Math.max(12, Math.round(fontSize * 0.32))
  const labelRadius = radius + sliceFontSize * 0.9

  return (
    <Group>
      {slices.map((s, i) => {
        const sliceDelay = delay + staggerFrames(i, stagger)
        const local = Math.max(0, frame - sliceDelay)

        // House spring (SPRING_SMOOTH, no overshoot) drives the sweep 0 → full.
        const progress = spring({
          frame: local,
          fps,
          config: SPRING_SMOOTH,
          durationInFrames: duration,
        })
        const clamped = Math.max(0, Math.min(1, progress))

        const endAngle = interpolate(clamped, [0, 1], [s.startAngle, s.fullEndAngle], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })

        const d = wedgePath(cx, cy, radius, s.startAngle, endAngle)
        if (!d) return null

        return <Path key={`${i}-${s.label ?? ''}`} d={d} fill={s.color} />
      })}

      {/* Donut hole — punched after the wedges, filled with the background. */}
      {holeRadius > 0 ? (
        <Ellipse
          x={cx - holeRadius}
          y={cy - holeRadius}
          width={holeRadius * 2}
          height={holeRadius * 2}
          fill={holeColor}
        />
      ) : null}

      {/* Center label (donut). Single-line; the engine draws from the text
          origin and has no centering, so offset by half the measured width. */}
      {showLabel && holeRadius > 0 ? (
        <Text
          x={cx - centerMetrics.width / 2}
          y={cy - fontSize / 2}
          fontSize={fontSize}
          color={labelColor}
          fontFamily={fontFamily}
          fontWeight={600}
        >
          {centerText}
        </Text>
      ) : null}

      {/* Per-slice labels, just outside the ring at each slice's mid-angle.
          Mid-angle is measured clockwise from 12 o'clock (same convention as
          the wedges): x = cx + r*sin(mid), y = cy - r*cos(mid). Each fades in
          with its slice's sweep. Centered by half the estimated text extent. */}
      {showLabel
        ? slices.map((s, i) => {
            if (!s.label) return null

            const sliceDelay = delay + staggerFrames(i, stagger)
            const local = Math.max(0, frame - sliceDelay)
            const progress = spring({
              frame: local,
              fps,
              config: SPRING_SMOOTH,
              durationInFrames: duration,
            })
            if (progress <= 0.01) return null

            const lx = cx + labelRadius * Math.sin(s.midAngle)
            const ly = cy - labelRadius * Math.cos(s.midAngle)
            return (
              <Text
                key={`label-${i}-${s.label}`}
                x={lx - s.label.length * sliceFontSize * 0.3}
                y={ly - sliceFontSize / 2}
                fontSize={sliceFontSize}
                color={labelColor}
                fontFamily={fontFamily}
                fontWeight={600}
              >
                {s.label}
              </Text>
            )
          })
        : null}
    </Group>
  )
}
