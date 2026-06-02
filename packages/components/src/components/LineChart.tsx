//! LineChart — a polyline that draws on left-to-right on the house easing, with
//! an optional soft area fill under it and per-point dots that pop as the line
//! reaches them. Ported from ondajs (`line-chart`).
//!
//! Draw-on approximation: the engine has no stroke-dash animation, so the FULL
//! polyline `<Path>` is built once and revealed by a growing clip rect —
//! `clip={clipRect(chartWidth * progress, chartHeight)}` on a `<Group>` whose
//! origin sits at the chart's top-left. The clip window opens left→right, so the
//! line appears to draw on. This is geometrically a left-edge wipe, not a true
//! pen stroke (a near-vertical segment reveals along a vertical seam rather than
//! following the path's arc-length), but at chart proportions reads as a draw-on.
//! The engine `<Path>` also has no linecap/linejoin controls, so ondajs's round
//! caps/joins become the renderer default (miter) joins — a minor fidelity gap.
//!
//! The area fill fades in by opacity over the same progress (matching ondajs),
//! rather than being clipped — so it can read slightly ahead of the line tip on
//! the way in; this mirrors the original.
//!
//! Layout: the chart has FIXED dimensions and is centered by computing its
//! top-left offset from the composition size inside a single static `<Group>` —
//! NOT a `<Flex>`/`<AbsoluteFill>`. The clip window and dot opacities animate
//! every frame; a layout container would be asked to re-measure an animated
//! subtree, so we position absolutely instead (same rationale as `BarChart`).
//!
//! Backend caveats:
//! - `<Path>` (line + area) renders only on the Vello/GPU backend; the CPU
//!   reference rasterizer skips paths, so the line/area are GPU-only. Dots are
//!   `<Ellipse>` and render on both.
//! - The area gradient renders only on Vello; the CPU backend collapses it to
//!   the first stop, so the first stop is the meaningful (faint accent) color.

import {
  Ellipse,
  Group,
  Path,
  clipRect,
  interpolate,
  linearGradient,
  useVideoConfig,
} from '@onda/react'
import { useSceneProgress } from '../hooks.js'

export interface LineChartProps {
  /** The series values, left to right. */
  data?: number[]
  /** Frames before the line starts drawing. */
  delay?: number
  /** Frames for the line to fully draw on. */
  duration?: number
  /** Line + dot color — the earned accent. */
  color?: string
  /** Stroke width in px. */
  strokeWidth?: number
  /** Chart width in px. */
  width?: number
  /** Chart height in px. */
  height?: number
  /** Fill a soft gradient area under the line. */
  fill?: boolean
  /** Show a dot at each data point as the line reaches it. */
  showDots?: boolean
}

const DEFAULT_DATA = [12, 18, 15, 24, 22, 31, 28, 38]

/** Append/replace a 2-hex alpha channel on a `#rrggbb`/`#rrggbbaa` color so the
 *  area gradient fades from a faint tint to fully transparent. Falls back to the
 *  input unchanged for unknown formats. */
function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255)))
  const hh = a.toString(16).padStart(2, '0')
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    if (hex.length === 6 || hex.length === 8) {
      return `#${hex.slice(0, 6)}${hh}`
    }
    if (hex.length === 3) {
      const r = hex[0] ?? '0'
      const g = hex[1] ?? '0'
      const b = hex[2] ?? '0'
      return `#${r}${r}${g}${g}${b}${b}${hh}`
    }
  }
  return color
}

export function LineChart({
  data = DEFAULT_DATA,
  delay = 0,
  duration = 40,
  color = '#d96b82',
  strokeWidth = 4,
  width = 900,
  height = 440,
  fill = true,
  showDots = true,
}: LineChartProps) {
  const { width: compWidth, height: compHeight } = useVideoConfig()

  // House easing (non-physical reveal), matching ondajs `useSceneProgress`.
  const progress = useSceneProgress({ delay, durationInFrames: duration, eased: true })

  const n = data.length
  const padX = 24
  const padTop = 24
  const padBottom = 32
  const innerW = width - padX * 2
  const innerH = height - padTop - padBottom

  // Defensive min/max: an empty series would make spread Math.min/max return
  // ±Infinity, so seed the reduce and guard the degenerate (flat) range below.
  const min = data.reduce((m, v) => (v < m ? v : m), Number.POSITIVE_INFINITY)
  const max = data.reduce((m, v) => (v > m ? v : m), Number.NEGATIVE_INFINITY)

  const xAt = (i: number) => padX + (n <= 1 ? 0 : (i / (n - 1)) * innerW)
  const yAt = (v: number) =>
    padTop + (max === min ? innerH / 2 : (1 - (v - min) / (max - min)) * innerH)

  const pts = data.map((v, i) => [xAt(i), yAt(v)] as const)
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]} ${p[1]}`).join(' ')

  const baseline = padTop + innerH
  const firstX = xAt(0)
  const lastX = xAt(n - 1)
  const areaPath = `${linePath} L${lastX} ${baseline} L${firstX} ${baseline} Z`

  // Center the fixed-size chart by computing its top-left offset directly — no
  // layout container, so the per-frame clip/opacity animation never reflows.
  const originX = Math.round((compWidth - width) / 2)
  const originY = Math.round((compHeight - height) / 2)

  // The clip window width grows 0 → full chart width as the line draws on.
  const revealWidth = Math.max(0, width * progress)

  // Area fade-in, matching ondajs (opacity over progress).
  const areaOpacity = interpolate(progress, [0, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  // Soft vertical fill: faint accent at the top, fading to transparent at the
  // baseline. First stop is the meaningful color for the CPU fallback.
  const areaGradient = linearGradient(
    [0, padTop],
    [0, baseline],
    [
      { offset: 0, color: withAlpha(color, 0.28) },
      { offset: 1, color: withAlpha(color, 0) },
    ],
  )

  const dotRadius = strokeWidth + 2

  return (
    <Group x={originX} y={originY}>
      {/* Area fill — opacity-faded (no clip), matching ondajs. Path is GPU-only;
          its gradient collapses to the faint accent on the CPU backend. */}
      {fill && n >= 2 && areaOpacity > 0 ? (
        <Group opacity={areaOpacity}>
          <Path d={areaPath} gradient={areaGradient} />
        </Group>
      ) : null}

      {/* Line — full polyline, revealed left→right by the growing clip window.
          The clip is in this Group's local space (origin at the chart's
          top-left), so it opens from x=0 rightward. */}
      {n >= 2 && revealWidth > 0 ? (
        <Group clip={clipRect(revealWidth, height)}>
          <Path d={linePath} stroke={color} strokeWidth={strokeWidth} />
        </Group>
      ) : null}

      {/* Dots — each pops (opacity 0→1) as the draw progress crosses its point's
          normalized position along the series. Ellipse renders on both backends. */}
      {showDots
        ? pts.map((p, i) => {
            const threshold = n <= 1 ? 0 : i / (n - 1)
            const dotOpacity = interpolate(progress, [threshold - 0.02, threshold + 0.02], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })
            const cx = p[0]
            const cy = p[1]
            return dotOpacity > 0 ? (
              <Ellipse
                key={i}
                x={cx - dotRadius}
                y={cy - dotRadius}
                width={dotRadius * 2}
                height={dotRadius * 2}
                fill={color}
                opacity={dotOpacity}
              />
            ) : null
          })
        : null}
    </Group>
  )
}
