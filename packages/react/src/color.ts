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
