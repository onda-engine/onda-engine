//! AudioVisualizer — an audio-spectrum visualizer with selectable styles.
//! Ported from ondajs (`audio-visualizer`) and expanded with multiple render
//! styles via the `type` prop: `bars`, `mirrored`, `waveform`, `radial`, `dots`.
//!
//! IMPORTANT: this is NOT driven by real audio. A pure frame→scene function has
//! no FFT / decode, so the spectrum is FAKED: each band's amplitude comes from
//! deterministic value noise (`noise2D`) plus a couple of sines, shaped by a
//! low-bin tilt so it reads like a real music spectrum (bass-heavy left, quieter
//! highs). It "looks live" but carries no information about any audio file. Every
//! style renders from the SAME amplitude array (`barAmplitude`), so when real
//! audio (rustfft → wasm) lands, only that one function is replaced and all
//! styles light up for free. See `approximations`.
//!
//! Layout: the visualizer has FIXED dimensions and is centered by computing its
//! top-left offset from the composition size — NOT a `<Flex>`. Each band animates
//! every frame, so a layout container would reflow (jiggle) as the measured bbox
//! grew; geometry is placed by explicit `x`/`y` inside one `<Group>` instead.
//!
//! Backend caveat: gradients, `<Path>`, and `rotation` render only on the
//! Vello/GPU backend (the gallery's default). The CPU reference collapses a
//! gradient to its FIRST stop, skips paths, and ignores rotation — so `bars`,
//! `mirrored`, and `dots` degrade gracefully there, while `waveform` (a path) and
//! `radial` (rotation) are GPU-only niceties.

