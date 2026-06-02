//! `spring()` — natural motion as a deterministic, frame-keyed value.
//!
//! A damped harmonic oscillator pulled from 0 toward 1, integrated with explicit
//! Euler at a stable sub-frame step. Pure function of `frame` (IEEE-754 math), so
//! renders are reproducible across machines. Use it like Remotion's spring —
//! including `durationInFrames` to re-time how fast it settles.
//!
//! Why sub-stepping: explicit Euler diverges unless `dt < ~2/ω`, where `ω` is the
//! fastest rate in the system. A heavily-overdamped config like the Onda house
//! spring (damping 200) has `ω ≈ 200`, so a naive `dt = 1/fps` (≈0.033) blows up
//! to NaN. We pick a stable sub-frame `dt` instead, independent of `fps`.

export interface SpringConfig {
  mass?: number
  stiffness?: number
  damping?: number
}

export interface SpringOptions {
  /** Current frame (e.g. from `useCurrentFrame()`). */
  frame: number
  /** Composition frame rate. */
  fps: number
  /** Output at rest start (default 0). */
  from?: number
  /** Output at settle (default 1). */
  to?: number
  config?: SpringConfig
  /** Re-time the spring so it settles in this many frames (like Remotion's
   *  `durationInFrames`). Without it, the settle is governed purely by the
   *  spring physics — and for an overdamped config (e.g. the Onda house spring)
   *  that can be far slower than you want. */
  durationInFrames?: number
  /** When `durationInFrames` is set, the spring counts as "settled" once it
   *  stays within this distance of `to` with near-zero velocity. Default 0.005. */
  durationRestThreshold?: number
}

/** A stable explicit-Euler step (seconds) for this mass-spring-damper. Sized to
 *  `dt < 2/ω` with margin so the integration never diverges, and capped at 1/60s
 *  so soft configs are still sampled smoothly. */
function stableStep(mass: number, stiffness: number, damping: number): number {
  const omega = Math.max(damping / mass, Math.sqrt(stiffness / mass), 1e-6)
  return Math.min(1 / 60, 1.6 / omega)
}

/** Normalized spring position (0 at rest → 1 at settle, may overshoot if
 *  underdamped) after `timeSec` seconds. Pure function of time. */
function positionAt(
  timeSec: number,
  mass: number,
  stiffness: number,
  damping: number,
  dt: number,
): number {
  if (timeSec <= 0) return 0
  const steps = Math.max(1, Math.round(timeSec / dt))
  let position = 0
  let velocity = 0
  for (let i = 0; i < steps; i++) {
    const force = -stiffness * (position - 1) - damping * velocity
    velocity += (force / mass) * dt
    position += velocity * dt
  }
  return position
}

// Memoized natural-settle measurement, keyed by (config, dt, threshold). Pure
// memoization of a pure function — no effect on determinism.
const settleCache = new Map<string, number>()

/** Seconds the natural spring takes to settle within `threshold` of 1 with
 *  near-zero velocity. Used to re-time when `durationInFrames` is set. */
function measureSettleSeconds(
  mass: number,
  stiffness: number,
  damping: number,
  dt: number,
  threshold: number,
): number {
  const key = `${mass}|${stiffness}|${damping}|${dt}|${threshold}`
  const cached = settleCache.get(key)
  if (cached !== undefined) return cached

  let position = 0
  let velocity = 0
  const maxSteps = 5_000_000
  let result = maxSteps * dt
  for (let i = 0; i < maxSteps; i++) {
    const force = -stiffness * (position - 1) - damping * velocity
    velocity += (force / mass) * dt
    position += velocity * dt
    if (Math.abs(1 - position) < threshold && Math.abs(velocity) < threshold) {
      result = (i + 1) * dt
      break
    }
  }
  settleCache.set(key, result)
  return result
}

/** Spring value at `frame`. Settles toward `to`; underdamped configs overshoot.
 *  With `durationInFrames`, the whole settle is time-remapped to land in that
 *  many frames. */
export function spring({
  frame,
  fps,
  from = 0,
  to = 1,
  config = {},
  durationInFrames,
  durationRestThreshold = 0.005,
}: SpringOptions): number {
  const { mass = 1, stiffness = 100, damping = 10 } = config
  let position = 0
  if (fps > 0 && frame > 0) {
    const dt = stableStep(mass, stiffness, damping)
    let timeSec = frame / fps
    if (durationInFrames != null && durationInFrames > 0) {
      // Re-time by stretching the time axis: the value at `frame` is the natural
      // spring's value at `frame * naturalSettle / durationInFrames`, clamped at
      // the natural settle so post-settle frames just read `to`.
      const naturalSec = measureSettleSeconds(mass, stiffness, damping, dt, durationRestThreshold)
      const durationSec = durationInFrames / fps
      timeSec = Math.min((frame / fps) * (naturalSec / durationSec), naturalSec)
    }
    position = positionAt(timeSec, mass, stiffness, damping, dt)
  }
  return from + (to - from) * position
}
