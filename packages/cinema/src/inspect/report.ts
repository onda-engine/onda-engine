//! The inspector's report vocabulary — violation shape + the context every
//! check family receives. Kept separate from `index.ts` (the runner) so check
//! modules don't import their own runner.

import type { CompositionPayload } from '../types.js'
import type { FormatId, SafeAreaPreset } from './constants.js'
import type { ResolvedComposition } from './resolve.js'
import type { InspectTheme } from './text.js'

/** Every check the inspector runs. */
export type CheckId =
  | 'text.legibility'
  | 'layout.overflow'
  | 'timing.readingTime'
  | 'timing.collisions'
  | 'density.score'
  | 'frames.transitionCapture'

/** One measured violation. `fix` is MECHANICAL metadata only (a minimum font
 *  size, a safe frame index) — never a taste call. */
export interface Violation {
  check: CheckId
  severity: 'error' | 'warn' | 'info'
  /** The offending entry's `id` (when set) else its payload path; a scene id
   *  for scene-level violations. */
  targetId: string
  sceneId?: string
  message: string
  fix?: { prop: string; suggested: unknown }
}

/** Inspector options. */
export interface InspectOptions {
  /** Delivery format (drives safe areas + font floors). Default: inferred from
   *  the canvas aspect ratio. */
  format?: FormatId
  /** Frame indices a consumer intends to capture (thumbnails) — checked
   *  against transition windows. */
  frames?: number[]
}

/** Per-scene density metrics (always reported, violation or not). */
export interface SceneDensity {
  sceneId: string
  /** Peak concurrently-visible non-ambient entries. */
  peakNonAmbient: number
  /** Peak concurrently-visible focal entries. */
  peakFocal: number
  /** Scene-local frame where the non-ambient peak first occurs. */
  peakFrame: number
}

/** What `inspect` returns: the violations plus the measured context. */
export interface InspectReport {
  violations: Violation[]
  summary: { error: number; warn: number; info: number }
  format: FormatId
  fps: number
  totalFrames: number
  density: SceneDensity[]
}

/** Everything a check family gets to measure against. */
export interface CheckContext {
  payload: CompositionPayload
  resolved: ResolvedComposition
  format: FormatId
  safe: SafeAreaPreset
  theme: InspectTheme
  opts: InspectOptions
}

/** A check family: context in, violations out. */
export type Check = (ctx: CheckContext) => Violation[]
