//! CountUp — an animated number that counts from `from` to `to`. Ported from ondajs.
//!
//! Mirrors the ondajs component: opacity rides the house entrance (`entryFade`)
//! while the numeric value is driven independently by a spring mapped onto
//! `[from, to]`, so the fade-in and the counting curve settle together. The
//! formatted value renders as a single `<Text>`.
//!
//! Engine notes (vs the ondajs/CSS original):
//!  - No `font-variant-numeric: tabular-nums`, no `letter-spacing`/`line-height`,
//!    no `text-align`, and no `placement` region system in the scene `<Text>`.
//!    We expose `x`/`y` for placement and let the engine measure the text.
//!  - en-US thousands grouping is implemented locally (deterministic across
//!    hosts) rather than via `Number.toLocaleString`, which is locale-data
//!    dependent. Toggle with `useGrouping`.

import { Text, interpolate, spring, useCurrentFrame, useVideoConfig } from '@onda/react'
import { entryFade } from '../choreography.js'
import { DURATION, SPRING_SMOOTH, SPRING_SNAPPY } from '../motion.js'

export interface CountUpProps {
  /** Starting value (default `0`). */
  from?: number
  /** Ending value (default `100`). */
  to?: number
  /** Frames before the count starts (default `0`). */
  delay?: number
  /** Frames to count from `from` to `to`. Numbers want more time than text
   *  (default `DURATION.slow` = 24). */
  durationInFrames?: number
  /** Fraction digits to render (default `0`). */
  decimals?: number
  /** Insert en-US thousands separators (default `true`). */
  useGrouping?: boolean
  /** Prepended to the number, e.g. `'$'` (default `''`). */
  prefix?: string
  /** Appended to the number, e.g. `'%'` (default `''`). */
  suffix?: string
  /** Text color (default `#F2F2F4`). */
  color?: string
  /** Font size in px. Counters are usually large (default `120`). */
  fontSize?: number
  /** Loaded font family (e.g. a `--font` passed to `onda render`). */
  fontFamily?: string
  /** Font weight (default `600`). */
  fontWeight?: number
  /** Use the snappier spring (`SPRING_SNAPPY`) for the count (default `false`,
   *  i.e. `SPRING_SMOOTH` — matches ondajs). */
  snappy?: boolean
  /** Pixel translate for placement. */
  x?: number
  y?: number
}

/** Format a number with a fixed number of decimals and optional en-US thousands
 *  grouping. Deterministic — no locale data, no `toLocaleString`. */
function formatNumber(value: number, decimals: number, useGrouping: boolean): string {
  const negative = value < 0
  // toFixed rounds half-away-from-zero on the absolute value, then we re-sign.
  const fixed = Math.abs(value).toFixed(Math.max(0, decimals))
  const dot = fixed.indexOf('.')
  const intPart = dot === -1 ? fixed : fixed.slice(0, dot)
  const fracPart = dot === -1 ? '' : fixed.slice(dot) // includes the leading '.'

  let grouped = intPart
  if (useGrouping && intPart.length > 3) {
    const out: string[] = []
    for (let i = intPart.length; i > 0; i -= 3) {
      out.unshift(intPart.slice(Math.max(0, i - 3), i))
    }
    grouped = out.join(',')
  }

  return `${negative ? '-' : ''}${grouped}${fracPart}`
}

export function CountUp({
  from = 0,
  to = 100,
  delay = 0,
  durationInFrames = DURATION.slow,
  decimals = 0,
  useGrouping = true,
  prefix = '',
  suffix = '',
  color = '#F2F2F4',
  fontSize = 120,
  fontFamily,
  fontWeight = 600,
  snappy = false,
  x = 0,
  y = 0,
}: CountUpProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  // Opacity rides the shared house entrance so the fade-in and the counting
  // curve settle together rather than racing each other.
  const { opacity } = entryFade({ frame, fps, delay, durationInFrames })

  // The numeric progress on the same family of springs, computed independently
  // so we can map it onto the range [from, to].
  const progress = spring({
    frame: frame - delay,
    fps,
    config: snappy ? SPRING_SNAPPY : SPRING_SMOOTH,
    durationInFrames,
  })

  const value = interpolate(progress, [0, 1], [from, to], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const formatted = formatNumber(value, decimals, useGrouping)

  return (
    <Text
      x={x}
      y={y}
      opacity={opacity}
      color={color}
      fontSize={fontSize}
      fontFamily={fontFamily}
      fontWeight={fontWeight}
    >
      {`${prefix}${formatted}${suffix}`}
    </Text>
  )
}
