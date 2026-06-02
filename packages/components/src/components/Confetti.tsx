//! Confetti — a celebratory particle burst over the whole canvas. Ported from ondajs.
//!
//! Pieces launch from an origin, fan outward, arc back under gravity, tumble
//! (rotate + size-jitter) and fade. Every per-piece value (angle, speed, spin,
//! color, size) is drawn from the deterministic `random(seed)` hash so the same
//! seed renders the same burst on every frame and every machine (§1) — no
//! `Math.random`, no wall-clock.
//!
//! ondajs renders each piece as an absolutely-positioned `<div>` with a CSS
//! `transform: translate(...) rotate(...)`. Here each piece is a small `<Rect>`
//! placed inside a per-piece `<Group>` translated to the piece centre, with the
//! `<Rect>` offset by `-w/2, -h/2` so rotation tumbles about its own centre
//! (scene scale/rotation pivot on the LOCAL origin, not the node centre — §3).
//! The whole field lives in one full-canvas `<Group>`; nothing uses `<Flex>`, so
//! the per-frame position/size changes never trigger a layout reflow (§2).
//!
//! Backend caveat: `rotation` renders only on the Vello/GPU backend — the CPU
//! reference rasterizer ignores it, so the tumble is a GPU-only effect (the
//! ballistic arc, fade and size-jitter still read on the CPU reference).

import { Group, Rect, interpolate, random, useCurrentFrame, useVideoConfig } from '@onda/react'
import { HOUSE_EASE } from '../easing.js'
import { useTheme } from '../theme.js'

export interface ConfettiProps {
  /** Seed for every per-piece random (angle, velocity, spin, colour, size) — the
   *  same seed always produces the same burst (§1). */
  seed?: number
  /** Number of confetti pieces. ~80 reads full without thrashing the render. */
  count?: number
  /** Palette pieces are picked from. Defaults to the Onda accent plus tasteful
   *  neutrals (default: theme `accent`, theme `text`, theme `textMuted`, theme
   *  `border`). */
  colors?: string[]
  /** Burst origin X, as a fraction of canvas width (0 = left, 1 = right). */
  originX?: number
  /** Burst origin Y, as a fraction of canvas height (0 = top, 1 = bottom). */
  originY?: number
  /** Frames before the burst launches. */
  delay?: number
  /** Frames over which a piece travels, tumbles and fades out. */
  duration?: number
  /** Launch spread, in degrees, around straight up. Wider = more fan-out. */
  spread?: number
  /** Downward acceleration. Higher = pieces fall back faster. */
  gravity?: number
  /** Base piece size in pixels — each piece varies around this. */
  pieceSize?: number
}

/** Onda accent + neutrals — the ondajs CSS-var defaults resolved to hex, since
 *  the scene graph has no CSS custom properties. */
const DEFAULT_COLORS = ['#d96b82', '#e89aab', '#f2f2f4', '#8e8e98', '#26262e']

export function Confetti({
  seed = 7,
  count = 80,
  colors: colorsProp,
  originX = 0.5,
  originY = 0.35,
  delay = 0,
  duration = 70,
  spread = 120,
  gravity = 1,
  pieceSize = 12,
}: ConfettiProps) {
  const frame = useCurrentFrame()
  const { width, height, fps } = useVideoConfig()
  const theme = useTheme()
  const colors = colorsProp ?? [
    theme.accent ?? '#d96b82',
    '#e89aab',
    theme.text ?? '#f2f2f4',
    theme.textMuted ?? '#8e8e98',
    theme.border ?? '#26262e',
  ]
  const cornerRadius = theme.radius ?? 1

  const local = frame - delay
  const ox = originX * width
  const oy = originY * height

  // Speed scaled to canvas + fps so the burst looks the same at any resolution.
  const speedScale = (Math.min(width, height) / 1080) * (30 / fps)
  const spreadRad = (spread * Math.PI) / 180

  // Nothing has launched yet — emit an empty field rather than null so the host
  // node is stable across frames.
  if (local < 0) {
    return <Group />
  }

  const palette = colors.length > 0 ? colors : DEFAULT_COLORS

  const pieces = Array.from({ length: count }, (_, i) => {
    // Each draw gets its OWN unique seed key (`random(seed)` here is a pure hash,
    // not a stateful generator), so piece order never shifts any value.
    const aJit = random(`${seed}-${i}-angle`)
    const speed = 9 + random(`${seed}-${i}-speed`) * 13 // launch velocity (px/frame @ baseline)
    const spin = (random(`${seed}-${i}-spin`) - 0.5) * 28 // degrees/frame
    const spin0 = random(`${seed}-${i}-spin0`) * 360 // initial rotation
    const color =
      palette[Math.floor(random(`${seed}-${i}-color`) * palette.length)] ?? palette[0] ?? '#f2f2f4'
    const wf = 0.7 + random(`${seed}-${i}-wf`) * 0.6 // width factor (slim rectangles)
    const sizeJit = 0.7 + random(`${seed}-${i}-size`) * 0.8 // per-piece size variation
    const lifeJit = 0.8 + random(`${seed}-${i}-life`) * 0.4 // per-piece duration variation
    const drift = (random(`${seed}-${i}-drift`) - 0.5) * 4 // horizontal sway amplitude

    const life = duration * lifeJit
    if (local > life) {
      return null
    }

    const t = local // frames since launch (already >= 0)
    // Aim around straight up (-90deg), fanned by spread.
    const angle = -Math.PI / 2 + (aJit - 0.5) * spreadRad
    const vx = Math.cos(angle) * speed * speedScale
    const vy = Math.sin(angle) * speed * speedScale
    const g = 0.55 * gravity * speedScale

    // Ballistic path: gravity pulls pieces back down over time, plus a small
    // horizontal sway (phase-offset per piece so the field shimmers).
    const x = ox + vx * t + Math.sin(t * 0.18 + i) * drift
    const y = oy + vy * t + 0.5 * g * t * t

    const opacity = interpolate(t, [0, life * 0.15, life * 0.7, life], [0, 1, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: HOUSE_EASE,
    })

    const rotate = spin0 + spin * t
    const w = pieceSize * sizeJit * wf
    const h = pieceSize * sizeJit

    // Translate the Group to the piece CENTRE, then offset the Rect by -w/2,-h/2
    // so the GPU rotation tumbles about the centre (pivot is the local origin).
    return (
      <Group key={i} x={x} y={y} rotation={rotate} opacity={opacity}>
        <Rect x={-w / 2} y={-h / 2} width={w} height={h} cornerRadius={cornerRadius} fill={color} />
      </Group>
    )
  })

  return <Group>{pieces}</Group>
}
