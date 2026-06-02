//! BarChart — horizontal bars that grow from 0 to their value on the house
//! spring, staggered. The largest bar earns the accent color; every other bar
//! sits in the dim bar color. Ported from ondajs (`bar-chart`).
//!
//! The chart has FIXED dimensions. Each bar row is positioned by an EXPLICIT
//! `y` (`rowHeight * i`) inside a single `<Group>` — NOT a `<Flex>` — because a
//! bar's fill width animates every frame, and a layout container would reflow
//! (jiggle) as the measured bbox grew. For the same reason the whole chart is
//! centered by computing its top-left offset from the composition size rather
//! than letting an `<AbsoluteFill>` measure (and chase) the animated subtree.
//!
//! Scene caveat: `<Rect>` paints from its local origin, so the fill grows
//! left-to-right naturally (origin at the track's left edge).

import {
  Group,
  Rect,
  Text,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import { DURATION, SPRING_SMOOTH, STAGGER, staggerFrames } from '../motion.js'

/** One bar: a label and its numeric value. */
export interface BarChartDatum {
  label: string
  value: number
}

export interface BarChartProps {
  /** Bars to render. Order is preserved — top to bottom. */
  data?: BarChartDatum[]
  /** Value mapped to a full-width bar. Bars cap at 100% of the track. */
  max?: number
  /** Frames before the **first** bar starts. */
  delay?: number
  /** Per-bar grow duration. Bars want more time than text (default `slow`). */
  duration?: number
  /** Frames between consecutive bars (default canonical `STAGGER` = 4). */
  stagger?: number
  /** Bar (and track) height in px. */
  barHeight?: number
  /** Pixel gap between rows. */
  gap?: number
  /** Pixels reserved for the label column (left of the track). */
  labelWidth?: number
  /** Gap between the label column and the track, in px. */
  labelGap?: number
  /** Track length in px — the full-width target for a bar at `max`. */
  trackWidth?: number
  /** Color of the **largest** bar — the earned accent (Onda rose). */
  accentColor?: string
  /** Color of non-largest bars. */
  barColor?: string
  /** Bar track (background) color. */
  trackColor?: string
  /** Label color. */
  color?: string
  /** Show the numeric value at the end of each bar. */
  showValues?: boolean
  /** Label / value font size in px. */
  fontSize?: number
  /** Loaded font family for labels and values. */
  fontFamily?: string
}

const DEFAULT_DATA: BarChartDatum[] = [
  { label: 'Remotion', value: 92 },
  { label: 'After Effects', value: 64 },
  { label: 'Lottie', value: 38 },
]

export function BarChart({
  data = DEFAULT_DATA,
  max = 100,
  delay = 0,
  duration = DURATION.slow,
  stagger = STAGGER,
  barHeight = 32,
  gap = 16,
  labelWidth = 220,
  labelGap = 24,
  trackWidth = 760,
  accentColor = '#d96b82',
  barColor = '#8e8e98',
  trackColor = '#1c1c22',
  color = '#f2f2f4',
  showValues = false,
  fontSize = 24,
  fontFamily,
}: BarChartProps) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()

  const rowHeight = barHeight + gap
  // Total chart footprint (no trailing gap below the last row).
  const chartWidth = labelWidth + labelGap + trackWidth
  const chartHeight = data.length > 0 ? rowHeight * data.length - gap : 0

  // Center the fixed-size chart by computing its top-left offset directly — no
  // layout container, so the per-frame width growth never triggers a reflow.
  const originX = Math.round((width - chartWidth) / 2)
  const originY = Math.round((height - chartHeight) / 2)

  // Largest value earns the accent. Ties go to the first occurrence; the reduce
  // seed handles an empty array without producing -Infinity downstream.
  const maxValue = data.reduce((m, d) => (d.value > m ? d.value : m), Number.NEGATIVE_INFINITY)

  const trackX = labelWidth + labelGap

  return (
    <Group x={originX} y={originY}>
      {data.map((d, i) => {
        const barDelay = delay + staggerFrames(i, stagger)
        const local = Math.max(0, frame - barDelay)

        // The house spring drives both the fill width and a calm fade-in.
        const progress = spring({
          frame: local,
          fps,
          config: SPRING_SMOOTH,
          durationInFrames: duration,
        })

        const opacity = interpolate(progress, [0, 1], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })

        // Target fill fraction of the track, clamped to [0, 1] so out-of-range
        // data never overflows (callers can raise `max`).
        const targetFrac = max > 0 ? Math.max(0, Math.min(1, d.value / max)) : 0
        const fillWidth = trackWidth * targetFrac * Math.max(0, progress)

        const isLargest = d.value === maxValue
        const fillColor = isLargest ? accentColor : barColor

        const rowY = rowHeight * i
        const radius = barHeight / 2

        return (
          // Row container: layout-positioned by explicit x/y, opacity-only motion
          // (safe — no translate that would grow the bbox).
          <Group key={`${i}-${d.label}`} y={rowY} opacity={opacity}>
            {/* Label column. The engine measures text from its own origin and
                has no right-align, so labels read left-aligned in the column
                (see approximations). Vertically centered against the bar. */}
            <Text
              x={0}
              y={Math.round((barHeight - fontSize) / 2)}
              fontSize={fontSize}
              color={color}
              fontFamily={fontFamily}
              fontWeight={500}
            >
              {d.label}
            </Text>

            {/* Track (full-width background pill). */}
            <Rect
              x={trackX}
              y={0}
              width={trackWidth}
              height={barHeight}
              cornerRadius={radius}
              fill={trackColor}
            />

            {/* Animated fill, grown left-to-right from the track's origin.
                Rendered only once it has positive width. */}
            {fillWidth > 0 ? (
              <Rect
                x={trackX}
                y={0}
                width={fillWidth}
                height={barHeight}
                cornerRadius={radius}
                fill={fillColor}
              />
            ) : null}

            {showValues ? (
              <Text
                x={trackX + trackWidth + labelGap}
                y={Math.round((barHeight - fontSize) / 2)}
                fontSize={fontSize}
                color={color}
                fontFamily={fontFamily}
                fontWeight={500}
              >
                {`${Math.round(d.value)}`}
              </Text>
            ) : null}
          </Group>
        )
      })}
    </Group>
  )
}
