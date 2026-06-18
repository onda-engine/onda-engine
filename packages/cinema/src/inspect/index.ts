//! The INSPECTOR — deterministic quality metrics over a composition payload.
//!
//! `inspect(payload, opts?)` measures the SAME document `validateComposition`
//! checks and `buildComposition` renders, resolved to frames with the same
//! helpers, and returns structured violations: legibility (font floors + WCAG
//! contrast), layout overflow vs per-platform safe areas, reading time, focal
//! entrance/settle/transition collisions, per-scene density, and
//! transition-window thumbnail capture. Every threshold lives in
//! `constants.ts` with its source.
//!
//! Where `validateComposition` answers "will this render?", `inspect` answers
//! "will this read?" — both deterministic, both agent-correctable.
//!
//! Text widths use the engine's cosmic-text metrics; call
//! `preloadTextMetrics()` (from `@onda-engine/components`) before inspecting in Node
//! for shaped widths instead of the glyph-count estimate.

import { defaultTheme } from '@onda-engine/components'
import type { CompositionPayload } from '../types.js'
import { checkCollisions } from './collisions.js'
import { SAFE_AREAS, inferFormat } from './constants.js'
import { checkDensity, densityMetrics } from './density.js'
import { checkTransitionCapture } from './frames.js'
import { checkLegibility } from './legibility.js'
import { checkOverflow } from './overflow.js'
import { checkReadingTime } from './reading.js'
import type {
  Check,
  CheckContext,
  CheckId,
  InspectOptions,
  InspectReport,
  SceneDensity,
  Violation,
} from './report.js'
import { resolveComposition } from './resolve.js'

export {
  CONTRAST_MIN_BODY,
  CONTRAST_MIN_LARGE,
  DENSITY_MAX_FOCAL,
  DENSITY_MAX_NON_AMBIENT,
  FOCAL_COLLISION_WINDOW_SECONDS,
  FONT_FLOOR_PX,
  type FormatId,
  READ_MIN_SECONDS,
  READ_ORIENTATION_SECONDS,
  READ_SECONDS_PER_WORD,
  SAFE_AREAS,
  type SafeAreaPreset,
  TRANSITION_BUDGET_SECONDS,
  fontFloorPx,
  inferFormat,
  readingTimeSeconds,
} from './constants.js'
export { contrastRatio, parseColor, relativeLuminance, type Rgb } from './color.js'
export type {
  Check,
  CheckContext,
  CheckId,
  InspectOptions,
  InspectReport,
  SceneDensity,
  Violation,
} from './report.js'
export {
  type ResolvedComposition,
  type ResolvedEntry,
  type ResolvedScene,
  type TransitionWindow,
  resolveComposition,
} from './resolve.js'
export { type TextBlock, textBlocks, totalWords } from './text.js'

/** The check registry, in the order they run. */
export const CHECKS: Record<CheckId, Check> = {
  'text.legibility': checkLegibility,
  'layout.overflow': checkOverflow,
  'timing.readingTime': checkReadingTime,
  'timing.collisions': checkCollisions,
  'density.score': checkDensity,
  'frames.transitionCapture': checkTransitionCapture,
}

/**
 * Measure a composition payload against the quality checks. Deterministic —
 * the same payload + options always yields the same report. Assumes a
 * structurally valid payload (run `validateComposition` first; `inspect`
 * tolerates but does not re-diagnose structural errors).
 */
export function inspect(payload: CompositionPayload, opts: InspectOptions = {}): InspectReport {
  const resolved = resolveComposition(payload)
  const format = opts.format ?? inferFormat(resolved.width, resolved.height)
  const ctx: CheckContext = {
    payload,
    resolved,
    format,
    safe: SAFE_AREAS[format],
    theme: {
      text: payload.brand?.text ?? defaultTheme.text,
      textMuted: payload.brand?.dim ?? defaultTheme.textMuted,
      background: payload.brand?.bg ?? '#08080a',
    },
    opts,
  }
  const violations: Violation[] = []
  for (const check of Object.values(CHECKS)) violations.push(...check(ctx))

  const summary = { error: 0, warn: 0, info: 0 }
  for (const v of violations) summary[v.severity]++

  const density: SceneDensity[] = densityMetrics(resolved)
  return {
    violations,
    summary,
    format,
    fps: resolved.fps,
    totalFrames: resolved.totalFrames,
    density,
  }
}
