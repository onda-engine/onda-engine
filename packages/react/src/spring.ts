//! `spring()` — natural motion as a deterministic, frame-keyed value.
//!
//! Mirrors `onda-animation`'s Rust spring: a damped harmonic oscillator pulled
//! from 0 toward 1, integrated at a fixed `1/fps` step. Pure function of `frame`,
//! so renders are reproducible. Use it like Remotion's spring.

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
}

/** Spring value at `frame`. Settles toward `to`; underdamped configs overshoot. */
export function spring({ frame, fps, from = 0, to = 1, config = {} }: SpringOptions): number {
  const { mass = 1, stiffness = 100, damping = 10 } = config
  let position = 0
  if (fps > 0 && frame > 0) {
    const dt = 1 / fps
    let velocity = 0
    const steps = Math.round(frame)
    for (let i = 0; i < steps; i++) {
      const force = -stiffness * (position - 1) - damping * velocity
      velocity += (force / mass) * dt
      position += velocity * dt
    }
  }
  return from + (to - from) * position
}
