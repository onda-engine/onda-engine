//! GrainOverlay — a film-grain texture layered over the whole canvas. Ported
//! from ondajs.
//!
//! Real grain: a full-canvas procedural-noise `<Image>` (the engine's
//! `onda-noise://` source — deterministic per-pixel gray noise centred on the
//! neutral value) composited with a `mix-blend-mode: overlay`, so it MODULATES
//! the luminance of everything beneath it — exactly what ondajs's SVG
//! `feTurbulence` + overlay did. `baseFrequency` sets the grain's fineness (the
//! noise resolution), `numOctaves` its contrast, `opacity` its strength, and
//! `seed` the deterministic field; with `animate` on, the seed advances on a
//! frame bucket so the grain shimmers without flickering every frame.
//!
//! Rendered on the GPU (Vello): the overlay blend is a vector-backend feature, so
//! grain is `gpu_only` (the CPU reference composites the noise src-over).

import { Image, useCurrentFrame, useVideoConfig } from '@onda/react'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

export interface GrainOverlayProps {
  /** Grain strength (peak luminance deviation). Capped at `0.15` to match the
   *  house 2–15% range (ondajs caps grain at ~2–4%). Default `0.05`. */
  opacity?: number
  /** Grain fineness: higher = finer, tighter speckle (noise nearer full
   *  resolution); lower = coarser photo-grain (a lower-res field, upscaled).
   *  Default `0.9`. */
  baseFrequency?: number
  /** Grain contrast: widens the deviation so the texture gains punch. Clamped to
   *  `1..4` like ondajs. Default `1`. */
  numOctaves?: number
  /** Deterministic variation — the same seed always produces the same grain. Default `0`. */
  seed?: number
  /** When `true`, the field re-seeds on a frame bucket so the grain shimmers. Off
   *  by default — ondajs grain is intentionally static set-dressing. */
  animate?: boolean
  /** Frames per re-seed bucket when `animate` is on. Lower = busier. Default `2`. */
  animateEvery?: TimeInput
  /** @deprecated The grain is now a continuous per-pixel field, not scattered
   *  dots — `count` no longer applies. Accepted for compat. */
  count?: number
  /** @deprecated Grain is monochrome luminance noise (overlay-blended), so a
   *  colour no longer applies. Accepted for compat. */
  color?: string
}

/** Clamp `n` into `[lo, hi]`. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function GrainOverlay({
  opacity = 0.05,
  baseFrequency = 0.9,
  numOctaves = 1,
  seed = 0,
  animate = false,
  animateEvery: animateEveryIn = 2,
}: GrainOverlayProps) {
  const { width, height, fps } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const animateEvery = framesOf(animateEveryIn, fps)
  const frame = useCurrentFrame()
  // Touch the theme so the hook order stays stable with the other components.
  useTheme()

  const layerOpacity = clamp(opacity, 0, 0.15)
  const octaves = clamp(Math.round(numOctaves), 1, 4)
  // Strength = the capped opacity, lifted a little by contrast (octaves).
  const intensity = clamp(layerOpacity * (1 + (octaves - 1) * 0.35), 0, 0.6)

  // Frame bucket: constant when static (every frame identical), advancing in
  // steps when animating so the grain shimmers without flickering each frame.
  const bucket = animate ? Math.floor(frame / Math.max(1, animateEvery)) : 0
  const noiseSeed = seed * 1000 + bucket

  // Fineness → noise resolution. Higher frequency = closer to full res (finest
  // speckle); lower = a smaller field, upscaled (coarse photo-grain).
  const scale = clamp(0.4 + baseFrequency * 0.6, 0.3, 1)
  const nw = Math.max(2, Math.round(width * scale))
  const nh = Math.max(2, Math.round(height * scale))

  return (
    <Image
      src={`onda-noise://w=${nw}&h=${nh}&seed=${noiseSeed}&intensity=${intensity.toFixed(4)}&mono=1`}
      width={width}
      height={height}
      fit="fill"
      blendMode="overlay"
    />
  )
}
