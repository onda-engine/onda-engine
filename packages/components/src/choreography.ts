//! Named motion patterns — the Onda choreography vocabulary.
//!
//! Ported from ondajs (`lib/choreography.ts`). Each helper is a pure function of
//! frame/fps. The one change for `@onda-engine/react`: where ondajs returns a CSS
//! `{ opacity, transform }` to spread onto a `<div>`, these return a numeric
//! {@link Motion} (`{ opacity, x, y, scaleX, scaleY }`) to spread onto a scene
//! node (`<Group>`) — no string parsing, and it composes with the GPU transform.
//!
//! Atomic entries:   entryFade · entrySlide · entryScale
//! Named composite:  entryFadeRise (the workhorse — opacity + rise)
//! Exits (faster, on HOUSE_EASE — an exit doesn't settle):
//!                   exitFade · exitSlide · exitScale · exitFadeFall
//! Special:          heroReveal (two-phase landing) · stateSwap (in-place crossfade)
//!
//! All patterns accept `delay` so callers can stagger via `staggerFrames(index)`.

import { interpolate, spring } from '@onda-engine/react'
import { HOUSE_EASE } from './easing.js'
import { DURATION, OVERSHOOT, SPRING_SMOOTH } from './motion.js'
import { type TimeInput, framesOf } from './time.js'

/** Numeric motion for a scene node. Spread the relevant fields onto a `<Group>`:
 *  `x`/`y` (px translate), `scaleX`/`scaleY` (1 = identity), `opacity` (0..1),
 *  `rotation` (degrees; optional — only keyframe animation emits it). */
export type Motion = {
  opacity: number
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation?: number
}

