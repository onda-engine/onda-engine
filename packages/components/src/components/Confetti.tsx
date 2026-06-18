//! Confetti — a soft, slow particle BLOOM, not a party popper. Translucent motes
//! rise and drift outward from an origin on an eased path that decelerates,
//! gently growing and fading. Ported from ondajs, then premium-tuned.
//!
//! Deterministic: every per-piece value (angle, reach, opacity, size, sway,
//! colour) is drawn from the pure `random(seed)` hash (§1), so the same seed
//! renders the same bloom on every frame and every machine — no `Math.random`,
//! no wall-clock.
//!
//! Each piece is a soft CIRCLE (`<Rect>` with `cornerRadius = r/2`) inside a
//! per-piece `<Group>` translated to its centre and carrying the piece opacity.
//! The whole field lives in one full-canvas `<Group>`; nothing uses `<Flex>`, so
//! the per-frame position/size changes never trigger a layout reflow (§2).
//!
//! Premium notes: round translucent dots (not slim tumbling strips), a muted
//! accent-led palette at low opacity, an eased outward drift (HOUSE_EASE — it
//! decelerates rather than flying ballistically), a slow sway, and NO rotation —
//! so it reads as ambient celebratory light, and renders identically on the CPU
//! reference and the Vello/GPU backend (no GPU-only tumble).

import {
  Group,
  Rect,
  interpolate,
  random,
  useCurrentFrame,
  useVideoConfig,
  variantSeed,
} from '@onda-engine/react'
import { HOUSE_EASE } from '../easing.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

export interface ConfettiProps {
  /** Seed for every per-piece random (angle, reach, opacity, size, colour) — the
   *  same seed always produces the same bloom (§1). */
  seed?: number
  /** Integer "take" selector: derives a new deterministic seed from (seed,
   *  variant), so alternates never require hand-edited magic seeds. 0/omitted
   *  = the default take (identical to today's output). */
  variant?: number
  /** Number of motes. ~80 reads full without thrashing the render. */
  count?: number
  /** Palette motes are picked from. Defaults to the theme accent plus a soft
   *  accent tint and tasteful neutrals; all rendered translucent. */
  colors?: string[]
  /** Bloom origin X, as a fraction of canvas width (0 = left, 1 = right). */
  originX?: number
  /** Bloom origin Y, as a fraction of canvas height (0 = top, 1 = bottom). */
  originY?: number
  /** Frames before the bloom begins. */
  delay?: TimeInput
  /** Frames over which a mote drifts and fades out. */
  duration?: TimeInput
  /** Drift spread, in degrees, around straight up. Wider = more fan-out. */
  spread?: number
  /** Gentle downward bias added over the drift (0 = pure rise; 1 = a soft settle). */
  gravity?: number
  /** Base mote size in pixels — each varies around this (small motes .. soft bokeh). */
  pieceSize?: number
}

/** Onda accent + a soft tint + neutrals — resolved to hex (the scene graph has no
 *  CSS custom properties). Used translucent, so they read as light, not paper. */
const DEFAULT_COLORS = ['#e85494', '#f2b8cf', '#f2f2f4', '#8e8e98']

export function Confetti({
  seed: seedProp = 7,
  variant,
  count = 80,
  colors: colorsProp,
  originX = 0.5,
  originY = 0.35,
  delay: delayIn = 0,
  duration: durationIn = 70,
  spread = 120,
  gravity = 1,
  pieceSize = 12,
}: ConfettiProps) {
  // The variant knob derives an alternate deterministic seed (identity at 0).
  const seed = variantSeed(seedProp, variant)
  const frame = useCurrentFrame()
  const { width, height, fps } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const duration = framesOf(durationIn, fps)
  const theme = useTheme()
  const colors = colorsProp ?? [
    theme.accent ?? '#e85494',
    '#f2b8cf',
    theme.text ?? '#f2f2f4',
    theme.textMuted ?? '#8e8e98',
  ]

  const local = frame - delay
  const ox = originX * width
  const oy = originY * height

  // Distances/speeds scaled to canvas + fps so the bloom looks the same at any
  // resolution and framerate.
  const speedScale = (Math.min(width, height) / 1080) * (30 / fps)
  const spreadRad = (spread * Math.PI) / 180

  // Nothing has begun yet — emit an empty field rather than null so the host node
  // is stable across frames.
  if (local < 0) {
    return <Group />
  }

  const palette = colors.length > 0 ? colors : DEFAULT_COLORS

  const pieces = Array.from({ length: count }, (_, i) => {
    // Each draw gets its OWN unique seed key (`random(seed)` here is a pure hash,
    // not a stateful generator), so piece order never shifts any value.
    const aJit = random(`${seed}-${i}-angle`)
    const reach = 90 + random(`${seed}-${i}-reach`) * 180 // px of outward travel @1080 baseline
    const peak = 0.22 + random(`${seed}-${i}-peak`) * 0.34 // max (translucent) opacity
    const sizeJit = 0.5 + random(`${seed}-${i}-size`) * 1.7 // small motes .. soft bokeh
    const lifeJit = 0.75 + random(`${seed}-${i}-life`) * 0.5 // per-piece duration variation
    const swayAmp = (random(`${seed}-${i}-sway`) - 0.5) * 26 // slow horizontal sway

    const color =
      palette[Math.floor(random(`${seed}-${i}-color`) * palette.length)] ?? palette[0] ?? '#f2f2f4'

    const life = duration * lifeJit
    if (local > life) {
      return null
    }

    const t = local // frames since launch (already >= 0)

    // Eased outward drift that decelerates — confident, not ballistic.
    const prog = interpolate(t, [0, life], [0, 1], {
      extrapolateRight: 'clamp',
      easing: HOUSE_EASE,
    })
    // Aim around straight up (-90deg), fanned by spread.
    const angle = -Math.PI / 2 + (aJit - 0.5) * spreadRad
    const dist = reach * speedScale * prog
    const sway = Math.sin(t * 0.06 + i) * swayAmp * speedScale * prog
    // A gentle downward bias that grows over the drift (soft settle, not a fall).
    const fall = 0.16 * gravity * speedScale * t * prog

    const x = ox + Math.cos(angle) * dist + sway
    const y = oy + Math.sin(angle) * dist + fall

    const opacity = interpolate(t, [0, life * 0.3, life * 0.6, life], [0, peak, peak, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: HOUSE_EASE,
    })

    // Soft round mote; grows slightly as it rises (a subtle bloom).
    const r = pieceSize * sizeJit * (0.85 + 0.3 * prog)

    return (
      <Group key={i} x={x} y={y} opacity={opacity}>
        <Rect x={-r / 2} y={-r / 2} width={r} height={r} cornerRadius={r / 2} fill={color} />
      </Group>
    )
  })

  return <Group>{pieces}</Group>
}
