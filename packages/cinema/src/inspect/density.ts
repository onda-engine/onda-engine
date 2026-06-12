//! `density.score` — how much is on screen at once, per scene?
//!
//! An event sweep over entry visible windows finds each scene's PEAK count of
//! concurrently visible non-ambient entries (and focal entries). Budgets:
//! ≤5 non-ambient, ≤1 focal (see constants.ts — product decisions). The peaks
//! are always reported on the InspectReport; violations fire over budget.

import { DENSITY_MAX_FOCAL, DENSITY_MAX_NON_AMBIENT } from './constants.js'
import type { Check, SceneDensity, Violation } from './report.js'
import type { ResolvedComposition } from './resolve.js'

/** Sweep one scene's entries → its density peaks. */
function sceneDensity(resolved: ResolvedComposition, sceneIndex: number): SceneDensity {
  const sceneId = resolved.scenes[sceneIndex]?.scene.id ?? `scene-${sceneIndex}`
  // Boundary events in scene-local frames: +1 at visible start, -1 at end.
  const events: { frame: number; nonAmbient: number; focal: number }[] = []
  for (const e of resolved.entries) {
    if (e.sceneIndex !== sceneIndex || e.visibleFrames <= 0) continue
    const nonAmbient = e.role === 'ambient' ? 0 : 1
    const focalDelta = e.role === 'focal' ? 1 : 0
    events.push({ frame: e.localStart, nonAmbient, focal: focalDelta })
    events.push({
      frame: e.localStart + e.visibleFrames,
      nonAmbient: -nonAmbient,
      focal: -focalDelta,
    })
  }
  // Ends sort before starts at the same frame (`[start, end)` windows don't touch).
  events.sort((a, b) => a.frame - b.frame || a.nonAmbient - b.nonAmbient)
  let nonAmbient = 0
  let focal = 0
  let peakNonAmbient = 0
  let peakFocal = 0
  let peakFrame = 0
  for (const ev of events) {
    nonAmbient += ev.nonAmbient
    focal += ev.focal
    if (nonAmbient > peakNonAmbient) {
      peakNonAmbient = nonAmbient
      peakFrame = ev.frame
    }
    if (focal > peakFocal) peakFocal = focal
  }
  return { sceneId, peakNonAmbient, peakFocal, peakFrame }
}

/** All scenes' density metrics (the report carries these regardless of budget). */
export function densityMetrics(resolved: ResolvedComposition): SceneDensity[] {
  return resolved.scenes.map((_, i) => sceneDensity(resolved, i))
}

export const checkDensity: Check = (ctx) => {
  const violations: Violation[] = []
  for (const d of densityMetrics(ctx.resolved)) {
    if (d.peakNonAmbient > DENSITY_MAX_NON_AMBIENT) {
      violations.push({
        check: 'density.score',
        severity: 'warn',
        targetId: d.sceneId,
        sceneId: d.sceneId,
        message: `scene "${d.sceneId}" peaks at ${d.peakNonAmbient} concurrently visible non-ambient entries (frame ${d.peakFrame}, scene-local) — budget is ${DENSITY_MAX_NON_AMBIENT}; cut, stagger, or mark atmosphere 'ambient'`,
      })
    }
    if (d.peakFocal > DENSITY_MAX_FOCAL) {
      violations.push({
        check: 'density.score',
        severity: 'warn',
        targetId: d.sceneId,
        sceneId: d.sceneId,
        message: `scene "${d.sceneId}" shows ${d.peakFocal} focal entries at once — only ${DENSITY_MAX_FOCAL} thing can be THE thing; demote the rest to 'support'`,
      })
    }
  }
  return violations
}
