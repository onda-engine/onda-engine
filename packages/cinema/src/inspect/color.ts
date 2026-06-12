//! WCAG color math — hex parsing, relative luminance, contrast ratio.
//!
//! Formulas from WCAG 2.x: relative luminance per
//! https://www.w3.org/WAI/GL/wiki/Relative_luminance (sRGB linearization), and
//! contrast ratio `(L1 + 0.05) / (L2 + 0.05)` per
//! https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum (SC 1.4.3).
//! Engine colors are hex (`#rgb`, `#rrggbb`, `#rrggbbaa`) — anything else is
//! "unparseable" and the caller treats the contrast as unverifiable.

/** An sRGB color, channels 0..1. */
export interface Rgb {
  r: number
  g: number
  b: number
  /** Alpha 0..1 (1 when the hex had no alpha channel). */
  a: number
}

/** Parse `#rgb` / `#rrggbb` / `#rrggbbaa` (case-insensitive). Null otherwise. */
export function parseColor(value: unknown): Rgb | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (!s.startsWith('#')) return null
  const hex = s.slice(1)
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null
  if (hex.length === 3) {
    const [r, g, b] = hex
    return {
      r: Number.parseInt(`${r}${r}`, 16) / 255,
      g: Number.parseInt(`${g}${g}`, 16) / 255,
      b: Number.parseInt(`${b}${b}`, 16) / 255,
      a: 1,
    }
  }
  if (hex.length === 6 || hex.length === 8) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16) / 255,
      g: Number.parseInt(hex.slice(2, 4), 16) / 255,
      b: Number.parseInt(hex.slice(4, 6), 16) / 255,
      a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
    }
  }
  return null
}

// sRGB channel → linear-light (the WCAG piecewise curve).
const linearize = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/** WCAG relative luminance of an sRGB color (0 = black, 1 = white). */
export function relativeLuminance(c: Rgb): number {
  return 0.2126 * linearize(c.r) + 0.7152 * linearize(c.g) + 0.0722 * linearize(c.b)
}

/** WCAG contrast ratio between two colors — 1:1 (identical) to 21:1 (B/W). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}
