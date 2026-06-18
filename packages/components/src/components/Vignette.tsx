//! Vignette — a static cinematic darkening at the canvas edges that pulls the
//! eye toward the center. Ported from ondajs.
//!
//! Atmospheric layer, no motion: the output is identical on every frame, so the
//! component never reads `useCurrentFrame` and is deterministic by construction.
//!
//! Engine note: ondajs renders a CSS `radial-gradient(ellipse at center, …)` —
//! an *ellipse* matched to the (non-square) canvas, where all four corners reach
//! full darkness together (CSS `farthest-corner`). The scene `radialGradient` is
//! *circular* (one radius), so we size it to the half-diagonal
//! (`hypot(W, H) / 2`) so the corners still land exactly at offset 1; on a
//! non-square canvas the edge *midpoints* therefore stay a little lighter than
//! CSS's aspect-matched ellipse would draw them. Intensity is baked into the
//! edge stop's alpha rather than applied as a layer opacity (the engine
//! equivalent, since scene nodes have no separate compositing-layer opacity).

import { Rect, radialGradient, useVideoConfig } from '@onda-engine/react'
import { useTheme } from '../theme.js'

export interface VignetteProps {
  /** Edge darkness. `0` = no vignette, `1` = fully dark edges. Default `0.5`. */
  intensity?: number
  /**
   * Percent (0..100) from center where the darkening begins. Larger = bigger
   * clean middle. Default `40`.
   */
  innerRadius?: number
  /** Edge color. Defaults to pure black for the classic cinematic frame (default: theme `background`). */
  color?: string
}

/** Clamp `n` into `[lo, hi]`. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** Strip a leading `#` and any trailing alpha, yielding a 6-digit `rrggbb`. */
function rgbHex(color: string): string {
  let hex = color.startsWith('#') ? color.slice(1) : color
  if (hex.length === 3) {
    // Expand `rgb` → `rrggbb`.
    const r = hex[0] ?? '0'
    const g = hex[1] ?? '0'
    const b = hex[2] ?? '0'
    hex = `${r}${r}${g}${g}${b}${b}`
  } else if (hex.length === 4) {
    const r = hex[0] ?? '0'
    const g = hex[1] ?? '0'
    const b = hex[2] ?? '0'
    hex = `${r}${r}${g}${g}${b}${b}`
  }
  return hex.slice(0, 6).padEnd(6, '0')
}

/** A 0..1 alpha as a 2-digit hex channel. */
function alphaHex(a: number): string {
  return clamp(Math.round(a * 255), 0, 255)
    .toString(16)
    .padStart(2, '0')
}

export function Vignette({ intensity = 0.5, innerRadius = 40, color: colorProp }: VignetteProps) {
  const { width, height } = useVideoConfig()
  const theme = useTheme()
  const color = colorProp ?? theme.background

  // The clean center ends where the gradient starts darkening.
  const innerOffset = clamp(innerRadius, 0, 100) / 100
  // Half-diagonal: a circular radius that reaches the canvas corners exactly at
  // offset 1, matching CSS `radial-gradient(ellipse at center, … farthest-corner)`.
  const radius = Math.hypot(width, height) / 2

  const edge = `#${rgbHex(color)}${alphaHex(clamp(intensity, 0, 1))}`
  const clear = `#${rgbHex(color)}00`

  return (
    <Rect
      width={width}
      height={height}
      gradient={radialGradient([width / 2, height / 2], radius, [
        { offset: 0, color: clear },
        { offset: innerOffset, color: clear },
        { offset: 1, color: edge },
      ])}
    />
  )
}
