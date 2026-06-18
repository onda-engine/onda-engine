//! Deterministic React hooks for Onda components.
//!
//! Ported from ondajs (`lib/hooks.ts`). Every hook reads time via
//! `useCurrentFrame()` and config via `useVideoConfig()`, then returns a pure
//! function of the frame — no `useState`/`useEffect` to drive animation. They
//! exist to remove the `const frame = useCurrentFrame()` + interpolate
//! boilerplate every component otherwise repeats.

import { interpolate, spring, useCurrentFrame, useVideoConfig } from '@onda-engine/react'
import { type Motion, entryFade, entryFadeRise, entryScale, entrySlide } from './choreography.js'
import { HOUSE_EASE } from './easing.js'
import { DURATION, SPRING_SMOOTH, SPRING_SNAPPY, STAGGER, staggerFrames } from './motion.js'
import { type TimeInput, framesOf } from './time.js'

/** The entrance flavors {@link useEntrance} can produce. */
export type EntranceType = 'fade' | 'rise' | 'scale' | 'slide'

/** Shared entrance options. `type` picks the choreography pattern. */
export type EntranceOptions = {
  type?: EntranceType
  delay?: TimeInput
  durationInFrames?: TimeInput
  /** For `type: 'slide'` — the settling direction. */
  direction?: 'up' | 'down' | 'left' | 'right'
  /** For `type: 'slide'` — travel distance in px (12–24 envelope). */
  distance?: number
  /** For `type: 'scale'` — starting scale (default 0.9). */
  from?: number
}

// Internal: compute an entrance Motion given an explicit frame/fps. Kept pure so
// useStaggeredEntrance can call it per-index after reading the frame once.
function computeEntrance(frame: number, fps: number, opts: EntranceOptions): Motion {
  const { type = 'rise', direction = 'up', distance = 12, from = 0.9 } = opts
  const delay = framesOf(opts.delay, fps, 0)
  const durationInFrames = framesOf(opts.durationInFrames, fps, DURATION.base)
  switch (type) {
    case 'fade':
      return entryFade({ frame, fps, delay, durationInFrames })
    case 'scale':
      return entryScale({ frame, fps, delay, durationInFrames, from })
    case 'slide':
      return entrySlide({ frame, fps, delay, durationInFrames, direction, distance })
    default:
      return entryFadeRise({ frame, fps, delay, durationInFrames })
  }
}

/** The workhorse entrance hook — returns the {@link Motion} for the current
 *  frame. Dispatches to the choreography vocabulary so the fingerprint stays
 *  consistent. Spread the relevant fields onto a `<Group>`. */
export function useEntrance(opts: EntranceOptions = {}): Motion {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return computeEntrance(frame, fps, opts)
}

/** Call once, get a function that yields the entrance {@link Motion} for sibling
 *  `i`, staggered by {@link STAGGER}. The clean way to animate a list/grid
 *  without calling a hook in a loop. */
export function useStaggeredEntrance(
  opts: EntranceOptions & { increment?: TimeInput } = {},
): (index: number) => Motion {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const { increment, delay, ...rest } = opts
  const incrementFrames = framesOf(increment, fps, STAGGER)
  const delayFrames = framesOf(delay, fps, 0)
  return (index: number) =>
    computeEntrance(frame, fps, {
      ...rest,
      delay: delayFrames + staggerFrames(index, incrementFrames),
    })
}

/** The house spring value (0→1) for the current frame — the one-liner most
 *  components reach for to drive a custom interpolation. */
export function useSpringValue(
  opts: { delay?: TimeInput; durationInFrames?: TimeInput; snappy?: boolean } = {},
): number {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const { snappy = false } = opts
  const delay = framesOf(opts.delay, fps, 0)
  const durationInFrames = framesOf(opts.durationInFrames, fps, DURATION.base)
  return spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: snappy ? SPRING_SNAPPY : SPRING_SMOOTH,
    durationInFrames,
  })
}

/** Normalized progress (0→1) across a window, eased with {@link HOUSE_EASE} by
 *  default. For opacity/color ramps and anything that isn't physical motion
 *  (use {@link useSpringValue} for position/scale). */
export function useSceneProgress(
  opts: { delay?: TimeInput; durationInFrames?: TimeInput; eased?: boolean } = {},
): number {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const { eased = true } = opts
  const delay = framesOf(opts.delay, fps, 0)
  const durationInFrames = framesOf(opts.durationInFrames, fps, DURATION.base)
  return interpolate(frame - delay, [0, durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    ...(eased ? { easing: HOUSE_EASE } : {}),
  })
}

/** How many units (chars or words) of a reveal are visible at the current frame.
 *  Drives typewriter / decode / slot-roll effects. Linear by default — a steady
 *  cadence reads better than an eased one. Returns an integer in `[0, length]`. */
export function useTextReveal(opts: {
  length: number
  delay?: TimeInput
  durationInFrames?: TimeInput
  eased?: boolean
}): number {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const { length, eased = false } = opts
  const delay = framesOf(opts.delay, fps, 0)
  const durationInFrames = framesOf(opts.durationInFrames, fps, DURATION.slower)
  const raw = interpolate(frame - delay, [0, durationInFrames], [0, length], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    ...(eased ? { easing: HOUSE_EASE } : {}),
  })
  return Math.floor(raw)
}
