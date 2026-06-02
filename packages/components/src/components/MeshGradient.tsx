//! MeshGradient — a drifting mesh-gradient backdrop. Ported from ondajs.
//!
//! Atmosphere, not subject: several large, soft radial blobs in palette colors
//! drift slowly over a near-black canvas. Each blob's center is a pure function
//! of the frame (sine/cosine drift keyed off a *seeded* phase), so it loops and
//! renders deterministically (§1) — no `useState`/`useEffect`, no global PRNG.
//! Overlapping soft radials read as a single mesh gradient.
//!
//! Engine notes / approximations:
//!  - No blur primitive. ondajs draws hard-ish radial blobs and applies a CSS
//!    `blur(8px)` over the whole layer to melt them together. Here the softness
//!    is baked into each blob's gradient instead: a wide color→transparent tail
//!    (the gradient *is* the blur), so overlapping blobs still blend smoothly.
//!  - Each blob is a full-composition `<Rect>` filled with a `radialGradient`
//!    (solid `color` at the moving center → transparent at the blob radius). The
//!    Rect size never changes, only the gradient center moves, so there is no
//!    layout reflow. The blobs are absolutely positioned at the origin, not in a
//!    `<Flex>`, so animated centers can't make a layout jiggle (§2).
//!  - Overall `opacity` is applied as a wrapping `<Group opacity>` (the scene
//!    equivalent of ondajs's layer opacity over the background).
//!  - Backend caveat: gradients render only on the Vello/GPU backend. The CPU
//!    reference rasterizer collapses each gradient to its first stop (the solid
//!    blob color), so the soft mesh blend is a GPU-only effect — on CPU the
//!    blobs become flat color fills. The meaningful color is the FIRST stop.

import { Group, Rect, radialGradient, random, useCurrentFrame, useVideoConfig } from '@onda/react'
import { useTheme } from '../theme.js'

/** Default palette — drifts over the near-black canvas (matches ondajs). */
const DEFAULT_COLORS = ['#d96b82', '#e89aab', '#26262e']

/** Default canvas color behind the blobs (matches ondajs `--onda-bg`). */
const DEFAULT_BACKGROUND = '#08080a'

export interface MeshGradientProps {
  /** Blob colors. 2–4 reads best; they drift over the `background` canvas (default: theme `palette[0]`). */
  colors?: string[]
  /** Base canvas color behind the blobs (default: theme `background`). */
  background?: string
  /** Drift speed multiplier. Keep low — this is atmosphere, not motion. */
  speed?: number
  /** Seed for the blob phase/amplitude offsets (deterministic). */
  seed?: number
  /** Overall blob opacity over the canvas (0..1). */
  opacity?: number
}

/** Clamp `n` into `[lo, hi]`. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** Return `color` with its alpha channel forced to `00` (fully transparent),
 *  preserving the RGB so the blob fades OUT rather than toward black. */
function toTransparent(color: string): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    if (hex.length === 6 || hex.length === 8) {
      return `#${hex.slice(0, 6)}00`
    }
    if (hex.length === 3 || hex.length === 4) {
      const r = hex[0] ?? '0'
      const g = hex[1] ?? '0'
      const b = hex[2] ?? '0'
      return `#${r}${r}${g}${g}${b}${b}00`
    }
  }
  // Unknown format — fall back to a known-transparent value.
  return '#00000000'
}

export function MeshGradient({
  colors: colorsProp,
  background: backgroundProp,
  speed = 1,
  seed = 7,
  opacity = 0.5,
}: MeshGradientProps) {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const theme = useTheme()
  const colors = colorsProp ?? (theme.palette[0] ? [theme.palette[0]] : DEFAULT_COLORS)
  const background = backgroundProp ?? theme.background ?? DEFAULT_BACKGROUND

  // Shared drift clock — slow, since this is atmosphere (ondajs: frame * 0.012).
  const w = frame * 0.012 * speed

  // Blob radius scales with the canvas so the softness reads the same at any
  // aspect. ondajs's CSS tail ends at 45% of the gradient box; the half-diagonal
  // gives a generous, soft overlap that melts the blobs together (the "blur").
  const blobRadius = Math.hypot(width, height) * 0.5

  return (
    <Group opacity={clamp(opacity, 0, 1)}>
      {/* Base canvas behind the blobs. */}
      <Rect width={width} height={height} fill={background} />

      {colors.map((color, i) => {
        // Per-blob deterministic phase/amplitude offsets. The engine's `random`
        // is single-shot, so derive an independent value per axis by salting the
        // seed with the blob index (matches the *intent* of ondajs's seeded
        // `rand()` sequence: stable, decorrelated offsets per blob).
        const phase = random(`${seed}-${i}-phase`) * Math.PI * 2
        const ampX = (16 + random(`${seed}-${i}-ampx`) * 14) / 100
        const ampY = (14 + random(`${seed}-${i}-ampy`) * 14) / 100
        const baseX = (25 + random(`${seed}-${i}-basex`) * 50) / 100
        const baseY = (25 + random(`${seed}-${i}-basey`) * 50) / 100

        // Drift the center as a fraction of the canvas, then to px. Cosine runs
        // at 0.8× the sine rate so x/y trace a slow Lissajous, not a circle.
        const fx = baseX + Math.sin(w + phase) * ampX
        const fy = baseY + Math.cos(w * 0.8 + phase) * ampY
        const cx = fx * width
        const cy = fy * height

        const transparent = toTransparent(color)

        // Two stops: solid `color` at the center fading to transparent at the
        // blob edge. The transparent tail is the LAST stop so the engine's
        // `Extend::Pad` doesn't fill the canvas-sized Rect opaque beyond the blob
        // (same reasoning as Spotlight). On CPU this collapses to the solid first
        // stop — hence the meaningful color leads.
        return (
          <Rect
            key={i}
            width={width}
            height={height}
            gradient={radialGradient([cx, cy], blobRadius, [
              { offset: 0, color },
              { offset: 1, color: transparent },
            ])}
          />
        )
      })}
    </Group>
  )
}
