//! `<Particles>` — a deterministic particle emitter. Every particle's whole state
//! (spawn point, velocity, age, size, opacity, colour, spin) is a PURE function of
//! `(frame, seed, index)` via the `random(seed)` hash, so the same comp renders the
//! same field on every frame and every machine — no `Math.random`, no wall-clock,
//! and no engine change: each live particle is just a circle/square in one
//! full-canvas `<Group>`. Frame-based units (velocity = px/frame, gravity =
//! px/frame²), so it composes with the rest of the timeline.

import { type ReactElement, createElement } from 'react'
import { Ellipse, Group, Rect } from './components.js'
import { useCurrentFrame } from './frame.js'
import { random } from './random.js'

export interface ParticlesProps {
  /** Number of particles. */
  count?: number
  /** Seed for every per-particle random — the same seed always renders the same field. */
  seed?: number | string
  /** Emitter origin (px). */
  x?: number
  y?: number
  /** Particles spawn at a random point within this radius of the origin (0 = a point). */
  spawnRadius?: number
  /** Base launch speed (px per frame). */
  speed?: number
  /** Random speed reduction, 0..1 (each particle gets `speed × (1 − variance×rand)`). */
  speedVariance?: number
  /** Launch direction in degrees: 0 = right, −90 = up, 90 = down, 180 = left. */
  angle?: number
  /** Spread cone around `angle`, in degrees (360 = omnidirectional burst). */
  spread?: number
  /** Constant downward acceleration (px per frame²). */
  gravity?: number
  /** Particle lifetime in frames. */
  lifetime?: number
  /** Stagger the emission across this many frames (0 = a single burst). */
  emitOver?: number
  /** Re-emit each particle when it dies → a continuous stream (set `emitOver`≈`lifetime`). */
  loop?: boolean
  /** Frames before emission begins. */
  delay?: number
  /** Particle shape. */
  shape?: 'circle' | 'square'
  /** Diameter (px) at birth → death (lerped over the lifetime). A number = constant. */
  size?: number | [number, number]
  /** Opacity at birth → death. */
  opacity?: [number, number]
  /** Palette each particle picks one colour from. */
  colors?: string[]
  /** Rotation in degrees over the lifetime (visible on `square`). */
  spin?: number
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** A deterministic particle emitter — bursts, fountains, confetti, sparks, dust,
 *  snow. See {@link ParticlesProps}. */
export function Particles({
  count = 60,
  seed = 1,
  x = 0,
  y = 0,
  spawnRadius = 0,
  speed = 4,
  speedVariance = 0.5,
  angle = -90,
  spread = 360,
  gravity = 0,
  lifetime = 60,
  emitOver = 0,
  loop = false,
  delay = 0,
  shape = 'circle',
  size = 8,
  opacity = [1, 0],
  colors = ['#e85494', '#ffd36b', '#5ad1ff'],
  spin = 0,
}: ParticlesProps): ReactElement {
  const frame = useCurrentFrame()
  const key = String(seed)
  const [s0, s1] = typeof size === 'number' ? [size, size] : size
  const particles: ReactElement[] = []

  for (let i = 0; i < count; i++) {
    const r = (suffix: string): number => random(`${key}-${i}-${suffix}`)
    const emitFrame = delay + (emitOver > 0 ? (i / count) * emitOver : 0)
    let age = frame - emitFrame
    if (loop && age >= 0) age %= lifetime
    if (age < 0 || age >= lifetime) continue

    // Spawn point: uniform within the spawn disc (√rand for even area distribution).
    const sa = r('sa') * Math.PI * 2
    const sr = Math.sqrt(r('sr')) * spawnRadius
    const ox = x + Math.cos(sa) * sr
    const oy = y + Math.sin(sa) * sr

    // Launch velocity: `angle ± spread/2`, speed with variance.
    const dir = ((angle + (r('ang') - 0.5) * spread) * Math.PI) / 180
    const spd = speed * (1 - speedVariance * r('spd'))
    const vx = Math.cos(dir) * spd
    const vy = Math.sin(dir) * spd

    // Integrate position (closed form: launch + gravity).
    const px = ox + vx * age
    const py = oy + vy * age + 0.5 * gravity * age * age

    const t = age / lifetime
    const sz = lerp(s0, s1, t)
    const op = lerp(opacity[0], opacity[1], t)
    const color = colors[Math.floor(r('col') * colors.length) % colors.length]
    const inner =
      shape === 'square'
        ? createElement(Rect, { x: -sz / 2, y: -sz / 2, width: sz, height: sz, fill: color })
        : createElement(Ellipse, { x: -sz / 2, y: -sz / 2, width: sz, height: sz, fill: color })
    particles.push(
      createElement(
        Group,
        { key: i, x: px, y: py, opacity: op, rotation: spin * t, originX: 0, originY: 0 },
        inner,
      ),
    )
  }
  return createElement(Group, null, ...particles)
}
