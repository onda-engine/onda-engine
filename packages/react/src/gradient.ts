//! Author-facing gradient inputs, normalized into the engine's {@link Gradient}.

import { type ColorInput, parseColor } from './color.js'
import type { Gradient, Vec2 } from './scene.js'

/** A point as an `{ x, y }` or a `[x, y]` tuple. */
export type Point = Vec2 | [number, number]

/** A color stop: a color at a normalized position 0..1 along the gradient. */
export interface GradientStopInput {
  offset: number
  color: ColorInput
}

/** A gradient as authored: hex/`Color` stops and tuple-or-`Vec2` points. */
export type GradientInput =
  | { type: 'linear'; start: Point; end: Point; stops: GradientStopInput[] }
  | { type: 'radial'; center: Point; radius: number; stops: GradientStopInput[] }
  | {
      /** Fractal-noise ("expensive") gradient — fBm over Simplex noise. The field
       *  value 0..1 samples the stops; `scale` ~0.8–1.2 + `warp` ~0.4–0.6 gives the
       *  soft Stripe/Linear register (higher = busier turbulence). Animate `time`
       *  per frame for a living gradient. Rendered natively (full quality on
       *  `onda export`); the browser preview degrades to a smooth gradient. */
      type: 'fbm'
      stops: GradientStopInput[]
      scale?: number
      time?: number
      warp?: number
    }

function toVec2(point: Point): Vec2 {
  return Array.isArray(point) ? { x: point[0], y: point[1] } : point
}

function stops(input: GradientStopInput[]): Gradient['stops'] {
  return input.map((s) => ({ offset: s.offset, color: parseColor(s.color) }))
}

/** Normalize a {@link GradientInput} into the engine's {@link Gradient} JSON. */
export function parseGradient(input: GradientInput): Gradient {
  if (input.type === 'linear') {
    return {
      gradient: 'linear',
      start: toVec2(input.start),
      end: toVec2(input.end),
      stops: stops(input.stops),
    }
  }
  if (input.type === 'fbm') {
    return {
      gradient: 'fbm',
      stops: stops(input.stops),
      scale: input.scale ?? 1.0,
      time: input.time ?? 0,
      warp: input.warp ?? 0.5,
    }
  }
  return {
    gradient: 'radial',
    center: toVec2(input.center),
    radius: input.radius,
    stops: stops(input.stops),
  }
}

/** Build a linear gradient input from two points and color stops. */
export function linearGradient(
  start: Point,
  end: Point,
  stops: GradientStopInput[],
): GradientInput {
  return { type: 'linear', start, end, stops }
}

/** Build a radial gradient input from a center, radius, and color stops. */
export function radialGradient(
  center: Point,
  radius: number,
  stops: GradientStopInput[],
): GradientInput {
  return { type: 'radial', center, radius, stops }
}

/** Build an fBm fractal-noise ("expensive") gradient — the soft, flowing
 *  Stripe/Linear backdrop. `scale` ~0.8–1.2 + `warp` ~0.4–0.6 reads premium;
 *  animate `time` (e.g. `frame / fps * speed`) for a living gradient. */
export function fbmGradient(
  stops: GradientStopInput[],
  opts: { scale?: number; time?: number; warp?: number } = {},
): GradientInput {
  return { type: 'fbm', stops, ...opts }
}
