//! NodeGraph — a hub-and-spoke constellation: a labeled central hub with
//! satellite nodes that fly in from off-frame, settle into elliptical orbits,
//! and connect to the hub by lines that periodically light up. Ported from
//! ondajs (`node-graph`).
//!
//! Everything is a pure function of `useCurrentFrame()` and a seed (§1). The
//! seeded fly-in directions and connection-pulse phases are reproduced with
//! `random('${seed}-...')` sub-seeds — `@onda/react`'s `random` returns one
//! value per seed (not a stateful generator like ondajs's `seededRandom`), so
//! each draw gets a distinct, stable sub-seed in the same fixed order.
//!
//! Layout: the constellation is centered on a single anchor Group (no `<Flex>`)
//! — node positions drift every frame, and a layout container would reflow as
//! the measured bbox moved. Connection lines, the glow, the satellites, and the
//! hub are all placed by explicit x/y in that anchor's local space, with the
//! hub at the origin (0,0).
//!
//! Pivot caveat (§3): the hub's scale-rise scales about the node's LOCAL
//! origin, so the hub disc is offset by -radius and wrapped in a Group that
//! marks its center, making the growth read as centered.
//!
//! Approximations (engine has no CSS): the hub's `box-shadow`/`border` glow and
//! the soft accent `Glow` become a radial-gradient `<Ellipse>` halo behind the
//! hub; satellite pill `box-shadow` and `letter-spacing` are dropped (no engine
//! equivalent). ondajs's `placement` region + `hubSize` semantic-size tokens
//! collapse to plain `centerX`/`centerY` canvas fractions and a px `hubFontSize`.
//! Connection lines are `<Path>` strokes — Path and gradients render on the
//! Vello/GPU backend only; the CPU reference skips paths and collapses gradients
//! to their first stop (so the hub reads as a solid accent disc on CPU).