const REST: Motion = { opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export type PatternInput = {
  frame: number
  fps: number
  /** Frames (number) or a time string ('0.5s', '500ms', '12f'). */
  delay?: TimeInput
  /** Frames (number) or a time string ('0.5s', '500ms', '12f'). */
  durationInFrames?: TimeInput
  travelPx?: number
}

/** Pure opacity 0 → 1 on {@link SPRING_SMOOTH}. No translate, no scale — the
 *  simplest reveal, for elements where presence alone changes. */
export const entryFade = ({
  frame,
  fps,
  delay: delayIn,
  durationInFrames: durationIn,
}: Omit<PatternInput, 'travelPx'>): Motion => {
  const delay = framesOf(delayIn, fps, 0)
  const durationInFrames = framesOf(durationIn, fps, DURATION.base)
  const progress = spring({ frame: frame - delay, fps, config: SPRING_SMOOTH, durationInFrames })
  const opacity = interpolate(progress, [0, 1], [0, 1], CLAMP)
  return { ...REST, opacity }
}

/** Direction-parameterized translate + fade on {@link SPRING_SMOOTH}. `direction`
 *  names the *settling* direction — `'up'` rises into place (origin below),
 *  `'left'` slides in from the right. Travel is the 12–24px Onda envelope. */
export const entrySlide = ({
  frame,
  fps,
  delay: delayIn,
  durationInFrames: durationIn,
  direction,
  distance = 12,
}: Omit<PatternInput, 'travelPx'> & {
  direction: 'up' | 'down' | 'left' | 'right'
  distance?: number
}): Motion => {
  const delay = framesOf(delayIn, fps, 0)
  const durationInFrames = framesOf(durationIn, fps, DURATION.base)
  const progress = spring({ frame: frame - delay, fps, config: SPRING_SMOOTH, durationInFrames })
  const opacity = interpolate(progress, [0, 1], [0, 1], CLAMP)
  // Positive offset at progress 0 for 'up'/'left' (starts below / right of rest).
  const isVertical = direction === 'up' || direction === 'down'
  const startSign = direction === 'up' || direction === 'left' ? 1 : -1
  const offset = interpolate(progress, [0, 1], [startSign * distance, 0], CLAMP)
  return {
    ...REST,
    opacity,
    x: isVertical ? 0 : offset,
    y: isVertical ? offset : 0,
  }
}

/** Opacity + scale from N → 1 on {@link SPRING_SMOOTH}. Restrained on purpose:
 *  default `from` is `0.9`; below ~0.85 reads as dramatic zoom.
 *
 *  Note: scene scale is about the node's local origin (0,0), not its center —
 *  for centered growth, wrap a subtree whose origin sits where you want the
 *  scale anchored. (Per-node transform-origin is a planned engine feature.) */
export const entryScale = ({
  frame,
  fps,
  delay: delayIn,
  durationInFrames: durationIn,
  from = 0.9,
}: Omit<PatternInput, 'travelPx'> & { from?: number }): Motion => {
  const delay = framesOf(delayIn, fps, 0)
  const durationInFrames = framesOf(durationIn, fps, DURATION.base)
  const progress = spring({ frame: frame - delay, fps, config: SPRING_SMOOTH, durationInFrames })
  const opacity = interpolate(progress, [0, 1], [0, 1], CLAMP)
  const scale = interpolate(progress, [0, 1], [from, 1], CLAMP)
  return { ...REST, opacity, scaleX: scale, scaleY: scale }
}

/** The default entrance — translate up + fade in on {@link SPRING_SMOOTH} at
 *  `DURATION.base`. Appropriate for ~80% of entering elements. */
export const entryFadeRise = ({
  frame,
  fps,
  delay: delayIn,
  durationInFrames: durationIn,
  travelPx = 12,
}: PatternInput): Motion => {
  const delay = framesOf(delayIn, fps, 0)
  const durationInFrames = framesOf(durationIn, fps, DURATION.base)
  const progress = spring({ frame: frame - delay, fps, config: SPRING_SMOOTH, durationInFrames })
  const opacity = interpolate(progress, [0, 1], [0, 1], CLAMP)
  const y = interpolate(progress, [0, 1], [travelPx, 0], CLAMP)
  return { ...REST, opacity, y }
}

/** Plain fade OUT — opacity 1 → 0 on {@link HOUSE_EASE}, no transform. The exit
 *  counterpart to {@link entryFade}. */
export const exitFade = ({
  frame,
  fps,
  delay: delayIn,
  durationInFrames: durationIn,
}: Omit<PatternInput, 'travelPx' | 'fps'> & { fps?: number }): Motion => {
  const delay = framesOf(delayIn, fps ?? 30, 0)
  const durationInFrames = framesOf(durationIn, fps ?? 30, DURATION.fast)
  const progress = interpolate(frame - delay, [0, durationInFrames], [0, 1], {
    ...CLAMP,
    easing: HOUSE_EASE,
  })
  return { ...REST, opacity: 1 - progress }
}

/** The default exit — translate down + fade out at `DURATION.fast` on
 *  {@link HOUSE_EASE}. Exits are ~30% faster than entries. */
export const exitFadeFall = ({
  frame,
  fps,
  delay: delayIn,
  durationInFrames: durationIn,
  travelPx = 8,
}: Omit<PatternInput, 'fps'> & { fps?: number }): Motion => {
  const delay = framesOf(delayIn, fps ?? 30, 0)
  const durationInFrames = framesOf(durationIn, fps ?? 30, DURATION.fast)
  const progress = interpolate(frame - delay, [0, durationInFrames], [0, 1], {
    ...CLAMP,
    easing: HOUSE_EASE,
  })
  return { ...REST, opacity: 1 - progress, y: progress * travelPx }
}

/** Directional fade + translate OUT — the exit counterpart to {@link entrySlide}.
 *  `direction` names where the element LEAVES toward. On {@link HOUSE_EASE}. */
export const exitSlide = ({
  frame,
  fps,
  delay: delayIn,
  durationInFrames: durationIn,
  direction,
  distance = 12,
}: Omit<PatternInput, 'travelPx' | 'fps'> & {
  fps?: number
  direction: 'up' | 'down' | 'left' | 'right'
  distance?: number
}): Motion => {
  const delay = framesOf(delayIn, fps ?? 30, 0)
  const durationInFrames = framesOf(durationIn, fps ?? 30, DURATION.fast)
  const progress = interpolate(frame - delay, [0, durationInFrames], [0, 1], {
    ...CLAMP,
    easing: HOUSE_EASE,
  })
  const isVertical = direction === 'up' || direction === 'down'
  const endSign = direction === 'down' || direction === 'right' ? 1 : -1
  const offset = interpolate(progress, [0, 1], [0, endSign * distance], CLAMP)
  return {
    ...REST,
    opacity: 1 - progress,
    x: isVertical ? 0 : offset,
    y: isVertical ? offset : 0,
  }
}

/** Fade + scale OUT — the exit counterpart to {@link entryScale}. Scales from 1
 *  to `to` (default 0.9) while fading, on {@link HOUSE_EASE}. */
export const exitScale = ({
  frame,
  fps,
  delay: delayIn,
  durationInFrames: durationIn,
  to = 0.9,
}: Omit<PatternInput, 'travelPx' | 'fps'> & { fps?: number; to?: number }): Motion => {
  const delay = framesOf(delayIn, fps ?? 30, 0)
  const durationInFrames = framesOf(durationIn, fps ?? 30, DURATION.fast)
  const progress = interpolate(frame - delay, [0, durationInFrames], [0, 1], {
    ...CLAMP,
    easing: HOUSE_EASE,
  })
  const scale = interpolate(progress, [0, 1], [1, to], CLAMP)
  return { ...REST, opacity: 1 - progress, scaleX: scale, scaleY: scale }
}

/** The two-phase hero landing — the Onda signature pattern. Phase 1: a
 *  {@link SPRING_SMOOTH} translate + fade over the full duration. Phase 2: a 3%
 *  scale overshoot ({@link OVERSHOOT}) near the end that settles back to 1.0. The
 *  two read as one continuous landing. Reserve for ≤1 element per scene. */
export const heroReveal = ({
  frame,
  fps,
  delay: delayIn,
  durationInFrames: durationIn,
  travelPx = 16,
}: PatternInput): Motion => {
  const delay = framesOf(delayIn, fps, 0)
  const durationInFrames = framesOf(durationIn, fps, DURATION.slow)
  const local = frame - delay
  const rise = spring({ frame: local, fps, config: SPRING_SMOOTH, durationInFrames })
  const opacity = interpolate(rise, [0, 1], [0, 1], CLAMP)
  const y = interpolate(rise, [0, 1], [travelPx, 0], CLAMP)
  // Triangle wave 0 → OVERSHOOT → 0 across ~10 frames, kicked off 4 frames
  // before phase 1 nominally completes so the landing reads as one motion.
  const landStart = durationInFrames - 4
  const scaleBump = interpolate(
    local,
    [landStart, landStart + 5, landStart + 10],
    [0, OVERSHOOT, 0],
    CLAMP,
  )
  const scale = 1 + scaleBump
  return { ...REST, opacity, y, scaleX: scale, scaleY: scale }
}

/** In-place state swap — for a value/label changing while its container stays
 *  put. Crossfade on {@link HOUSE_EASE}. Returns `{ outOpacity, inOpacity }` —
 *  apply to the old and new values (both rendered, layered, so it stays put). */
export const stateSwap = ({
  frame,
  fps,
  delay: delayIn,
  durationInFrames: durationIn,
}: Omit<PatternInput, 'travelPx' | 'fps'> & { fps?: number }): {
  outOpacity: number
  inOpacity: number
} => {
  const delay = framesOf(delayIn, fps ?? 30, 0)
  const durationInFrames = framesOf(durationIn, fps ?? 30, DURATION.fast)
  const local = frame - delay
  const half = durationInFrames / 2
  const outOpacity = interpolate(local, [0, half], [1, 0], { ...CLAMP, easing: HOUSE_EASE })
  const inOpacity = interpolate(local, [half, durationInFrames], [0, 1], {
    ...CLAMP,
    easing: HOUSE_EASE,
  })
  return { outOpacity, inOpacity }
}
