//! `interpolate` — map a value through input/output ranges, the workhorse for
//! frame-driven animation. Mirrors Remotion's API closely.

export type EasingFn = (t: number) => number

/** Easing presets + factories. Remotion-compatible: use a preset as an `EasingFn`
 *  (`Easing.linear`, `Easing.cubic`, …) or call the `Easing.bezier(x1,y1,x2,y2)`
 *  factory. The Remotion-named curves (`quad`/`cubic`/`sin`/`ease`/`bezier`) exist
 *  so components authored against Remotion port without rewriting their easing. */
export const Easing = {
  linear: (t: number) => t,
  // Remotion-named curves (drop-in for `Easing.quad`/`.cubic`/`.sin`/`.ease`).
  quad: (t: number) => t * t,
  cubic: (t: number) => t * t * t,
  sin: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  ease: cubicBezier(0.42, 0, 1, 1),
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  easeInCubic: (t: number) => t ** 3,
  easeOutCubic: (t: number) => 1 - (1 - t) ** 3,
  easeInOutCubic: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  smoothStep: (t: number) => t * t * (3 - 2 * t),
  easeInBack: (t: number) => 2.70158 * t ** 3 - 1.70158 * t ** 2,
  easeOutBack: (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  /** CSS cubic-bézier factory — Remotion's `Easing.bezier(x1,y1,x2,y2)`. */
  bezier: (x1: number, y1: number, x2: number, y2: number): EasingFn => cubicBezier(x1, y1, x2, y2),
}

/** A CSS-style cubic-bézier ease with control points `(x1,y1)`, `(x2,y2)` and
 *  fixed endpoints `(0,0)`–`(1,1)`. Matches `onda-animation`'s `CubicBezier`. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
  const comp = (c1: number, c2: number, s: number) => {
    const u = 1 - s
    return 3 * u * u * s * c1 + 3 * u * s * s * c2 + s * s * s
  }
  const deriv = (c1: number, c2: number, s: number) => {
    const u = 1 - s
    return 3 * u * u * c1 + 6 * u * s * (c2 - c1) + 3 * s * s * (1 - c2)
  }
  return (x: number) => {
    let s = x
    for (let i = 0; i < 8; i++) {
      const dx = comp(x1, x2, s) - x
      if (Math.abs(dx) < 1e-5) break
      const d = deriv(x1, x2, s)
      if (Math.abs(d) < 1e-6) break
      s -= dx / d
    }
    return comp(y1, y2, Math.min(1, Math.max(0, s)))
  }
}

export interface InterpolateOptions {
  easing?: EasingFn
  /** How to handle inputs below the range. Default `'clamp'`. */
  extrapolateLeft?: 'clamp' | 'extend'
  /** How to handle inputs above the range. Default `'clamp'`. */
  extrapolateRight?: 'clamp' | 'extend'
}

/**
 * Map `input` from `inputRange` to `outputRange` (both ascending, equal length
 * ≥ 2). Out-of-range inputs clamp by default. Example:
 * `interpolate(frame, [0, 30], [0, 1])` fades in over 30 frames.
 */
export function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  options: InterpolateOptions = {},
): number {
  if (inputRange.length < 2 || inputRange.length !== outputRange.length) {
    throw new Error('interpolate: inputRange and outputRange must be the same length (>= 2)')
  }
  const { easing = Easing.linear, extrapolateLeft = 'clamp', extrapolateRight = 'clamp' } = options
  const last = inputRange.length - 1

  if (input <= at(inputRange, 0)) {
    if (extrapolateLeft === 'clamp') return at(outputRange, 0)
    return segment(input, inputRange, outputRange, 0, easing)
  }
  if (input >= at(inputRange, last)) {
    if (extrapolateRight === 'clamp') return at(outputRange, last)
    return segment(input, inputRange, outputRange, last - 1, easing)
  }

  let i = 0
  while (i < last - 1 && input >= at(inputRange, i + 1)) i++
  return segment(input, inputRange, outputRange, i, easing)
}

/** Read `arr[i]` as a number; throws if out of range (keeps the type honest
 *  under `noUncheckedIndexedAccess` without non-null assertions). */
function at(arr: readonly number[], i: number): number {
  const value = arr[i]
  if (value === undefined) throw new Error(`interpolate: index ${i} out of range`)
  return value
}

/** Interpolate within the segment starting at index `i`. */
function segment(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  i: number,
  easing: EasingFn,
): number {
  const x0 = at(inputRange, i)
  const x1 = at(inputRange, i + 1)
  const y0 = at(outputRange, i)
  const y1 = at(outputRange, i + 1)
  const span = x1 - x0
  const t = span === 0 ? 0 : (input - x0) / span
  return y0 + (y1 - y0) * easing(t)
}
