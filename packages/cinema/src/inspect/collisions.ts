//! `timing.collisions` — attention can't be in two places at once.
//!
//! Three measurements:
//! 1. Two FOCAL entrances beginning within the 250ms attention window
//!    (attentional blink: a second target 200–500ms after a first is routinely
//!    missed — Raymond, Shapiro & Arnell 1992; see constants.ts).
//! 2. An entrance whose settle (the `@onda-engine/components` settleTime registry —
//!    the same formulas the components run) outlives the entry's visible
//!    window: the move is cut off mid-flight.
//! 3. A scene transition longer than the 0.6s budget.

import { manifestEntry, settleTime } from '@onda-engine/components'
import { FOCAL_COLLISION_WINDOW_SECONDS, TRANSITION_BUDGET_SECONDS } from './constants.js'
import type { Check, Violation } from './report.js'

const secs = (frames: number, fps: number): string =>
  `${(Math.round((frames / fps) * 100) / 100).toString()}s`

export const checkCollisions: Check = (ctx) => {
  const { resolved } = ctx
  const { fps } = resolved
  const violations: Violation[] = []

  // 1. Focal entrances within the collision window (absolute frames, so
  //    cross-cut overlaps during a transition count too).
  const windowFrames = FOCAL_COLLISION_WINDOW_SECONDS * fps
  const focal = resolved.entries
    .filter((e) => e.role === 'focal' && e.visibleFrames > 0)
    .sort((a, b) => a.absStart - b.absStart)
  for (let i = 1; i < focal.length; i++) {
    const a = focal[i - 1]
    const b = focal[i]
    if (!a || !b) continue
    const gap = b.absStart - a.absStart
    if (gap <= windowFrames) {
      violations.push({
        check: 'timing.collisions',
        severity: 'warn',
        targetId: b.targetId,
        sceneId: b.sceneId,
        message: `focal entrances collide: "${a.targetId}" and "${b.targetId}" begin ${secs(gap, fps)} apart (≤${FOCAL_COLLISION_WINDOW_SECONDS}s — inside the attention window; stagger them or demote one to 'support')`,
      })
    }
  }

  // 2. Entrance settles after the cut.
  for (const entry of resolved.entries) {
    const settle = settleTime(entry.component, entry.adapted, fps)
    if (settle === null || entry.visibleFrames <= 0) continue
    if (settle > entry.visibleFrames) {
      const fitsViaClamp = manifestEntry(entry.component)?.props.some((p) => p.name === 'fitToClip')
      violations.push({
        check: 'timing.collisions',
        severity: 'warn',
        targetId: entry.targetId,
        sceneId: entry.sceneId,
        message: `${entry.component}'s entrance settles at ${secs(settle, fps)} but it is only on screen for ${secs(entry.visibleFrames, fps)} — the move is cut off mid-flight`,
        // Mechanical: the component's own envelope clamp, when it has one.
        fix: fitsViaClamp ? { prop: 'fitToClip', suggested: true } : undefined,
      })
    }
  }

  // 3. Transition budget.
  const budgetFrames = Math.round(TRANSITION_BUDGET_SECONDS * fps)
  for (const t of resolved.transitions) {
    if (t.durationInFrames > budgetFrames) {
      violations.push({
        check: 'timing.collisions',
        severity: 'warn',
        targetId: t.sceneId,
        sceneId: t.sceneId,
        message: `"${t.type}" transition into "${t.sceneId}" runs ${secs(t.durationInFrames, fps)} — over the ${TRANSITION_BUDGET_SECONDS}s budget (both scenes read as mush for the whole overlap)`,
        fix: { prop: 'transition.durationInFrames', suggested: budgetFrames },
      })
    }
  }

  return violations
}