import {
  Ellipse,
  Group,
  Path,
  Rect,
  Text,
  interpolate,
  radialGradient,
  random,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import { HOUSE_EASE } from '../easing.js'
import { SPRING_SMOOTH, STAGGER } from '../motion.js'
import { useTheme } from '../theme.js'

/** One orbiting satellite node in the constellation. */
export interface Satellite {
  /** Short label inside the node — a word or single character reads best. */
  label: string
  /** Orbit radius in px (distance from the hub). Varying radii read as depth. */
  radius: number
  /** Angular speed in radians per frame; signed for either direction. */
  speed: number
  /** Starting angle in radians — where the satellite sits at frame 0. */
  startAngle: number
}

export interface NodeGraphProps {
  /** Label inside the central hub node — a single character or short word. */
  hubLabel?: string
  /** The orbiting satellites. Each flies in from off-frame, then settles into
   *  its elliptical orbit. ~5 reads as a believable constellation. */
  satellites?: Satellite[]
  /** The earned accent — hub fill tint, the connection lines, and the glow (default: theme `accent`). */
  accent?: string
  /** Vertical squash of every orbit (1 = circular, <1 = elliptical). A strong
   *  squash makes the even-angled spokes *read* as lopsided (nodes bunch toward
   *  the 3/9-o'clock sides and gaps open top/bottom), so the default keeps the
   *  ring near-circular. */
  ellipse?: number
  /** Seed for the deterministic fly-in directions and connection-pulse phases. */
  seed?: number
  /** Frames before the constellation begins assembling. */
  delay?: number
  /** Show the soft accent glow behind the hub. */
  glow?: boolean
  /** Hub node diameter in px. */
  hubDiameter?: number
  /** Hub label size in px. */
  hubFontSize?: number
  /** Background canvas color behind the constellation (default: theme `background`). */
  background?: string
  /** Surface (fill) color of the satellite pills (default: theme `surface`). */
  surface?: string
  /** Border color of the satellite pills (default: theme `border`). */
  borderColor?: string
  /** Text color of every label (default: theme `text`). */
  textColor?: string
  /** Satellite label font size in px. */
  satelliteFontSize?: number
  /** Display font for every label (default: theme `fontFamily`). */
  fontFamily?: string
  /** Horizontal center of the constellation as a 0–1 fraction of canvas width. */
  centerX?: number
  /** Vertical center of the constellation as a 0–1 fraction of canvas height. */
  centerY?: number
}

// Five satellites on evenly-spaced spokes (`i * 2π/5`) at a uniform radius so
// the constellation reads as a balanced, centered ring rather than a lopsided
// cluster. The ring is rotated by half a step (`SPOKE_GAP/2`) off straight-up so
// two spokes *straddle* the top symmetrically instead of one pointing dead-center
// up — which otherwise leaves a wide empty wedge on either side of the top. The
// slow signed drift keeps the orbit alive without letting spokes bunch up.
const SPOKE_GAP = (2 * Math.PI) / 5
const SPOKE_BASE = -Math.PI / 2 - SPOKE_GAP / 2
const DEFAULT_SATELLITES: Satellite[] = [
  { label: 'data', radius: 300, speed: 0.006, startAngle: SPOKE_BASE },
  {
    label: 'model',
    radius: 300,
    speed: 0.006,
    startAngle: SPOKE_BASE + SPOKE_GAP,
  },
  {
    label: 'render',
    radius: 300,
    speed: 0.006,
    startAngle: SPOKE_BASE + 2 * SPOKE_GAP,
  },
  {
    label: 'audio',
    radius: 300,
    speed: 0.006,
    startAngle: SPOKE_BASE + 3 * SPOKE_GAP,
  },
  {
    label: 'scene',
    radius: 300,
    speed: 0.006,
    startAngle: SPOKE_BASE + 4 * SPOKE_GAP,
  },
]

// How far off-frame a satellite starts before it flies into orbit.
const FLY_IN_DISTANCE = 1400
// Approximate average glyph advance as a fraction of font size (for sizing the
// satellite pill, which the engine measures but a pure frame→scene fn can't
// read back). Matches the estimate used by the Marquee port.
const AVG_CHAR_W = 0.6

export function NodeGraph({
  hubLabel = 'AI',
  satellites = DEFAULT_SATELLITES,
  accent: accentProp,
  ellipse = 0.92,
  seed = 7,
  delay = 0,
  glow = true,
  hubDiameter = 120,
  hubFontSize = 34,
  background: backgroundProp,
  surface: surfaceProp,
  borderColor: borderColorProp,
  textColor: textColorProp,
  satelliteFontSize = 20,
  fontFamily: fontFamilyProp,
  centerX = 0.5,
  centerY = 0.5,
}: NodeGraphProps) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const theme = useTheme()
  const accent = accentProp ?? theme.accent
  const background = backgroundProp ?? theme.background
  const surface = surfaceProp ?? theme.surface
  const borderColor = borderColorProp ?? theme.border
  const textColor = textColorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  const anchorX = centerX * width
  const anchorY = centerY * height

  // Hub entrance — a single calm scale-rise on the house spring.
  const hubP = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: SPRING_SMOOTH,
    durationInFrames: 24,
  })
  const hubScale = interpolate(hubP, [0, 1], [0.7, 1])
  const hubOpacity = interpolate(frame - delay, [0, 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: HOUSE_EASE,
  })

  const hubRadius = hubDiameter / 2

  // Per-satellite deterministic motion. Each draw uses a distinct sub-seed so
  // the sequence is stable every render and across renderers (§1).
  const nodes = satellites.map((sat, i) => {
    // Off-frame fly-in origin: a seeded direction, pushed beyond the frame.
    const flyAngle = random(`${seed}-fly-${i}`) * Math.PI * 2
    const startX = Math.cos(flyAngle) * FLY_IN_DISTANCE
    const startY = Math.sin(flyAngle) * FLY_IN_DISTANCE
    // Connection-line pulse phase — seeded so siblings don't blink in unison.
    const pulsePhase = random(`${seed}-pulse-${i}`) * Math.PI * 2

    const localDelay = delay + i * STAGGER
    const t = frame - localDelay

    // Settled orbital position (elliptical: y squashed by `ellipse`).
    const angle = sat.startAngle + sat.speed * Math.max(0, t)
    const orbitX = Math.cos(angle) * sat.radius
    const orbitY = Math.sin(angle) * sat.radius * ellipse

    // Fly-in blends start → orbit on the house spring (no overshoot).
    const p = spring({
      frame: Math.max(0, t),
      fps,
      config: SPRING_SMOOTH,
      durationInFrames: 30,
    })
    const x = interpolate(p, [0, 1], [startX, orbitX])
    const y = interpolate(p, [0, 1], [startY, orbitY])

    const opacity = interpolate(t, [0, 16], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: HOUSE_EASE,
    })

    // Deterministic line "light-up": a slow sine raised to a power so the line
    // sits dim most of the time and briefly flares. Gated by `p` so it stays
    // dark until the satellite has arrived.
    const wave = (Math.sin(t * 0.06 + pulsePhase) + 1) / 2 // 0..1
    const flare = wave ** 4 // mostly low, brief peaks
    const lineLit = flare * p

    // Pill geometry (label width can't be measured back, so it's estimated).
    const padX = 18
    const labelW = sat.label.length * satelliteFontSize * AVG_CHAR_W
    const pillW = labelW + padX * 2
    const pillH = satelliteFontSize + 20

    // Edge endpoint: stop at the pill's near edge (toward the hub), not its
    // center, so the connection line meets the pill cleanly. Treat the pill as
    // a rounded box and shrink the (x, y) target by the half-extent the
    // hub→pill ray crosses on entry, plus the hub radius at the near end.
    const dist = Math.hypot(x, y)
    let edgeStartX = 0
    let edgeStartY = 0
    let edgeEndX = x
    let edgeEndY = y
    if (dist > 0.001) {
      const ux = x / dist
      const uy = y / dist
      // Half-extent of the axis-aligned pill in the ray's direction.
      const half =
        Math.abs(ux) < 1e-6
          ? pillH / 2
          : Math.min(pillW / 2 / Math.abs(ux), pillH / 2 / Math.abs(uy))
      const endTrim = Math.min(half, dist)
      edgeEndX = x - ux * endTrim
      edgeEndY = y - uy * endTrim
      edgeStartX = ux * Math.min(hubRadius, dist)
      edgeStartY = uy * Math.min(hubRadius, dist)
    }

    return {
      sat,
      x,
      y,
      opacity,
      lineLit,
      pillW,
      pillH,
      labelW,
      edgeStartX,
      edgeStartY,
      edgeEndX,
      edgeEndY,
    }
  })

  // Soft halo behind the hub, approximating ondajs's blur/box-shadow glow.
  const glowRadius = Math.min(width, height) * 0.35
  const glowColor = `${rgbHex(accent)}59` // ~0.22 alpha at center
  const glowClear = `${rgbHex(accent)}00`
  const transparent = `${rgbHex(accent)}00`

  return (
    <Group>
      {/* Full-canvas background. */}
      <Rect width={width} height={height} fill={background} />

      {/* Anchor: the hub center. Everything below is in this local space. */}
      <Group x={anchorX} y={anchorY}>
        {/* Soft accent glow behind the hub (radial-gradient halo). */}
        {glow && glowRadius >= 1 ? (
          <Ellipse
            x={-glowRadius}
            y={-glowRadius}
            width={glowRadius * 2}
            height={glowRadius * 2}
            opacity={hubOpacity}
            gradient={radialGradient([glowRadius, glowRadius], glowRadius, [
              { offset: 0, color: glowColor },
              { offset: 1, color: glowClear },
            ])}
          />
        ) : null}

        {/* Connection lines (behind the nodes), hub rim → each satellite's near
            (hub-facing) pill edge — so the line meets the pill cleanly instead
            of running through it. Path/stroke is GPU-only; CPU skips it. */}
        {nodes.map(({ opacity, lineLit, edgeStartX, edgeStartY, edgeEndX, edgeEndY }, i) => {
          // Every edge shares one accent stroke at a consistent opacity/width —
          // the pulse only *adds* a brief brighten/thicken on top of that floor,
          // so no edge ever drops to a near-invisible gray hairline regardless
          // of its per-edge pulse phase at this frame. Gated by `opacity` so a
          // line stays hidden until its satellite has flown in.
          const lineOpacity = opacity * interpolate(lineLit, [0, 1], [0.6, 0.9])
          const lineWidth = interpolate(lineLit, [0, 1], [1.6, 2.4])
          if (lineOpacity <= 0.001) return null
          return (
            <Path
              key={`edge-${i}`}
              d={`M${edgeStartX.toFixed(2)} ${edgeStartY.toFixed(2)} L${edgeEndX.toFixed(2)} ${edgeEndY.toFixed(2)}`}
              stroke={accent}
              strokeWidth={lineWidth}
              opacity={lineOpacity}
            />
          )
        })}

        {/* Satellite nodes — rounded pills with a centered label. The pill is
            sized from an estimated label width (engine measurement can't be
            read back here). Positioned so the pill's center sits on (x, y). */}
        {nodes.map(({ sat, x, y, opacity, pillW, pillH, labelW }, i) => {
          return (
            <Group key={`node-${i}`} x={x} y={y} opacity={opacity}>
              {/* Center the pill on the orbit point. */}
              <Rect
                x={-pillW / 2}
                y={-pillH / 2}
                width={pillW}
                height={pillH}
                cornerRadius={pillH / 2}
                fill={surface}
                stroke={borderColor}
                strokeWidth={1}
              />
              <Text
                x={-labelW / 2}
                y={-satelliteFontSize / 2}
                fontSize={satelliteFontSize}
                color={textColor}
                fontFamily={fontFamily}
                fontWeight={600}
              >
                {sat.label}
              </Text>
            </Group>
          )
        })}

        {/* Central hub — a radial-gradient disc with an accent ring. Scales
            about its center: the Group marks the center, the Ellipse is offset
            by -radius so the local-origin scale reads centered (§3). */}
        <Group scaleX={hubScale} scaleY={hubScale} opacity={hubOpacity}>
          <Ellipse
            x={-hubRadius}
            y={-hubRadius}
            width={hubDiameter}
            height={hubDiameter}
            stroke={accent}
            strokeWidth={1}
            gradient={radialGradient([hubRadius, hubRadius * 0.7], hubRadius, [
              { offset: 0, color: rgbHex(accent) },
              { offset: 0.78, color: surface },
              { offset: 1, color: transparent },
            ])}
          />
          <Text
            x={-(hubLabel.length * hubFontSize * AVG_CHAR_W) / 2}
            y={-hubFontSize / 2}
            fontSize={hubFontSize}
            color={textColor}
            fontFamily={fontFamily}
            fontWeight={600}
          >
            {hubLabel}
          </Text>
        </Group>
      </Group>
    </Group>
  )
}

/** Normalize a color to a 6-digit `#rrggbb` (drops any trailing alpha, expands
 *  shorthand) so alpha suffixes can be appended deterministically. Unknown
 *  formats fall through unchanged. */
function rgbHex(color: string): string {
  if (!color.startsWith('#')) return color
  const hex = color.slice(1)
  if (hex.length === 3) {
    const r = hex[0] ?? '0'
    const g = hex[1] ?? '0'
    const b = hex[2] ?? '0'
    return `#${r}${r}${g}${g}${b}${b}`
  }
  if (hex.length === 4) {
    const r = hex[0] ?? '0'
    const g = hex[1] ?? '0'
    const b = hex[2] ?? '0'
    return `#${r}${r}${g}${g}${b}${b}`
  }
  if (hex.length === 6 || hex.length === 8) {
    return `#${hex.slice(0, 6)}`
  }
  return color
}
