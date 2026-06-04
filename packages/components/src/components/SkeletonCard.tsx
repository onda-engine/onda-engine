//! SkeletonCard — a loading-placeholder card: an optional thumbnail block plus a
//! stack of rounded bars, with a highlight band sweeping across them on a
//! frame-driven loop. The card rises in on the house spring. Ported from ondajs.
//!
//! The card has FIXED dimensions and is centered by computing its top-left origin
//! directly from the composition size — NOT via `<Flex>`/`<AbsoluteFill>`. The
//! shimmer band translates every frame and the card carries an entrance translate,
//! and the layout pass would both reflow on the moving band and clobber the rise
//! translate on a direct layout child. So every part is positioned by explicit
//! x/y inside one outer `<Group>` (which carries the rise + fade Motion), and the
//! placeholder bars/thumbnail sit at hand-computed y offsets.
//!
//! Shimmer: a card-sized `<Rect>` filled with a horizontal `linearGradient`
//! (transparent → `shimmerColor` → transparent) whose stop offsets slide
//! left→right on a `frame % shimmerSpeed` loop, clipped to the card's rounded
//! rect via `clipRect`. The bars also breathe with a gentle sine opacity pulse so
//! the placeholder reads "live" even on the CPU reference (see caveats).
//!
//! Approximations vs ondajs:
//!  - The glass `Surface` uses CSS `backdrop-filter: blur` + a drop shadow + a 1px
//!    top sheen; the engine has no backdrop blur or shadow, so the card is a flat
//!    translucent panel (the dark glass fill `#0e0e12` + a 1px border). No blur,
//!    no drop shadow, no top sheen overlay.
//!  - The moving-gradient sheen renders only on the Vello/GPU backend; the CPU
//!    reference collapses a gradient to its first stop (here transparent), so on
//!    CPU the sweep is invisible — the sine opacity pulse on the bars carries the
//!    "loading" liveliness there.

import { Group, Rect, clipRect, linearGradient, useCurrentFrame, useVideoConfig } from '@onda/react'
import { entryFadeRise } from '../choreography.js'
import { useTheme } from '../theme.js'

/** Deterministic bar widths as a fraction of the inner content width — a fixed
 *  repeating pattern keyed off the bar index (no PRNG; pure function of i). Reads
 *  as "real" placeholder copy: a full line, then progressively shorter, then
 *  back. Mirrors the ondajs `BAR_WIDTHS` percentages. */
const BAR_WIDTHS = [1, 0.92, 0.74, 0.85, 0.6]
const barWidthFrac = (i: number): number => BAR_WIDTHS[i % BAR_WIDTHS.length] ?? 1

export interface SkeletonCardProps {
  /** Number of placeholder text bars below the (optional) thumbnail. */
  lines?: number
  /** Show the leading thumbnail block above the bars. */
  thumbnail?: boolean
  /** Frames for one shimmer pass across the card. Lower = faster sweep. */
  shimmerSpeed?: number
  /** The travelling highlight color — a soft sheen over the bars (default: theme `border`). */
  shimmerColor?: string
  /** Resting fill of the placeholder bars / thumbnail (default: theme `surface`). */
  barColor?: string
  /** Card (panel) background — the translucent glass fill (default: theme `background`). */
  cardColor?: string
  /** Card border color (the 1px-equivalent stroke) (default: theme `border`). */
  borderColor?: string
  /** Frames before the card enters. */
  delay?: number
  /** Card width in px. */
  width?: number
  /** Card height in px. `undefined` sizes the card to its content. */
  height?: number
  /** Base bar height in px. */
  barHeight?: number
  /** Inner padding of the card in px. */
  padding?: number
}

