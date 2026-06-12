//! Resolve a composition payload to the FRAME timeline the checks measure on —
//! the same resolution `buildComposition` performs (shared `scenePlacements` +
//! `toFrames` + `adaptProps`), minus the React tree. Every entry gets absolute
//! start/visible frames, its effective (size-role-resolved) props, and its
//! attention role.

import { adaptProps } from '../props.js'
import { scenePlacements, toFrames, totalFrames } from '../timing.js'
import type { CompositionPayload, Entry, EntryRole, LayerEntry, Scene } from '../types.js'

/** A scene with its absolute timeline placement (frames). */
export interface ResolvedScene {
  scene: Scene
  index: number
  /** Absolute start frame (= the start of its incoming transition overlap). */
  start: number
  durationInFrames: number
}

/** One entry resolved onto the absolute timeline. */
export interface ResolvedEntry {
  /** `'scene'` = a track entry; `'layer'` = a composition-level layer entry. */
  kind: 'scene' | 'layer'
  component: string
  /** Raw payload props. */
  props: Record<string, unknown>
  /** Effective props after the Studio→engine translation (size roles → px,
   *  prop-name aliases) — what the component actually receives. */
  adapted: Record<string, unknown>
  /** Attention role; absent = `'support'` (the contract on `Entry.role`). */
  role: EntryRole
  /** `entry.id` when present, else the payload path (stable + addressable). */
  targetId: string
  /** Payload path (`scenes[0].tracks[1].entries[2]`). */
  path: string
  sceneId?: string
  sceneIndex?: number
  trackIndex?: number
  entryIndex?: number
  /** Start frame: scene-local for scene entries, absolute for layer entries. */
  localStart: number
  /** Absolute start frame on the composition timeline. */
  absStart: number
  /** Requested duration in frames. */
  durationInFrames: number
  /** Frames actually on screen: duration clamped to the scene window (scene
   *  entries) / composition end (layer entries). */
  visibleFrames: number
  /** Layer entries only: `true` = renders UNDER the scene spine (a background). */
  under?: boolean
  raw: Entry | LayerEntry
}

/** A transition's absolute capture window. */
export interface TransitionWindow {
  /** Index of the scene the transition leads INTO. */
  sceneIndex: number
  sceneId: string
  type: string
  /** Absolute first frame of the overlap. */
  start: number
  /** Effective overlap length in frames (after the ⅓-of-shorter-scene clamp). */
  durationInFrames: number
}

/** The payload resolved to frames — everything the checks consume. */
export interface ResolvedComposition {
  payload: CompositionPayload
  fps: number
  width: number
  height: number
  totalFrames: number
  scenes: ResolvedScene[]
  /** Scene (track) entries. */
  entries: ResolvedEntry[]
  /** Composition-level layer entries (absolute-timed). */
  layerEntries: ResolvedEntry[]
  transitions: TransitionWindow[]
}

/** Resolve `payload` the way `buildComposition` does (same helpers), producing
 *  the measurable timeline model. Assumes a structurally valid payload — run
 *  `validateComposition` first for structural diagnostics. */
export function resolveComposition(payload: CompositionPayload): ResolvedComposition {
  const fps = payload.fps > 0 ? payload.fps : 30
  const { width, height } = payload
  const scenesIn = payload.scenes ?? []
  const placements = scenePlacements(scenesIn, fps)
  const total = totalFrames(payload, fps)

  const scenes: ResolvedScene[] = scenesIn.map((scene, index) => ({
    scene,
    index,
    start: placements[index]?.start ?? 0,
    durationInFrames: placements[index]?.durationInFrames ?? 1,
  }))

  const transitions: TransitionWindow[] = []
  scenesIn.forEach((scene, i) => {
    const overlap = placements[i]?.overlapIn ?? 0
    if (i > 0 && scene.transition && overlap > 0) {
      transitions.push({
        sceneIndex: i,
        sceneId: scene.id,
        type: scene.transition.type,
        start: placements[i]?.start ?? 0,
        durationInFrames: overlap,
      })
    }
  })

  const entries: ResolvedEntry[] = []
  for (const { scene, index: si, start: sceneStart, durationInFrames: sceneDur } of scenes) {
    scene.tracks?.forEach((track, ti) => {
      track.entries.forEach((entry, ei) => {
        const path = `scenes[${si}].tracks[${ti}].entries[${ei}]`
        const localStart = toFrames(entry.at, fps)
        const dur = toFrames(entry.for, fps)
        const visibleEnd = Math.min(localStart + dur, sceneDur)
        entries.push({
          kind: 'scene',
          component: entry.component,
          props: entry.props ?? {},
          adapted: adaptProps(entry.component, entry.props, width, height),
          role: entry.role ?? 'support',
          targetId: entry.id ?? path,
          path,
          sceneId: scene.id,
          sceneIndex: si,
          trackIndex: ti,
          entryIndex: ei,
          localStart,
          absStart: sceneStart + localStart,
          durationInFrames: dur,
          visibleFrames: Math.max(0, visibleEnd - localStart),
          raw: entry,
        })
      })
    })
  }

  const layerEntries: ResolvedEntry[] = []
  payload.layers?.forEach((layer, li) => {
    layer.entries.forEach((entry, ei) => {
      const path = `layers[${li}].entries[${ei}]`
      const from = toFrames(entry.at ?? 0, fps)
      const dur = entry.for != null ? toFrames(entry.for, fps) : Math.max(1, total - from)
      layerEntries.push({
        kind: 'layer',
        component: entry.component,
        props: entry.props ?? {},
        adapted: adaptProps(entry.component, entry.props, width, height),
        role: 'support',
        targetId: entry.id ?? path,
        path,
        localStart: from,
        absStart: from,
        durationInFrames: dur,
        visibleFrames: Math.max(0, Math.min(from + dur, total) - from),
        under: Boolean(layer.under),
        raw: entry,
      })
    })
  })

  return {
    payload,
    fps,
    width,
    height,
    totalFrames: total,
    scenes,
    entries,
    layerEntries,
    transitions,
  }
}

/** Do two absolute frame windows `[aStart, aStart+aLen)` / `[bStart, bStart+bLen)`
 *  overlap? */
export function windowsOverlap(
  aStart: number,
  aLen: number,
  bStart: number,
  bLen: number,
): boolean {
  return aStart < bStart + bLen && bStart < aStart + aLen
}
