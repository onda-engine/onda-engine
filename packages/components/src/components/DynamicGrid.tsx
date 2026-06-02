//! DynamicGrid — a technical grid that drifts diagonally, an optional centered
//! accent glow lifting the middle. A full-canvas atmosphere layer for
//! dashboard / data / dev scenes. Ported from ondajs (`dynamic-grid`).
//!
//! ondajs draws the grid with a single CSS background-image (a repeating
//! `linear-gradient` rule for `lines`, a `radial-gradient` dot lattice for
//! `dots`) tiled by `background-size: cell`, then translates the whole tile by
//! `-(frame * speed % cell)` on both axes so the drift loops by exactly one
//! cell — seamless and deterministic. The engine has no tiled background-image,
//! so the lattice is materialized as explicit scene primitives:
//!   - `lines`  → thin vertical + horizontal `<Rect>` rulings, one per cell line.
//!   - `dots`   → small round `<Ellipse>` dots at each lattice intersection
//!                (faithful to the CSS `radial-gradient circle`).
//! The lattice is over-drawn one cell beyond every edge (origin at `-cell`) and
//! the whole layer is `clip`ped to the canvas, reproducing ondajs's
//! `inset: -cell` + `overflow: hidden`: the drift never exposes an unpainted
//! edge and the off-canvas tail is masked. Layer transparency is applied via the
//! enclosing `<Group opacity>` (the scene equivalent of CSS layer `opacity`),
//! so `color` itself stays a flat hex.
//!
//! Pure function of frame: the only time input is `offset = (frame * speed) %
//! cell`, so the output is identical every cycle and deterministic across
//! renderers — no timers, no DOM measurement.
//!
//! Backend caveat: the `glow` is a scene `radialGradient`, which renders only on
//! the Vello/GPU backend. The CPU reference rasterizer collapses a gradient to
//! its first stop (the solid glow `color`), so the soft accent is a GPU-only
//! effect; the grid + background render identically on both backends.