export function SkeletonCard({
  lines = 3,
  thumbnail = true,
  shimmerSpeed = 48,
  shimmerColor: shimmerColorProp,
  barColor: barColorProp,
  cardColor: cardColorProp,
  borderColor: borderColorProp,
  delay = 0,
  width = 480,
  height,
  barHeight = 18,
  padding = 32,
}: SkeletonCardProps) {
  const frame = useCurrentFrame()
  const { fps, width: compWidth, height: compHeight } = useVideoConfig()
  const theme = useTheme()
  const shimmerColor = shimmerColorProp ?? theme.border
  // Resting bar fill. The theme `surface` (`#121217`) sits barely above the
  // canvas `background` (`#0a0d17`), so raw surface bars vanish on a dark scene.
  // Lift the *default* placeholder toward `text` so the card clearly reads as a
  // skeleton; an explicit `barColor` is always honored as-is.
  const barColor = barColorProp ?? mixHex(theme.surface, theme.text, 0.22)
  // The glass panel is the canvas background at ~80% alpha. Force `cc` onto a
  // 6-digit hex background; otherwise take the theme value as-is.
  const cardColor = cardColorProp ?? withGlassAlpha(theme.background)
  const borderColor = borderColorProp ?? theme.border
  // Shared corner radius for the card panel, thumbnail block, and clip mask.
  const cornerRadius = theme.radius

  const safeLines = Math.max(1, Math.floor(lines))
  const safeBarHeight = Math.max(1, barHeight)
  // Gap between bars, mirroring ondajs (`round(barHeight * 0.9)`).
  const gap = Math.round(safeBarHeight * 0.9)
  const thumbHeight = safeBarHeight * 6

  // Inner content box (card minus padding on both sides).
  const innerWidth = Math.max(0, width - padding * 2)

  // Total content height: optional thumbnail (+ its trailing gap) then the bar
  // stack (no trailing gap after the last bar).
  const barsHeight = safeBarHeight * safeLines + gap * Math.max(0, safeLines - 1)
  const contentHeight = thumbnail ? thumbHeight + gap + barsHeight : barsHeight

  // Card height: explicit, else sized to content + padding.
  const cardHeight = height ?? contentHeight + padding * 2

  // Entrance: rise + fade on the house spring (ondajs `useEntrance({type:'rise'})`).
  const motion = entryFadeRise({ frame, fps, delay })
  const local = frame - delay

  // Center the fixed-size card by computing its top-left directly — no layout
  // container (the moving band + rise translate would otherwise be clobbered /
  // cause reflow). The rise `y` is added on top of the centered origin.
  const originX = Math.round((compWidth - width) / 2)
  const originY = Math.round((compHeight - cardHeight) / 2)

  // The highlight band travels left → right on a continuous, seamless loop. Pure
  // function of the frame: normalize `local % shimmerSpeed` into [0, 1) (handles
  // negative frames inside a delayed Sequence), then slide the gradient's bright
  // center across [-0.5, 1.5] so it fully enters and exits the card each pass.
  const safeSpeed = Math.max(1, Math.floor(shimmerSpeed))
  const t = (((local % safeSpeed) + safeSpeed) % safeSpeed) / safeSpeed
  const center = -0.5 + t * 2 // ondajs: posX from -50% → 150%
  const band = 0.2 // half-width of the bright zone in gradient-offset units
  const lo = Math.max(0, Math.min(1, center - band))
  const mid = Math.max(0, Math.min(1, center))
  const hi = Math.max(0, Math.min(1, center + band))
  const transparent = toTransparent(shimmerColor)

  // A gentle sine opacity breath on the bars so the placeholder reads "loading"
  // even on the CPU backend (where the gradient sheen collapses away). Oscillates
  // ~0.7 → 1.0 over the same loop period — calm, never strobing.
  const pulse = 0.85 + 0.15 * Math.sin(t * Math.PI * 2 - Math.PI / 2)

  // Sheen offsets must be strictly increasing and within [0, 1] for a valid
  // gradient; if the band is fully off one edge the three clamp together — nudge
  // them apart by a hair, then clamp the ceiling back to 1.
  const o1 = lo
  const o2 = Math.min(1, Math.max(o1 + 0.0001, mid))
  const o3 = Math.min(1, Math.max(o2 + 0.0001, hi))

  return (
    <Group x={originX} y={originY + motion.y} opacity={motion.opacity}>
      {/* Glass panel: translucent fill + 1px border + a soft drop-shadow for
          elevation (ondajs's box-shadow; backdrop-blur stays a non-goal). */}
      <Rect
        x={0}
        y={0}
        width={width}
        height={cardHeight}
        cornerRadius={cornerRadius}
        fill={cardColor}
        stroke={borderColor}
        strokeWidth={1}
        shadow={{ color: '#00000059', blur: 28, offsetY: 12 }}
      />

      {/* Placeholder content, inset by the padding. */}
      <Group x={padding} y={padding}>
        {thumbnail ? (
          <Rect
            x={0}
            y={0}
            width={innerWidth}
            height={thumbHeight}
            cornerRadius={cornerRadius}
            fill={barColor}
            opacity={pulse}
          />
        ) : null}

        {Array.from({ length: safeLines }, (_, i) => {
          const barY = (thumbnail ? thumbHeight + gap : 0) + i * (safeBarHeight + gap)
          const w = Math.max(0, innerWidth * barWidthFrac(i))
          return (
            <Rect
              key={i}
              x={0}
              y={barY}
              width={w}
              height={safeBarHeight}
              cornerRadius={safeBarHeight / 2}
              fill={barColor}
              opacity={pulse}
            />
          )
        })}
      </Group>

      {/* Travelling sheen — a card-sized gradient band clipped to the rounded
          card, sliding left → right. GPU/Vello-only (CPU collapses to the first,
          transparent stop). Drawn last so it reads as a highlight over the bars. */}
      <Group clip={clipRect(width, cardHeight, cornerRadius)}>
        <Rect
          x={0}
          y={0}
          width={width}
          height={cardHeight}
          gradient={linearGradient(
            [0, cardHeight / 2],
            [width, cardHeight / 2],
            [
              { offset: o1, color: transparent },
              { offset: o2, color: shimmerColor },
              { offset: o3, color: transparent },
            ],
          )}
          opacity={0.5}
        />
      </Group>
    </Group>
  )
}

