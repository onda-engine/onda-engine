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

import { Text, interpolate, spring, useCurrentFrame, useVideoConfig } from '@onda-engine/react'
import { useFittedFontSize } from '../bounds.js'
import { entryFade } from '../choreography.js'
import { DURATION, SPRING_SMOOTH, SPRING_SNAPPY } from '../motion.js'
import { type Placement, usePlacement } from '../placement.js'
import { useTextMetrics } from '../text-metrics.js'
import { type TextStyleProps, applyTextCase } from '../text-style.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'
import { useTimeScale } from '../timing.js'

export interface CountUpProps extends TextStyleProps {
  /** Starting value (default `0`). */
  from?: number
  /** Ending value (default `100`). */
  to?: number
  /** Time before the count starts (default `0`) — frames or '0.5s'. */
  delay?: TimeInput
  /** Time to count from `from` to `to`. Numbers want more time than text
   *  (default `DURATION.slow` = 24 frames). */
  durationInFrames?: TimeInput
  /** Compress the whole timing envelope (delay, stagger, durations) so the
   *  entrance settles at least `hold` before the end of the enclosing clip
   *  (`useVideoConfig().durationInFrames`, Sequence-scoped). Opt-in. */
  fitToClip?: boolean
  /** Hard cap on the settle time (frames or '0.5s'). Wins over `fitToClip`. */
  maxSettle?: TimeInput
  /** Breathing room before the cut for `fitToClip` (default 6 frames). */
  hold?: TimeInput
  /** Fraction digits to render (default `0`). */
  decimals?: number
  /** Insert en-US thousands separators (default `true`). */
  useGrouping?: boolean
  /** Prepended to the number, e.g. `'$'` (default `''`). */
  prefix?: string
  /** Appended to the number, e.g. `'%'` (default `''`). */
  suffix?: string
  /** Font size in px. Counters are usually large (default `120`). */
  fontSize?: number
  /** Opt-in auto-fit: `'frame'` scales the font size DOWN (never up) so the
   *  measured line cannot exceed the frame minus the safe margins. Default
   *  `'none'` (the historical behavior). */
  fit?: 'none' | 'frame'
  /** Explicit width cap in px for the line; combines with `fit` (the smaller
   *  cap wins). */
  maxWidth?: number
  /** Use the snappier spring (`SPRING_SNAPPY`) for the count (default `false`,
   *  i.e. `SPRING_SMOOTH` — matches ondajs). */
  snappy?: boolean
  /** Where the counter sits: a region keyword (`'center'`, `'lower-third'`, …)
   *  or normalized `{x,y}` (0–1, anchored at the FINAL value's measured
   *  center, so the line never slides as it counts). The shared placement
   *  contract. Omitted → the legacy origin-relative `x`/`y` translate. */
  placement?: Placement
  /** @deprecated Legacy — pixel translate from the local origin. Prefer
   *  `placement`. */
  x?: number
  /** @deprecated Legacy — pixel translate from the local origin. Prefer
   *  `placement`. */
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
  delay: delayIn = 0,
  durationInFrames: durationIn = DURATION.slow,
  fitToClip,
  maxSettle,
  hold,
  decimals = 0,
  useGrouping = true,
  prefix = '',
  suffix = '',
  color: colorProp,
  fontSize: fontSizeProp = 120,
  fit,
  maxWidth,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
  italic = false,
  letterSpacing,
  uppercase,
  snappy = false,
  placement,
  x = 0,
  y = 0,
}: CountUpProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  // Timing: parse + clip-fit (the count compresses to land inside the clip).
  const delayBase = framesOf(delayIn, fps)
  const durationBase = framesOf(durationIn, fps, DURATION.slow)
  const timeScale = useTimeScale(delayBase + durationBase, { fitToClip, maxSettle, hold })
  const delay = delayBase * timeScale
  const durationInFrames = Math.max(1, durationBase * timeScale)

  // Opt-in auto-fit, measured on the FINAL value (the widest the line gets).
  const finalText = `${prefix}${formatNumber(to, decimals, useGrouping)}${suffix}`
  const fontSize = useFittedFontSize(finalText, fontSizeProp, {
    fontFamily,
    fontWeight,
    fit,
    maxWidth,
  })

  // Opacity rides the shared house entrance so the fade-in and the counting
  // curve settle together rather than racing each other.
  const { opacity } = entryFade({ frame, fps, delay, durationInFrames })

  // The numeric progress on the same family of springs, computed independently
  // so we can map it onto the range [from, to]. The spring counts as "settled"
  // within a rest threshold of 1, so it asymptotes just shy of the target; once
  // the count duration has elapsed, snap progress to exactly 1 so the displayed
  // value lands on `to` precisely (otherwise it rests a hair short, e.g. 12,783
  // instead of 12,847).
  const elapsed = frame - delay
  const progress =
    elapsed >= durationInFrames
      ? 1
      : spring({
          frame: elapsed,
          fps,
          config: snappy ? SPRING_SNAPPY : SPRING_SMOOTH,
          durationInFrames,
        })

  const value = interpolate(progress, [0, 1], [from, to], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const formatted = formatNumber(value, decimals, useGrouping)

  // Shared placement contract, anchored on the FINAL value's measured width so
  // the line never slides sideways as digits count up. Without `placement` the
  // legacy origin-relative `x`/`y` translate applies unchanged.
  const measured = useTextMetrics(finalText, fontSize, { fontFamily, fontWeight })
  const resolved = usePlacement(placement, { width: measured.width, height: fontSize * 1.2 })
  const px = placement !== undefined ? Math.round(resolved.originX) : x
  const py = placement !== undefined ? Math.round(resolved.y - fontSize * 0.6) : y

  return (
    <Text
      x={px}
      y={py}
      opacity={opacity}
      color={color}
      fontSize={fontSize}
      fontFamily={fontFamily}
      fontWeight={fontWeight}
      italic={italic}
      letterSpacing={letterSpacing}
    >
      {applyTextCase(`${prefix}${formatted}${suffix}`, { uppercase })}
    </Text>
  )
}