import {
  Ellipse,
  Group,
  Rect,
  clipRect,
  radialGradient,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'

export interface DynamicGridProps {
  /** Cell size in px (the lattice pitch). */
  cell?: number
  /** Ruled lines or a dot lattice. */
  variant?: 'lines' | 'dots'
  /** Grid color (hex `#rrggbb` / `#rrggbbaa`). */
  color?: string
  /** Diagonal drift speed in px/frame. Negative drifts the other way. */
  speed?: number
  /** Grid opacity, 0..1 — a grid is scaffold, not subject. */
  opacity?: number
  /** Add a centered accent glow over the grid. */
  glow?: boolean
  /** Glow color (hex). The meaningful color on the CPU fallback (first stop). */
  glowColor?: string
  /** Canvas color painted behind the grid. */
  background?: string
  /** Stroke thickness (lines) / dot radius in px (dots). */
  thickness?: number
}

/** Hard ceiling on rulings/dots per axis, so a pathologically small `cell`
 *  can't explode the node count. At 4k width and the schema-min cell (4px) this
 *  caps a single axis well before then; normal cells stay far under it. */
const MAX_LINES_PER_AXIS = 600

/** Clamp `n` into `[lo, hi]`. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** Strip a leading `#` and any trailing alpha, yielding a 6-digit `rrggbb`. */
function rgbHex(color: string): string {
  let hex = color.startsWith('#') ? color.slice(1) : color
  if (hex.length === 3 || hex.length === 4) {
    const r = hex[0] ?? '0'
    const g = hex[1] ?? '0'
    const b = hex[2] ?? '0'
    hex = `${r}${r}${g}${g}${b}${b}`
  }
  return hex.slice(0, 6).padEnd(6, '0')
}

export function DynamicGrid({
  cell = 48,
  variant = 'lines',
  color = '#1c1c22',
  speed = 0.4,
  opacity = 0.6,
  glow = true,
  glowColor = '#d96b82',
  background = '#08080a',
  thickness = 1,
}: DynamicGridProps) {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

  // Guard the pitch: the schema mins `cell` at 4, but clamp defensively so a
  // zero/negative value can't divide-by-zero or invert the lattice.
  const pitch = Math.max(1, cell)

  // Diagonal drift, looping by exactly one cell. JS `%` can go negative for a
  // negative `speed`, so normalize into [0, pitch) — the tile is over-drawn one
  // cell beyond the top-left, so a positive `offset` reveals the lead cell.
  const offset = (((frame * speed) % pitch) + pitch) % pitch

  // Lattice spans from one cell before the top-left to one cell past the
  // bottom-right, so the diagonal translate never exposes an unpainted edge.
  const cols = clamp(Math.ceil(width / pitch) + 2, 1, MAX_LINES_PER_AXIS)
  const rows = clamp(Math.ceil(height / pitch) + 2, 1, MAX_LINES_PER_AXIS)

  // Over-drawn extents (one cell of bleed on each side), measured in the grid
  // layer's local space (its origin is the top-left corner before the drift
  // translate; the layer itself is shifted by -offset on both axes).
  const fieldWidth = (cols + 1) * pitch
  const fieldHeight = (rows + 1) * pitch

  const stroke = Math.max(0.5, thickness)
  const gridColor = `#${rgbHex(color)}`

  const cols1 = Array.from({ length: cols + 1 }, (_, i) => i)
  const rows1 = Array.from({ length: rows + 1 }, (_, i) => i)

  // Center the glow on the canvas; size it to the smaller dimension so it reads
  // the same across aspect ratios. ondajs uses `size=1`, opacity 0.22 (a
  // radius of ~60% of the smaller axis fading to transparent at 70%).
  const minDimension = Math.min(width, height)
  const glowRadius = 0.6 * minDimension
  const transparentGlow = `#${rgbHex(glowColor)}00`

  return (
    <Group>
      {/* Canvas backdrop. */}
      <Rect width={width} height={height} fill={`#${rgbHex(background)}`} />

      {/* Drifting lattice, clipped to the canvas and dimmed via layer opacity.
          The clip region starts at the layer origin (0,0), so the -cell bleed
          and the off-canvas tail are masked — only the canvas band shows. */}
      <Group opacity={clamp(opacity, 0, 1)} clip={clipRect(width, height)}>
        <Group x={-pitch - offset} y={-pitch - offset}>
          {variant === 'dots'
            ? // Dot lattice — a round dot at every intersection.
              rows1.flatMap((ri) =>
                cols1.map((ci) => (
                  <Ellipse
                    key={`d-${ri}-${ci}`}
                    x={ci * pitch - stroke}
                    y={ri * pitch - stroke}
                    width={stroke * 2}
                    height={stroke * 2}
                    fill={gridColor}
                  />
                )),
              )
            : // Ruled grid — full-length vertical + horizontal rulings.
              [
                ...cols1.map((ci) => (
                  <Rect
                    key={`v-${ci}`}
                    x={ci * pitch}
                    y={0}
                    width={stroke}
                    height={fieldHeight}
                    fill={gridColor}
                  />
                )),
                ...rows1.map((ri) => (
                  <Rect
                    key={`h-${ri}`}
                    x={0}
                    y={ri * pitch}
                    width={fieldWidth}
                    height={stroke}
                    fill={gridColor}
                  />
                )),
              ]}
        </Group>
      </Group>

      {/* Centered accent glow (Vello-only; see header). First stop is the solid
          glow color so the CPU fallback still shows the accent. The transparent
          tail is the final stop so the canvas-sized Rect stays clear at the
          edges (the engine pads the last gradient stop outward). */}
      {glow ? (
        <Rect
          width={width}
          height={height}
          opacity={0.22}
          gradient={radialGradient([width / 2, height / 2], glowRadius, [
            { offset: 0, color: `#${rgbHex(glowColor)}` },
            { offset: 0.7, color: transparentGlow },
            { offset: 1, color: transparentGlow },
          ])}
        />
      ) : null}
    </Group>
  )
}
