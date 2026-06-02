import { type InterpolateOptions, interpolate } from './interpolate.js'
import type { Color } from './scene.js'

/** A color as a hex string (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`) or an
 *  explicit 0..1 {@link Color}. */
export type ColorInput = string | Color

/** Normalize a {@link ColorInput} into the engine's 0..1 sRGB {@link Color}. */
export function parseColor(input: ColorInput): Color {
  if (typeof input !== 'string') {
    return { r: input.r, g: input.g, b: input.b, ...(input.a !== undefined ? { a: input.a } : {}) }
  }

  let hex = input.trim().replace(/^#/, '')
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if ((hex.length !== 6 && hex.length !== 8) || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`invalid color '${input}': expected #rgb, #rgba, #rrggbb, or #rrggbbaa`)
  }

  const channel = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16) / 255
  const color: Color = { r: channel(0), g: channel(2), b: channel(4) }
  if (hex.length === 8) color.a = channel(6)
  return color
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const toHex = (v: number): string =>
  Math.round(clamp01(v) * 255)
    .toString(16)
    .padStart(2, '0')

/**
 * Interpolate between colors — like {@link interpolate}, but each output is a
 * {@link ColorInput}. Channels are mixed in 0..1 sRGB and returned as a hex
 * string (`#rrggbb`, or `#rrggbbaa` when any stop has alpha). Out-of-range
 * inputs clamp by default. Mirrors Remotion's `interpolateColors`.
 *
 * @example `interpolateColors(frame, [0, 30], ['#d96b82', '#2974f2'])`
 */
export function interpolateColors(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly ColorInput[],
  options: InterpolateOptions = {},
): string {
  const colors = outputRange.map(parseColor)
  const mix = (sel: (c: Color) => number) =>
    interpolate(input, inputRange, colors.map(sel), options)
  const hasAlpha = colors.some((c) => c.a !== undefined && c.a < 1)
  const rgb = `${toHex(mix((c) => c.r))}${toHex(mix((c) => c.g))}${toHex(mix((c) => c.b))}`
  return `#${rgb}${hasAlpha ? toHex(mix((c) => c.a ?? 1)) : ''}`
}
