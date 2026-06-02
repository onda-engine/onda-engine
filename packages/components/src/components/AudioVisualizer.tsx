//! AudioVisualizer — a frequency-bar spectrum visualizer. Ported from ondajs
//! (`audio-visualizer`, `bars` variant).
//!
//! IMPORTANT: this is NOT driven by real audio. A pure frame→scene function
//! has no FFT / decode, so ondajs's `visualizeAudio()` pipeline (real dB-
//! normalized magnitudes) is unavailable here. The spectrum is FAKED: each
//! bar's amplitude comes from deterministic value noise (`noise2D`) plus a
//! couple of sines, shaped by a low-bin tilt so it reads like a real music
//! spectrum (bass-heavy left, quieter highs). It "looks live" but carries no
//! information about any audio file. See `approximations`.
//!
//! Layout: the bar row has FIXED dimensions and is centered by computing its
//! top-left offset from the composition size (like `BarChart`) — NOT a
//! `<Flex>`/`<AbsoluteFill>`. Each bar's height animates every frame, so a
//! layout container would reflow (jiggle) as the measured bbox grew; bars are
//! placed by explicit `x`/`y` inside one `<Group>` instead.
//!
//! Backend caveat: each bar uses a vertical `linearGradient` (top accent →
//! softer/transparent bottom). Gradients render only on the Vello/GPU backend;
//! the CPU reference collapses to the FIRST stop, so the top color is the
//! meaningful one and the soft fade is a GPU-only nicety. A bar's `x`/`y` props
//! become the node's local-frame translate, so the rect (and its gradient) is
//! authored from local origin (0,0): the gradient runs `[0,0]→[0,barH]`, NOT
//! offset by the translate `y` (doing so would shove the gradient band off the
//! rect and collapse it to the top stop for non-`top` alignments).

import { Group, Rect, linearGradient, noise2D, useCurrentFrame, useVideoConfig } from '@onda/react'
import { useSpringValue } from '../hooks.js'
import { DURATION } from '../motion.js'

export interface AudioVisualizerProps {
  /** Number of frequency bars. */
  barCount?: number
  /**
   * Bar color. Pass a single hex string for a one-tone visualizer, or a
   * two-entry array `[top, bottom]` for a vertical gradient ramp. The FIRST
   * entry is the meaningful color on the CPU backend (see header).
   */
  color?: string | string[]
  /** Overall width of the bar row, in px. */
  width?: number
  /** Overall height of the bar row (the tallest a bar can reach), in px. */
  height?: number
  /** Vertical placement of the bars within `height`. */
  align?: 'top' | 'middle' | 'bottom'
  /** Pixel gap between adjacent bars. */
  gap?: number
  /** Bar corner radius in px (also the minimum bar height so idle bars read). */
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
  barCount = 48,
  color = ['#d96b82', '#7c5ce5'],
  width = 640,
  height = 160,
  align = 'middle',
  gap = 4,
  barRadius = 2,
  speed = 1,
  seed = 1,
  delay = 0,
  durationInFrames = DURATION.slow,
}: AudioVisualizerProps) {
  const frame = useCurrentFrame()
  const { width: compWidth, height: compHeight } = useVideoConfig()

  const n = Math.max(1, Math.floor(barCount))

  // Bar slot = bar width + gap. Solve for a bar width that exactly fills the
  // row: n bars + (n - 1) gaps span `width`.
  const totalGap = gap * Math.max(0, n - 1)
  const barWidth = Math.max(1, (width - totalGap) / n)
  const slot = barWidth + gap

  // Center the fixed-size row in the composition (no layout container, so the
  // per-frame height growth never triggers a reflow).
  const originX = Math.round((compWidth - width) / 2)
  const originY = Math.round((compHeight - height) / 2)

  // Entrance: a single house-spring 0→1 that grows the bars up from idle and
  // fades the group in. opacity & scale on the group are layout-safe; we only
  // multiply per-bar heights, so no Flex reflow concern (there's no Flex here).
  const entrance = useSpringValue({ delay, durationInFrames })

  // Animation phase. Dividing the frame by a constant sets the drift frequency;
  // `speed` scales it. Kept in noise-input units (noise2D fades between integer
  // lattice points, so a ~0.15/frame step gives smooth, lively motion).
  const t = frame * 0.15 * speed

  const [topColor, bottomColor] = toColorRamp(color)
  // Softer/transparent tail at the bottom so single-color ramps still glow.
  const tailColor =
    Array.isArray(color) && color.length > 1 ? bottomColor : withAlpha(topColor, 0x4d)

  return (
    <Group x={originX} y={originY} opacity={entrance}>
      {Array.from({ length: n }, (_, i) => {
        // Fake spectrum amplitude in [0, 1] for bar i at this frame.
        const amp = barAmplitude(seed, i, n, t)

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
            // The Rect's x/y translate its whole local frame, so the geometry
            // (and this gradient) live in a frame where the bar spans
            // (0,0)..(barWidth, barH). The gradient runs top→bottom of the bar
            // in THAT local space — it must NOT be offset by the translate `y`.
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
      })}
    </Group>
  )
}

/** Fake per-bar spectrum amplitude in `[0, 1]`.
 *
 *  Combines smooth coherent noise (the slow "envelope" of each band), a faster
 *  per-bar flutter, and a global pulse so the whole row breathes together —
 *  then tilts the result so low bins (left) sit louder than highs (right),
 *  the way a real music spectrum reads. Deterministic: identical across frames
 *  and renderers for a given `seed`. */
function barAmplitude(seed: number | string, i: number, n: number, t: number): number {
  // Bin position 0..1 across the row (0 = bass/left, 1 = treble/right).
  const pos = n > 1 ? i / (n - 1) : 0

  // Slow band envelope: smooth noise drifting over time. Maps [-1,1] → [0,1].
  const slow = (noise2D(seed, i * 0.35, t) + 1) * 0.5

  // Faster per-bar flutter, a different noise channel so it doesn't track slow.
  const fast = (noise2D(`${seed}-flutter`, i * 0.9, t * 2.3) + 1) * 0.5

  // Global pulse — a gentle sine the whole row shares, so peaks feel "on beat".
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.7)

  // Weighted blend, then bias toward the bass end (real spectra fall off with
  // frequency). `tilt` goes 1 at the left to ~0.4 at the right.
  const tilt = 1 - 0.6 * pos
  const raw = (0.55 * slow + 0.3 * fast + 0.15 * pulse) * tilt

  // Light gamma so quiet bars don't all hug the floor; clamp to [0,1].
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
      const r = hex[0] ?? '0'
      const g = hex[1] ?? '0'
      const b = hex[2] ?? '0'
      return `#${r}${r}${g}${g}${b}${b}${a}`
    }
  }
  return color
}
