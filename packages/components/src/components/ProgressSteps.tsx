//! ProgressSteps — a horizontal stepper whose fill travels to the `current` step
//! on the house spring. Completed dots and the connecting track earn the accent;
//! pending steps stay neutral. The active step gets a soft glow ring. Ported from
//! ondajs (`progress-steps`).
//!
//! Geometry is FIXED and laid out by explicit x/y inside a single centered
//! `<Group>` — NOT a `<Flex>`. The connector "fill" grows left-to-right every
//! frame (an animated width), so a layout container would reflow/jiggle as the
//! measured bbox changed (same reasoning as BarChart). Dots are equal-spaced
//! across `width`; each connector is the gap between adjacent dots.
//!
//! Scene caveats / approximations vs ondajs:
//! - color-mix: ondajs blends the dot color with CSS `color-mix(in srgb, accent
//!   on%, dim)`. The engine has no color-mix, so the dot color is computed by a
//!   straight sRGB hex lerp between `dimColor` and `accentColor` by `on` — a
//!   close visual match (gamma differences aside).
//! - box-shadow glow: ondajs draws the active-step glow with a CSS `box-shadow`
//!   blur, which the engine can't do. It is approximated by a larger, low-alpha
//!   accent `<Ellipse>` drawn UNDER the active dot (a hard-edged halo, not a
//!   blurred one). It scales about its own center via a nested `<Group>` whose
//!   origin sits at the dot center (scene scale pivots on the local origin).

import { Ellipse, Group, Rect, Text, interpolate, useVideoConfig } from '@onda/react'
import { useSpringValue } from '../hooks.js'
import { DURATION } from '../motion.js'

export interface ProgressStepsProps {
  /** Step labels, left to right. */
  steps?: string[]
  /** How many steps are complete — the fill animates to this index (0-based count). */
  current?: number
  /** Frames before the fill animates. */
  delay?: number
  /** Frames for the fill to travel to `current`. */
  duration?: number
  /** Completed / active color — the earned accent (Onda rose). */
  accentColor?: string
  /** Pending color (dots + connector track). */
  dimColor?: string
  /** Label color. */
  labelColor?: string
  /** Loaded font family for labels. */
  fontFamily?: string
  /** Label font size in px. */
  fontSize?: number
  /** Overall width in px (dots are spaced across this). */
  width?: number
  /** Dot diameter in px. */
  dotSize?: number
  /** Connector track thickness in px. */
  trackThickness?: number
}

const DEFAULT_STEPS = ['Plan', 'Build', 'Render', 'Ship']

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export function ProgressSteps({
  steps = DEFAULT_STEPS,
  current = 2,
  delay = 0,
  duration = DURATION.slower,
  accentColor = '#d96b82',
  dimColor = '#26262e',
  labelColor = '#8e8e98',
  fontFamily,
  fontSize = 34,
  width = 1280,
  dotSize = 30,
  trackThickness = 3,
}: ProgressStepsProps) {
  const { width: compWidth, height: compHeight } = useVideoConfig()

  // House spring (SPRING_SMOOTH, no overshoot), matching ondajs's useSpringValue.
  const p = useSpringValue({ delay, durationInFrames: duration })
  const filled = p * current // 0..current, animated

  const n = steps.length
  const radius = dotSize / 2

  // Equal-spaced dot centers across `width`: first dot center at radius, last at
  // width - radius. With a single step the dot sits at the left (matches a row).
  const stepX = (i: number): number => {
    if (n <= 1) return radius
    return radius + (i * (width - dotSize)) / (n - 1)
  }

  // Label band sits below the dots; reserve room for one text line.
  const labelTop = dotSize + 16
  const rowHeight = labelTop + fontSize

  // Center the fixed-size stepper on the composition by computing its top-left
  // directly — no layout container, so the per-frame connector growth never
  // triggers a reflow.
  const originX = Math.round((compWidth - width) / 2)
  const originY = Math.round((compHeight - rowHeight) / 2)

  return (
    <Group x={originX} y={originY}>
      {/* Connectors first, so the dots paint over their ends. */}
      {steps.map((_, i) => {
        if (i >= n - 1) return null
        const x0 = stepX(i) + radius // right edge of dot i
        const x1 = stepX(i + 1) - radius // left edge of dot i+1
        const segWidth = Math.max(0, x1 - x0)
        if (segWidth <= 0) return null

        const connector = interpolate(filled, [i, i + 1], [0, 1], CLAMP)
        const fillWidth = segWidth * Math.max(0, Math.min(1, connector))
        const trackY = radius - trackThickness / 2

        return (
          <Group key={`seg-${i}`} y={trackY}>
            {/* Dim track. */}
            <Rect x={x0} y={0} width={segWidth} height={trackThickness} fill={dimColor} />
            {/* Accent fill grown left-to-right from the track's left end. */}
            {fillWidth > 0 ? (
              <Rect x={x0} y={0} width={fillWidth} height={trackThickness} fill={accentColor} />
            ) : null}
          </Group>
        )
      })}

      {/* Dots + labels. */}
      {steps.map((label, i) => {
        const on = interpolate(filled, [i - 0.5, i], [0, 1], CLAMP)
        const cx = stepX(i)
        const cy = radius
        const dotColor = mixHex(dimColor, accentColor, on)

        // Glow approximation: a low-alpha accent halo under the active dot,
        // appearing past 60% activation and scaling up as `on` climbs. Centered
        // on the dot via a nested origin at the dot center (scale pivots on the
        // local origin).
        const glow = Math.max(0, (on - 0.6) / 0.4) // 0..1 once on > 0.6
        const glowScale = 1 + glow * 1.4
        const glowAlpha = glow * 0.35
        const glowColor = withAlpha(accentColor, glowAlpha)

        // Label opacity: 0.5 → 1.0 as the step activates (ondajs `0.5 + on*0.5`).
        const labelOpacity = 0.5 + on * 0.5

        return (
          <Group key={`step-${i}`}>
            {/* Dot center as the local origin so the halo scales about its middle. */}
            <Group x={cx} y={cy}>
              {glowAlpha > 0.001 ? (
                <Ellipse
                  x={-radius}
                  y={-radius}
                  width={dotSize}
                  height={dotSize}
                  fill={glowColor}
                  scaleX={glowScale}
                  scaleY={glowScale}
                />
              ) : null}
              <Ellipse x={-radius} y={-radius} width={dotSize} height={dotSize} fill={dotColor} />
            </Group>

            {/* Label beneath the dot. The engine measures text from its own
                left origin (no center-align), so labels read left-aligned at
                each dot's left edge — see approximations. */}
            <Text
              x={cx - radius}
              y={labelTop}
              fontSize={fontSize}
              color={labelColor}
              fontFamily={fontFamily}
              opacity={labelOpacity}
            >
              {label}
            </Text>
          </Group>
        )
      })}
    </Group>
  )
}

/** Parse a `#rgb` / `#rrggbb` / `#rrggbbaa` hex into [r, g, b] (0..255). Alpha is
 *  dropped. Returns black for unrecognized input. */
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

/** Return `color`'s RGB with the given alpha (0..1) as `#rrggbbaa`. */
function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = parseRgb(color)
  const a = Math.max(0, Math.min(1, alpha)) * 255
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}${toHexByte(a)}`
}
