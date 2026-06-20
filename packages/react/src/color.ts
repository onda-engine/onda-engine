import { type InterpolateOptions, interpolate } from './interpolate.js'
import type { Color } from './scene.js'

/** A color as a hex string (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`) or an
 *  explicit 0..1 {@link Color}. */
export type ColorInput = string | Color

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** A missing / unparseable color degrades to TRANSPARENT — the renderer must NEVER hard-crash a
 *  whole frame over one bad color value (one stray `'white'` or `'accent'` used to throw and kill
 *  the entire still). Degrade + warn so the defect is visible without taking the render down. */
const TRANSPARENT: Color = { r: 0, g: 0, b: 0, a: 0 }

/** Common CSS named colors → hex. NOT the full 140 — the ones a brief / template / preview path
 *  plausibly emits. Anything outside this set + the rgb()/hsl() parsers degrades to transparent. */
const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  pink: '#ffc0cb',
  gray: '#808080',
  grey: '#808080',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  brown: '#a52a2a',
  navy: '#000080',
  teal: '#008080',
  lime: '#00ff00',
  silver: '#c0c0c0',
  gold: '#ffd700',
  maroon: '#800000',
  olive: '#808000',
  aqua: '#00ffff',
  fuchsia: '#ff00ff',
  indigo: '#4b0082',
  violet: '#ee82ee',
  beige: '#f5f5dc',
  coral: '#ff7f50',
  crimson: '#dc143c',
  khaki: '#f0e68c',
  salmon: '#fa8072',
  turquoise: '#40e0d0',
  tan: '#d2b48c',
  ivory: '#fffff0',
  lavender: '#e6e6fa',
  mint: '#98ff98',
}

/** Hex (`#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`) → Color, or null if not valid hex. */
function hexToColor(input: string): Color | null {
  let hex = input.trim().replace(/^#/, '')
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if ((hex.length !== 6 && hex.length !== 8) || !/^[0-9a-fA-F]+$/.test(hex)) return null
  const channel = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16) / 255
  const color: Color = { r: channel(0), g: channel(2), b: channel(4) }
  if (hex.length === 8) color.a = channel(6)
  return color
}

const hslToColor = (hDeg: number, sPct: number, lPct: number, a: number): Color => {
  const s = sPct / 100
  const l = lPct / 100
  const k = (n: number) => (n + hDeg / 30) % 12
  const f = (n: number) =>
    clamp01(l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))
  return { r: f(0), g: f(8), b: f(4), ...(a < 1 ? { a } : {}) }
}

/** Parse common CSS forms (named, `rgb()/rgba()`, `hsl()/hsla()`) → Color, else null. */
function cssToColor(input: string): Color | null {
  const s = input.trim().toLowerCase()
  const named = NAMED_COLORS[s]
  if (named) return hexToColor(named)
  const parts = (body: string | undefined): string[] =>
    (body ?? '').split(/[\s,/]+/).filter(Boolean)
  const alpha = (v: string | undefined) =>
    v === undefined
      ? 1
      : clamp01(v.endsWith('%') ? Number.parseFloat(v) / 100 : Number.parseFloat(v))
  const rgb = s.match(/^rgba?\(([^)]+)\)$/)
  if (rgb) {
    const [r, g, b, a] = parts(rgb[1])
    if (r !== undefined && g !== undefined && b !== undefined)
      return {
        r: clamp01(Number.parseFloat(r) / 255),
        g: clamp01(Number.parseFloat(g) / 255),
        b: clamp01(Number.parseFloat(b) / 255),
        ...(alpha(a) < 1 ? { a: alpha(a) } : {}),
      }
  }
  const hsl = s.match(/^hsla?\(([^)]+)\)$/)
  if (hsl) {
    const [h, sat, light, a] = parts(hsl[1])
    if (h !== undefined && sat !== undefined && light !== undefined)
      return hslToColor(
        Number.parseFloat(h),
        Number.parseFloat(sat),
        Number.parseFloat(light),
        alpha(a),
      )
  }
  return null
}

/** Normalize a {@link ColorInput} into the engine's 0..1 sRGB {@link Color}. Tolerant by design —
 *  parses hex, common named colors, and `rgb()/hsl()`; anything else degrades to transparent (with
 *  a warning) rather than throwing, so one bad value never crashes the render. */
export function parseColor(input: ColorInput): Color {
  // CSS keywords — common footgun: `fill: 'none'` should be transparent, not a crash.
  if (input === 'none' || input === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (typeof input !== 'string') {
    // Object form: must be a real {r,g,b} color. A non-color value (boolean, null, array, partial
    // object) would produce a scene node missing channels and fail deep in the Rust deserializer
    // (`missing field r`) — degrade to transparent + warn here instead of crashing.
    if (
      input == null ||
      typeof input !== 'object' ||
      typeof (input as Color).r !== 'number' ||
      typeof (input as Color).g !== 'number' ||
      typeof (input as Color).b !== 'number'
    ) {
      console.warn(
        `onda: invalid color ${JSON.stringify(input)} — expected a hex string or a {r,g,b} object; using transparent.`,
      )
      return { ...TRANSPARENT }
    }
    return { r: input.r, g: input.g, b: input.b, ...(input.a !== undefined ? { a: input.a } : {}) }
  }

  const hex = hexToColor(input)
  if (hex) return hex
  const css = cssToColor(input)
  if (css) return css
  // NEVER throw — a stray color string must not take down the whole still.
  console.warn(
    `onda: unrecognized color '${input}' — using transparent. Supply hex (#rrggbb), rgb()/hsl(), or a common name.`,
  )
  return { ...TRANSPARENT }
}
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
