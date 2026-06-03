//! Time/frame math — mirrors Studio's `composition.ts` helpers so scene windows
//! and audio offsets line up with what actually plays.

import type { CompositionPayload, Scene, TimeSpec } from './types.js'

/** Parse a TimeSpec to seconds. `fps` is needed for frame specs (`"90f"`). */
export function timeSpecToSeconds(spec: TimeSpec | undefined, fps: number): number {
  if (spec == null) return 0
  if (typeof spec === 'number') return spec >= 0 ? spec : 0
  const s = spec.trim()
  if (s === '') return 0
  if (s.includes(':')) {
    const [m, sec] = s.split(':')
    return (Number(m) || 0) * 60 + (Number(sec) || 0)
  }
  if (s.endsWith('ms')) return (Number(s.slice(0, -2)) || 0) / 1000
  if (s.endsWith('f')) return (Number(s.slice(0, -1)) || 0) / fps
  if (s.endsWith('s')) return Number(s.slice(0, -1)) || 0
  return Number(s) || 0
}

/** A TimeSpec in frames. */
export function toFrames(spec: TimeSpec | undefined, fps: number): number {
  return Math.round(timeSpecToSeconds(spec, fps) * fps)
}

/** A scene's duration in seconds: explicit `for`, else derived from the
 *  latest-ending entry, else a 3s fallback. */
export function sceneDurationSeconds(scene: Scene, fps: number): number {
  if (scene.for != null) return timeSpecToSeconds(scene.for, fps)
  let max = 0
  for (const track of scene.tracks) {
    for (const e of track.entries) {
      const end = timeSpecToSeconds(e.at, fps) + timeSpecToSeconds(e.for, fps)
      if (end > max) max = end
    }
  }
  return max > 0 ? max : 3
}

/** A scene's duration in frames. */
export function sceneDurationFrames(scene: Scene, fps: number): number {
  return Math.max(1, Math.round(sceneDurationSeconds(scene, fps) * fps))
}

const DEFAULT_TRANSITION_FRAMES = 15

/** Frames a scene's incoming transition overlaps the previous scene — clamped to
 *  ≤ ⅓ of the shorter neighbor. */
export function transitionOverlapFrames(
  prev: Scene | undefined,
  scene: Scene,
  fps: number,
): number {
  if (!prev || !scene.transition) return 0
  const requested = scene.transition.durationInFrames ?? DEFAULT_TRANSITION_FRAMES
  const shorter = Math.min(sceneDurationFrames(prev, fps), sceneDurationFrames(scene, fps))
  return Math.max(1, Math.min(requested, Math.floor(shorter / 3)))
}

/** The composition's total length in frames (scene durations minus overlaps). */
export function totalFrames(payload: CompositionPayload, fps: number): number {
  let total = 0
  let prev: Scene | undefined
  for (const scene of payload.scenes) {
    total -= transitionOverlapFrames(prev, scene, fps)
    total += sceneDurationFrames(scene, fps)
    prev = scene
  }
  return Math.max(1, total)
}
