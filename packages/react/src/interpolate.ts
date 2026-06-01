//! `interpolate` — map a value through input/output ranges, the workhorse for
//! frame-driven animation. Mirrors Remotion's API closely.

export type EasingFn = (t: number) => number

/** Easing presets (match `onda-animation`'s curves). Pass any `(t) => t` too. */
export const Easing = {
  linear: (t: number) => t,
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  easeInCubic: (t: number) => t ** 3,
  easeOutCubic: (t: number) => 1 - (1 - t) ** 3,
  easeInOutCubic: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  smoothStep: (t: number) => t * t * (3 - 2 * t),
} satisfies Record<string, EasingFn>

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