/** Return `color` with its alpha forced to `cc` (~80%) so the theme's opaque
 *  `background` reads as the translucent glass panel (the original `#0e0e12cc`).
 *  Only rewrites 6/3-digit hex; any other form (already-alpha hex, rgba, …) is
 *  returned untouched so an author-set translucent background is respected. */
function withGlassAlpha(color: string): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    if (hex.length === 6) {
      return `#${hex}cc`
    }
    if (hex.length === 3) {
      const r = hex[0] ?? '0'
      const g = hex[1] ?? '0'
      const b = hex[2] ?? '0'
      return `#${r}${r}${g}${g}${b}${b}cc`
    }
  }
  return color
}

/** Parse a hex color to an `[r, g, b]` triple (0..255); non-hex → black. */
function parseRgb(color: string): [number, number, number] {
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    if (hex.length === 3) {
      const r = hex[0] ?? '0'
      const g = hex[1] ?? '0'
      const b = hex[2] ?? '0'
      return [hx(`${r}${r}`), hx(`${g}${g}`), hx(`${b}${b}`)]
    }
    if (hex.length === 6 || hex.length === 8) {
      return [hx(hex.slice(0, 2)), hx(hex.slice(2, 4)), hx(hex.slice(4, 6))]
    }
  }
  return [0, 0, 0]
}

/** Parse a 2-char hex byte to 0..255, defaulting to 0. */
function hx(byte: string): number {
  const v = Number.parseInt(byte, 16)
  return Number.isNaN(v) ? 0 : v
}

/** Two-digit hex for a 0..255 channel. */
function toHexByte(v: number): string {
  const c = Math.max(0, Math.min(255, Math.round(v)))
  return c.toString(16).padStart(2, '0')
}

/** Straight sRGB lerp between two hex colors by `t` (0 = `a`, 1 = `b`). The
 *  engine has no `color-mix`; this is the closest faithful approximation. */
function mixHex(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t))
  const [ar, ag, ab] = parseRgb(a)
  const [br, bg, bb] = parseRgb(b)
  const r = ar + (br - ar) * k
  const g = ag + (bg - ag) * k
  const bl = ab + (bb - ab) * k
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(bl)}`
}

/** Return `color` with its alpha forced to `00` (fully transparent), preserving
 *  the RGB so the band fades to transparent rather than toward black. Mirrors the
 *  `Spotlight` helper. */
function toTransparent(color: string): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    if (hex.length === 6 || hex.length === 8) {
      return `#${hex.slice(0, 6)}00`
    }
    if (hex.length === 3) {
      const r = hex[0] ?? '0'
      const g = hex[1] ?? '0'
      const b = hex[2] ?? '0'
      return `#${r}${r}${g}${g}${b}${b}00`
    }
  }
  return '#00000000'
}
