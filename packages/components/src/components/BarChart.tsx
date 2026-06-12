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
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

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
  delay?: TimeInput
  /** Per-bar grow duration. Bars want more time than text (default `slow`). */
  duration?: TimeInput
  /** Frames between consecutive bars (default canonical `STAGGER` = 4). */
  stagger?: TimeInput
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
  /** Count each value up from 0 in sync with its bar's growth (lands exactly on
   *  the true value). Only applies when `showValues` is on. Default `true`. */
  countUp?: boolean
  /** Optional headline above the chart — tells viewers what the numbers measure
   *  (e.g. "Frames per second"). */
  title?: string
  /** Title font size in px. Default ~1.5× the label `fontSize`. */
  titleSize?: number
  /** Title color. Defaults to `color`. */
  titleColor?: string
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
  delay: delayIn = 0,
  duration: durationIn = DURATION.slow,
  stagger: staggerIn = STAGGER,
  barHeight = 32,
  gap = 16,
  labelWidth = 220,
  labelGap = 24,
  trackWidth = 760,
  accentColor: accentColorProp,
  barColor: barColorProp,
  trackColor: trackColorProp,
  color: colorProp,
  showValues = false,
  countUp = true,
  title,
  titleSize,
  titleColor: titleColorProp,
  fontSize = 24,
  fontFamily: fontFamilyProp,
}: BarChartProps) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const duration = framesOf(durationIn, fps)
  const stagger = framesOf(staggerIn, fps)
  // Colors/font default to the active theme; explicit props override.
  const theme = useTheme()
  const accentColor = accentColorProp ?? theme.accent
  const barColor = barColorProp ?? theme.palette[0] ?? theme.textMuted
  const trackColor = trackColorProp ?? theme.surface
  const color = colorProp ?? theme.text
  const titleColor = titleColorProp ?? color
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  const rowHeight = barHeight + gap
  // Total chart footprint (no trailing gap below the last row).
  const chartWidth = labelWidth + labelGap + trackWidth
  const barsHeight = data.length > 0 ? rowHeight * data.length - gap : 0
  // Optional headline above the bars. Reserve its line + a margin.
  const titleFont = titleSize ?? Math.round(fontSize * 1.5)
  const titleBlock = title ? Math.round(titleFont * 1.6) : 0
  const blockHeight = barsHeight + titleBlock

  // Center the fixed-size block (title + bars) by computing its top-left offset
  // directly — no layout container, so the per-frame width growth never
  // triggers a reflow.
  const originX = Math.round((width - chartWidth) / 2)
  const originY = Math.round((height - blockHeight) / 2)
  // Center the title over the chart width (estimated — the engine has no
  // author-time text metrics or text-align).
  const titleWidth = title ? title.length * titleFont * 0.55 : 0
  const titleX = Math.max(0, Math.round((chartWidth - titleWidth) / 2))

  // Largest value earns the accent. Ties go to the first occurrence; the reduce
  // seed handles an empty array without producing -Infinity downstream.
  const maxValue = data.reduce((m, d) => (d.value > m ? d.value : m), Number.NEGATIVE_INFINITY)

  const trackX = labelWidth + labelGap

  return (
    <Group x={originX} y={originY}>
      {title ? (
        <Text
          x={titleX}
          y={0}
          fontSize={titleFont}
          color={titleColor ?? color}
          fontFamily={fontFamily}
          fontWeight={600}
        >
          {title}
        </Text>
      ) : null}
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

        // A clamped growth fraction that reaches exactly 1 (the overdamped
        // spring settles at ~0.995). Drives BOTH the bar width and the count-up,
        // so the number and the bar land together on the true value.
        const grow = interpolate(progress, [0, 0.99], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })

        // Target fill fraction of the track, clamped to [0, 1] so out-of-range
        // data never overflows (callers can raise `max`).
        const targetFrac = max > 0 ? Math.max(0, Math.min(1, d.value / max)) : 0
        const fillWidth = trackWidth * targetFrac * grow

        const isLargest = d.value === maxValue
        const fillColor = isLargest ? accentColor : barColor

        const rowY = titleBlock + rowHeight * i
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
                {`${countUp ? Math.round(d.value * grow) : Math.round(d.value)}`}
              </Text>
            ) : null}
          </Group>
        )
      })}
    </Group>
  )
}