import {
  Ellipse,
  Group,
  Path,
  Rect,
  linearGradient,
  noise2D,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import { type ReactElement, useMemo } from 'react'
import { useAudioData } from '../audio.js'
import { useSpringValue } from '../hooks.js'
import { DURATION } from '../motion.js'
import { useTheme } from '../theme.js'

/** Visualizer render style. Every style draws from the same amplitude array, so
 *  switching `type` is purely a change of geometry. */
export type AudioVisualizerType = 'bars' | 'mirrored' | 'waveform' | 'radial' | 'dots'

export interface AudioVisualizerProps {
  /**
   * Render style (default `'bars'`):
   *  - `bars` — classic vertical frequency bars.
   *  - `mirrored` — bars mirrored around the centre line (symmetric EQ).
   *  - `waveform` — a smooth filled ribbon around the centre line.
   *  - `radial` — bars radiating from a centre ring (circular spectrum).
   *  - `dots` — an LED dot-matrix meter with a brighter peak dot.
   */
  type?: AudioVisualizerType
  /**
   * Audio file URL to drive the bars with REAL frequency data (decoded + FFT'd by
   * `@onda/wasm-audio` — identical spectra in preview and export). Omit for the
   * built-in procedural animation. For the browser preview the source must be
   * same-origin or CORS-enabled; `onda export` accepts any direct URL.
   */
  src?: string
  /** Number of frequency bands. */
  barCount?: number
  /**
   * Bar color. Pass a single hex string for a one-tone visualizer, or a
   * two-entry array `[top, bottom]` for a vertical gradient ramp. The FIRST
   * entry is the meaningful color on the CPU backend (see header). (default:
   * theme `accent` for the top, theme `palette[1]` for the bottom)
   */
  color?: string | string[]
  /** Overall width of the visualizer, in px. */
  width?: number
  /** Overall height of the visualizer (the tallest a band can reach), in px. */
  height?: number
  /** Vertical placement of the bars within `height` (`bars` style only). */
  align?: 'top' | 'middle' | 'bottom'
  /** Pixel gap between adjacent bars. */
  gap?: number
  /** Bar corner radius in px (also the minimum bar height so idle bars read) (default: theme `radius`). */
  barRadius?: number
  /** Animation speed multiplier for the fake spectrum's drift. */
  speed?: number
  /** Deterministic seed for the fake spectrum. */
  seed?: number | string
  /** Frames before the visualizer fades/grows in. */
  delay?: number
  /** Frames for the entrance grow-in. */
  durationInFrames?: number
}

/** Two-entry [top, bottom] color ramp from the `color` prop (single string
 *  becomes [color, color]; arrays are clamped to their first two entries with
 *  defensive fallbacks). */
function toColorRamp(color: string | string[]): [string, string] {
  if (Array.isArray(color)) {
    const top = color[0] ?? '#d96b82'
    const bottom = color[1] ?? top
    return [top, bottom]
  }
  return [color, color]
}

export function AudioVisualizer({
  type = 'bars',
  src,
  barCount = 48,
  color: colorProp,
  width = 640,
  height = 160,
  align = 'middle',
  gap = 4,
  barRadius: barRadiusProp,
  speed = 1,
  seed = 1,
  delay = 0,
  durationInFrames = DURATION.slow,
}: AudioVisualizerProps) {
  const frame = useCurrentFrame()
  const {
    width: compWidth,
    height: compHeight,
    fps,
    durationInFrames: compFrames,
  } = useVideoConfig()
  const theme = useTheme()
  const color = colorProp ?? [theme.accent, theme.palette[1] ?? '#7c5ce5']
  const barRadius = barRadiusProp ?? theme.radius

  const n = Math.max(1, Math.floor(barCount))

  // Bar slot = bar width + gap. Solve for a bar width that exactly fills the
  // row: n bars + (n - 1) gaps span `width`.
  const totalGap = gap * Math.max(0, n - 1)
  const barWidth = Math.max(1, (width - totalGap) / n)
  const slot = barWidth + gap

  // Center the fixed-size visualizer in the composition (no layout container, so
  // the per-frame size growth never triggers a reflow).
  const originX = Math.round((compWidth - width) / 2)
  const originY = Math.round((compHeight - height) / 2)

  // Entrance: a single house-spring 0→1 that grows the bands in and fades the
  // group in. opacity on the group is layout-safe; we only multiply per-band
  // sizes, so no Flex reflow concern (there's no Flex here).
  const entrance = useSpringValue({ delay, durationInFrames })

  // Animation phase. Dividing the frame by a constant sets the drift frequency;
  // `speed` scales it. Kept in noise-input units (noise2D fades between integer
  // lattice points, so a ~0.15/frame step gives smooth, lively motion).
  const t = frame * 0.15 * speed

  const [topColor, bottomColor] = toColorRamp(color)
  // Softer/transparent tail so single-color ramps still glow.
  const tailColor =
    Array.isArray(color) && color.length > 1 ? bottomColor : withAlpha(topColor, 0x4d)

  // The amplitudes (0..1, low→high) every style renders from. With `src`, these
  // are REAL FFT magnitudes (decoded + analyzed by @onda/wasm-audio, cached for
  // the whole clip and indexed by frame); otherwise a deterministic procedural
  // spectrum. While the audio loads, the procedural fallback keeps it live.
  const audio = useAudioData(src)
  const spectrum = useMemo(
    () => (audio ? audio.spectrogram(fps, Math.max(1, compFrames), n) : null),
    [audio, fps, compFrames, n],
  )
  const amps = spectrum
    ? Array.from(
        spectrum.subarray(
          Math.min(Math.max(0, frame), Math.max(0, compFrames - 1)) * n,
          Math.min(Math.max(0, frame), Math.max(0, compFrames - 1)) * n + n,
        ),
      )
    : Array.from({ length: n }, (_, i) => barAmplitude(seed, i, n, t))

  const ctx: VizCtx = {
    amps,
    n,
    width,
    height,
    barWidth,
    slot,
    barRadius,
    topColor,
    bottomColor,
    tailColor,
    entrance,
    align,
  }

  const children =
    type === 'mirrored'
      ? renderMirrored(ctx)
      : type === 'waveform'
        ? renderWaveform(ctx)
        : type === 'radial'
          ? renderRadial(ctx)
          : type === 'dots'
            ? renderDots(ctx)
            : renderBars(ctx)

  return (
    <Group x={originX} y={originY} opacity={entrance}>
      {children}
    </Group>
  )
}

/** A 2D point in the visualizer's local space. */
interface Pt {
  x: number
  y: number
}

/** Everything a style renderer needs, derived once per frame. */
interface VizCtx {
  amps: number[]
  n: number
  width: number
  height: number
  barWidth: number
  slot: number
  barRadius: number
  topColor: string
  bottomColor: string
  tailColor: string
  entrance: number
  align: 'top' | 'middle' | 'bottom'
}

/** Round to 0.1px to keep generated path data compact. */
function r(v: number): number {
  return Math.round(v * 10) / 10
}

// ── Styles ──────────────────────────────────────────────────────────────────

/** `bars` — classic vertical frequency bars (the original look). Each bar's
 *  x/y translate its whole local frame, so the geometry (and gradient) live in a
 *  frame where the bar spans (0,0)..(barWidth, barH); the gradient runs top→bottom
 *  in THAT local space — it must NOT be offset by the translate `y`. */
function renderBars({
  amps,
  height,
  barWidth,
  slot,
  barRadius,
  topColor,
  tailColor,
  entrance,
  align,
}: VizCtx): ReactElement[] {
  return amps.map((amp, i) => {
    const barH = Math.max(barRadius * 2, amp * height * Math.max(0, entrance))
    const x = i * slot
    const y = align === 'top' ? 0 : align === 'bottom' ? height - barH : (height - barH) / 2
    return (
      <Rect
        key={i}
        x={x}
        y={y}
        width={barWidth}
        height={barH}
        cornerRadius={barRadius}
        fill={topColor}
        gradient={linearGradient(
          [0, 0],
          [0, barH],
          [
            { offset: 0, color: topColor },
            { offset: 1, color: tailColor },
          ],
        )}
      />
    )
  })
}

/** `mirrored` — bars grown symmetrically from the centre line, with a
 *  centre-bright gradient that fades to both ends (a reflected EQ). */
function renderMirrored({
  amps,
  height,
  barWidth,
  slot,
  barRadius,
  topColor,
  tailColor,
  entrance,
}: VizCtx): ReactElement[] {
  const mid = height / 2
  return amps.map((amp, i) => {
    const barH = Math.max(barRadius * 2, amp * height * Math.max(0, entrance))
    const x = i * slot
    const y = mid - barH / 2
    return (
      <Rect
        key={i}
        x={x}
        y={y}
        width={barWidth}
        height={barH}
        cornerRadius={barRadius}
        fill={topColor}
        gradient={linearGradient(
          [0, 0],
          [0, barH],
          [
            { offset: 0, color: tailColor },
            { offset: 0.5, color: topColor },
            { offset: 1, color: tailColor },
          ],
        )}
      />
    )
  })
}

/** Smooth open polyline through `pts` (quadratic curves to segment midpoints). */
function smoothPath(pts: Pt[]): string {
  const head = pts[0]
  if (!head) return ''
  let d = `M ${r(head.x)} ${r(head.y)}`
  for (let i = 1; i < pts.length; i++) {
    const cur = pts[i]
    if (!cur) continue
    const nxt = pts[i + 1]
    if (nxt) {
      const mx = (cur.x + nxt.x) / 2
      const my = (cur.y + nxt.y) / 2
      d += ` Q ${r(cur.x)} ${r(cur.y)} ${r(mx)} ${r(my)}`
    } else {
      d += ` L ${r(cur.x)} ${r(cur.y)}`
    }
  }
  return d
}

/** Closed ribbon: smooth `top` contour, then the `bottom` contour back
 *  (reversed), then close. */
function ribbonPath(top: Pt[], bottom: Pt[]): string {
  const d1 = smoothPath(top)
  if (!d1) return ''
  const back = smoothPath([...bottom].reverse())
  if (!back) return d1
  // `back` starts with `M x y …`; re-enter it as a line from the top contour's
  // end (`L x y …`) so the two contours join into one closed shape.
  return `${d1} L${back.slice(1)} Z`
}

/** `waveform` — a smooth filled ribbon symmetric about the centre line. */
function renderWaveform({
  amps,
  n,
  width,
  height,
  topColor,
  tailColor,
  entrance,
}: VizCtx): ReactElement[] {
  const mid = height / 2
  const halfH = (height / 2) * 0.92 * Math.max(0, entrance)
  const xAt = (i: number) => (n > 1 ? (i / (n - 1)) * width : width / 2)
  const top: Pt[] = amps.map((a, i) => ({ x: xAt(i), y: mid - Math.max(a, 0.03) * halfH }))
  const bottom: Pt[] = amps.map((a, i) => ({ x: xAt(i), y: mid + Math.max(a, 0.03) * halfH }))
  return [
    <Path
      key="wave"
      d={ribbonPath(top, bottom)}
      fill={topColor}
      stroke={topColor}
      strokeWidth={2}
      gradient={linearGradient(
        [0, mid - halfH],
        [0, mid + halfH],
        [
          { offset: 0, color: tailColor },
          { offset: 0.5, color: topColor },
          { offset: 1, color: tailColor },
        ],
      )}
    />,
  ]
}

/** `radial` — bars radiating outward from a centre ring (circular spectrum). */
function renderRadial({
  amps,
  n,
  width,
  height,
  barRadius,
  topColor,
  tailColor,
  entrance,
}: VizCtx): ReactElement[] {
  const cx = width / 2
  const cy = height / 2
  const outerR = (Math.min(width, height) / 2) * 0.94
  const innerR = outerR * 0.42
  const barW = Math.max(2, ((2 * Math.PI * innerR) / n) * 0.55)
  const ring = (
    <Ellipse
      key="ring"
      x={cx - innerR}
      y={cy - innerR}
      width={innerR * 2}
      height={innerR * 2}
      stroke={tailColor}
      strokeWidth={1.5}
    />
  )
  const spokes = amps.map((amp, i) => {
    const barLen = Math.max(barRadius, amp * (outerR - innerR) * Math.max(0, entrance))
    const angle = (i / n) * 360
    return (
      // Rotate a Group about the centre, then draw the bar pointing "up" (−y)
      // from the inner ring outward. The rect's local (0,0) sits at the OUTER
      // tip, so the gradient runs faded-tip → bright-base.
      <Group key={i} x={cx} y={cy} rotation={angle}>
        <Rect
          x={-barW / 2}
          y={-(innerR + barLen)}
          width={barW}
          height={barLen}
          cornerRadius={Math.min(barW / 2, barRadius)}
          fill={topColor}
          gradient={linearGradient(
            [0, 0],
            [0, barLen],
            [
              { offset: 0, color: tailColor },
              { offset: 1, color: topColor },
            ],
          )}
        />
      </Group>
    )
  })
  return [ring, ...spokes]
}

/** `dots` — an LED dot-matrix meter; each column lights bottom-up to its
 *  amplitude, with a brighter "peak hold" dot at the top of the lit run. */
function renderDots({
  amps,
  height,
  barWidth,
  slot,
  topColor,
  bottomColor,
  entrance,
}: VizCtx): ReactElement[] {
  const dotGap = 3
  const rows = Math.max(6, Math.round(height / 14))
  const dotH = (height - (rows - 1) * dotGap) / rows
  const dotW = Math.min(barWidth, dotH * 1.4)
  const dim = withAlpha(topColor, 0x22)
  const radius = Math.min(dotW, dotH) / 3
  const out: ReactElement[] = []
  amps.forEach((amp, i) => {
    const lit = Math.round(Math.max(0, amp) * rows * Math.max(0, entrance))
    const x = i * slot + (barWidth - dotW) / 2
    for (let row = 0; row < rows; row++) {
      const on = row < lit
      const peak = row === lit - 1
      const y = height - (row + 1) * dotH - row * dotGap
      out.push(
        <Rect
          key={`${i}-${row}`}
          x={x}
          y={y}
          width={dotW}
          height={dotH}
          cornerRadius={radius}
          fill={on ? (peak ? bottomColor : topColor) : dim}
        />,
      )
    }
  })
  return out
}

/** Fake per-band spectrum amplitude in `[0, 1]`.
 *
 *  Combines smooth coherent noise (the slow "envelope" of each band), a faster
 *  per-band flutter, and a global pulse so the whole row breathes together —
 *  then tilts the result so low bins (left) sit louder than highs (right),
 *  the way a real music spectrum reads. Deterministic: identical across frames
 *  and renderers for a given `seed`. This is the ONE function real audio data
 *  (FFT magnitudes) would replace; every style above reads its output. */
function barAmplitude(seed: number | string, i: number, n: number, t: number): number {
  // Bin position 0..1 across the row (0 = bass/left, 1 = treble/right).
  const pos = n > 1 ? i / (n - 1) : 0

  // Slow band envelope: smooth noise drifting over time. Maps [-1,1] → [0,1].
  const slow = (noise2D(seed, i * 0.35, t) + 1) * 0.5

  // Faster per-band flutter, a different noise channel so it doesn't track slow.
  const fast = (noise2D(`${seed}-flutter`, i * 0.9, t * 2.3) + 1) * 0.5

  // Global pulse — a gentle sine the whole row shares, so peaks feel "on beat".
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.7)

  // Weighted blend, then bias toward the bass end (real spectra fall off with
  // frequency). `tilt` goes 1 at the left to ~0.4 at the right.
  const tilt = 1 - 0.6 * pos
  const raw = (0.55 * slow + 0.3 * fast + 0.15 * pulse) * tilt

  // Light gamma so quiet bands don't all hug the floor; clamp to [0,1].
  const shaped = raw ** 0.8
  return Math.max(0, Math.min(1, shaped))
}

/** Return `color` with its alpha channel set to `alpha` (0..255), preserving
 *  the RGB. Falls back to the input unchanged for non-`#rrggbb(aa)` strings. */
function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(255, Math.round(alpha)))
    .toString(16)
    .padStart(2, '0')
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    if (hex.length === 6 || hex.length === 8) {
      return `#${hex.slice(0, 6)}${a}`
    }
    if (hex.length === 3) {
      const rr = hex[0] ?? '0'
      const gg = hex[1] ?? '0'
      const bb = hex[2] ?? '0'
      return `#${rr}${rr}${gg}${gg}${bb}${bb}${a}`
    }
  }
  return color
}
