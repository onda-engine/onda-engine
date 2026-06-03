//! CameraShake — wraps children in a deterministic, decaying camera shake.
//! Ported from ondajs.
//!
//! Jitters the x/y translate (and an optional slight rotation) of a wrapping
//! `<Group>` using the engine's seeded `random()` — same `seed` + frame always
//! yields the same offset, so the shake is identical across renders and threads.
//! NEVER `Math.random()` in a render path.
//!
//! The shake is a contained event: it only fires inside `[delay, delay +
//! duration]`. Before and after that window the offset is exactly 0, so wrapped
//! content sits perfectly still. With `decay` (the default) the amplitude ramps
//! linearly to 0 across the window, so the camera settles to rest by the end.
//!
//! Layout: the child is centered in the composition by an outer
//! `<AbsoluteFill>` (justify/align center), and the shake is a SMALL ± offset
//! applied by the inner motion `<Group>` ON TOP of that centered rest position —
//! never a large absolute translate from the top-left origin. The motion
//! `<Group>` is the AbsoluteFill's child, so the layout pass centers its box and
//! the jitter rides on top (HARD RULE 2 holds: the box itself doesn't reflow).
//! The `x`/`y` props nudge the rest position relative to that center.
//!
//! Engine note: `rotation` renders on the Vello/GPU backend; the CPU reference
//! rasterizer ignores it (the x/y jitter still applies on both). Keep
//! `rotationIntensity` small — a fraction of a degree reads as a hand-held
//! wobble; more reads as a tumble.

import { AbsoluteFill, Group, random, useCurrentFrame } from '@onda/react'
import type { ReactNode } from 'react'
import { DURATION } from '../motion.js'

export interface CameraShakeProps {
  /** Frames before the shake starts. Outside the window, offset is 0. */
  delay?: number
  /** Frames the shake lasts. Before `delay` / after `delay + duration`, the
   *  offset is exactly 0 and content is still. */
  duration?: number
  /** Maximum positional offset in px. Restrained by default — bump for impact
   *  moments. */
  intensity?: number
  /** Maximum rotation amplitude in degrees (GPU/Vello only). A subtle wobble by
   *  default; set `0` for pure translational shake. */
  rotationIntensity?: number
  /** PRNG seed — same seed always produces the same shake. */
  seed?: number
  /** Linearly decay intensity (and rotation) to 0 over `duration`, so the camera
   *  settles to rest by the end. Default `true`. */
  decay?: boolean
  /** Rest x of the wrapper in px (the shake jitters around this). */
  x?: number
  /** Rest y of the wrapper in px (the shake jitters around this). */
  y?: number
  /** Content to shake. */
  children?: ReactNode
}

export function CameraShake({
  delay = 0,
  duration = DURATION.slow,
  intensity = 4,
  rotationIntensity = 0.6,
  seed = 0,
  decay = true,
  x = 0,
  y = 0,
  children,
}: CameraShakeProps) {
  const frame = useCurrentFrame()
  const local = frame - delay

  // Only shake inside [delay, delay + duration]; otherwise sit perfectly still.
  let offsetX = 0
  let offsetY = 0
  let rotation = 0

  if (local >= 0 && local <= duration) {
    const progress = duration > 0 ? local / duration : 1
    // Decay linearly so the shake settles by the end — restraint over time.
    const falloff = decay ? 1 - progress : 1
    const currentIntensity = intensity * falloff
    const currentRotation = rotationIntensity * falloff

    // Seeded, deterministic offsets in [-1, 1) per axis. Mirrors the ondajs seed
    // math (frame * 2 for x, +1 for y) and adds a third stream for rotation so
    // the three axes don't move in lockstep.
    offsetX = (random(seed + frame * 3) - 0.5) * 2 * currentIntensity
    offsetY = (random(seed + frame * 3 + 1) - 0.5) * 2 * currentIntensity
    rotation = (random(seed + frame * 3 + 2) - 0.5) * 2 * currentRotation
  }

  // Center the child in the composition, then jitter it with the SMALL shake
  // offset on top — the shake oscillates around the centered rest position
  // rather than displacing from the top-left origin.
  return (
    <AbsoluteFill justify="center" align="center">
      <Group x={x + offsetX} y={y + offsetY} rotation={rotation}>
        {children}
      </Group>
    </AbsoluteFill>
  )
}
