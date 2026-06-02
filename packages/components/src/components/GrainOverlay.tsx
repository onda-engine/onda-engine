//! GrainOverlay — a subtle film-grain texture layered over the whole canvas.
//! Ported from ondajs.
//!
//! APPROXIMATION. ondajs renders SVG `feTurbulence` (fractal noise) flattened to
//! monochrome alpha through a CSS `<filter>`. The engine has no noise filter, so
//! we approximate film grain by scattering many tiny semi-transparent `<Rect>`
//! dots at deterministic positions/sizes/alphas drawn from `random(seed)`. This
//! reads as restrained grain at the house 2–4% opacity but is NOT a true
//! turbulence field — there is no octave-summed self-similar structure, the
//! "grain" is discrete dots rather than a continuous per-pixel field, and the
//! tightest frequencies a real `feTurbulence` produces (sub-pixel speckle) are
//! not reproducible with discrete rects. `baseFrequency` is mapped to dot
//! density + size (higher = finer/tighter), `numOctaves` to alpha variance
//! (higher = more contrast/detail), and `seed` seeds the deterministic scatter.
//!
//! Like ondajs, the default is DELIBERATELY no-motion: the grain is set dressing,
//! not a performer. It does not meaningfully read `useCurrentFrame()` unless
//! `animate` is on, in which case it re-seeds on a frame bucket (every
//! `animateEvery` frames) so the grain shimmers without flickering every single
//! frame. Even then it stays a pure function of the frame (deterministic via
//! `random`), never wall-clock time or the JS global PRNG.
//!
//! Layout note: the grain dots are absolutely positioned (explicit x/y), so they
//! live inside a plain `<Group>` — NOT a `<Flex>`/`<AbsoluteFill>`, whose layout
//! pass would clobber their per-dot x/y.

import { Group, Rect, random, useCurrentFrame, useVideoConfig } from '@onda/react'
import type { ReactNode } from 'react'

export interface GrainOverlayProps {
  /**
   * Layer opacity, multiplied into every grain dot's alpha. Capped at `0.15` to
   * match ondajs (CLAUDE.md tokens cap grain at ~2%; 0.02–0.04 is the house
   * range). Default `0.04`.
   */
  opacity?: number
  /**
   * Grain frequency. Higher = finer, tighter grain (more, smaller dots); lower
   * = coarser photo-grain (fewer, larger dots). Mapped onto the dot count/size,
   * not a true SVG turbulence frequency. Default `0.9`.
   */
  baseFrequency?: number
  /**
   * Grain complexity. Higher values widen the per-dot alpha variance so the
   * texture gains contrast/detail. Clamped to `1..4` like ondajs. Default `1`.
   */
  numOctaves?: number
  /** Deterministic variation — the same seed always produces the same grain. Default `0`. */
  seed?: number
  /**
   * Number of grain dots to scatter. Kept modest by default to stay cheap; the
   * effective count also scales mildly with `baseFrequency`. Default `800`.
   */
  count?: number
  /** Grain color (hex `#rrggbb`). Defaults to near-black, matching ondajs's
   *  monochrome alpha grain. Use a light color over dark footage if desired. */
  color?: string
  /**
   * When `true`, the scatter re-seeds on a frame bucket so the grain animates
   * (a faint shimmer). Off by default — ondajs grain is intentionally static. */
  animate?: boolean
  /** Frames per re-seed bucket when `animate` is on. Lower = busier. Default `2`. */
  animateEvery?: number
}

/** Clamp `n` into `[lo, hi]`. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** A 0..1 alpha as a 2-digit hex channel. */
function alphaHex(a: number): string {
  return clamp(Math.round(a * 255), 0, 255)
    .toString(16)
    .padStart(2, '0')
}

/** Strip a leading `#` and any trailing alpha, yielding a 6-digit `rrggbb`. */
function rgbHex(color: string): string {
  let hex = color.startsWith('#') ? color.slice(1) : color
  if (hex.length === 3 || hex.length === 4) {
    const r = hex[0] ?? '0'
    const g = hex[1] ?? '0'
    const b = hex[2] ?? '0'
    hex = `${r}${r}${g}${g}${b}${b}`
  }
  return hex.slice(0, 6).padEnd(6, '0')
}

export function GrainOverlay({
  opacity = 0.04,
  baseFrequency = 0.9,
  numOctaves = 1,
  seed = 0,
  count = 800,
  color = '#0a0a0c',
  animate = false,
  animateEvery = 2,
}: GrainOverlayProps) {
  const { width, height } = useVideoConfig()
  const frame = useCurrentFrame()

  const layerOpacity = clamp(opacity, 0, 0.15)
  const freq = Math.max(0, baseFrequency)
  const octaves = clamp(Math.round(numOctaves), 1, 4)

  // Frame bucket: when static this is a constant so every frame is identical
  // (deterministic by construction); when animating it advances in steps so the
  // grain shimmers without flickering each frame. Never reads wall-clock time.
  const bucket = animate ? Math.floor(frame / Math.max(1, animateEvery)) : 0

  // Density/size from baseFrequency: higher frequency → more, smaller dots
  // (finer grain), lower → fewer, larger (coarse photo-grain). Kept modest.
  const densityScale = clamp(0.5 + freq * 0.6, 0.4, 1.6)
  const dotCount = Math.max(0, Math.round(clamp(count, 0, 4000) * densityScale))
  // Base dot size shrinks as frequency rises (finer grain = smaller speckle).
  const baseSize = clamp(2.2 - freq * 0.9, 0.7, 2.5)

  // Octaves widen the alpha spread — more contrast/detail at higher complexity.
  const alphaSpread = clamp(0.35 + (octaves - 1) * 0.2, 0.35, 1)

  const rgbColor = `#${rgbHex(color)}`
  const dots: ReactNode[] = []
  for (let i = 0; i < dotCount; i++) {
    // Each dot draws four independent deterministic values from distinct string
    // seeds (seed + frame bucket + index + channel) so x/y/alpha/size decorrelate.
    const base = `${seed}:${bucket}:${i}`
    const px = random(`${base}:x`) * width
    const py = random(`${base}:y`) * height
    // Per-dot alpha centered around the layer opacity, widened by octaves.
    const jitter = (random(`${base}:a`) - 0.5) * 2 * alphaSpread
    const a = clamp(layerOpacity * (1 + jitter), 0, 0.15)
    if (a <= 0.001) continue
    // Slight per-dot size variation around the base speckle size.
    const size = baseSize * (0.6 + random(`${base}:s`) * 0.8)

    dots.push(
      <Rect key={i} x={px} y={py} width={size} height={size} fill={`${rgbColor}${alphaHex(a)}`} />,
    )
  }

  return <Group>{dots}</Group>
}
