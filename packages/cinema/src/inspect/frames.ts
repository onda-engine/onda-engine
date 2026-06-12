//! `frames.transitionCapture` — don't thumbnail a frame that's mid-transition.
//!
//! Given `opts.frames` (the indices a consumer intends to capture), flag any
//! that land inside a transition's overlap window — those frames show two
//! scenes blended. The fix is mechanical: the nearest frame outside the window.

import type { Check, Violation } from './report.js'

export const checkTransitionCapture: Check = (ctx) => {
  const frames = ctx.opts.frames
  if (!frames || frames.length === 0) return []
  const { resolved } = ctx
  const violations: Violation[] = []

  for (const f of frames) {
    const hit = resolved.transitions.find((t) => f >= t.start && f < t.start + t.durationInFrames)
    if (!hit) continue
    // Nearest frame outside the window, clamped to the composition.
    const before = hit.start - 1
    const after = hit.start + hit.durationInFrames
    const candidates = [before, after].filter((c) => c >= 0 && c < resolved.totalFrames)
    const suggested =
      candidates.length > 0
        ? candidates.reduce((best, c) => (Math.abs(c - f) < Math.abs(best - f) ? c : best))
        : f
    violations.push({
      check: 'frames.transitionCapture',
      severity: 'warn',
      targetId: hit.sceneId,
      sceneId: hit.sceneId,
      message: `frame ${f} lands inside the "${hit.type}" transition into "${hit.sceneId}" (frames ${hit.start}–${hit.start + hit.durationInFrames - 1}) — it captures two scenes blended`,
      fix: { prop: 'frames', suggested },
    })
  }
  return violations
}
