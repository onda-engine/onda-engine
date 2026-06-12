//! `timing.readingTime` — does every text stay up long enough to be read?
//!
//! Needed time = `max(1.2s, 0.25s × words + 0.6s)` — see constants.ts for the
//! research trail (BBC subtitle guidelines, Brysbaert 2019). Measured against
//! the entry's VISIBLE window (its duration clamped to the scene cut).

import { readingTimeSeconds } from './constants.js'
import type { Check, Violation } from './report.js'
import { textBlocks, totalWords } from './text.js'

export const checkReadingTime: Check = (ctx) => {
  const { resolved, theme } = ctx
  const violations: Violation[] = []
  for (const entry of [...resolved.entries, ...resolved.layerEntries]) {
    if (entry.role === 'ambient') continue // decoration isn't read
    const words = totalWords(textBlocks(entry, theme))
    if (words === 0) continue
    const needed = readingTimeSeconds(words)
    const visible = entry.visibleFrames / resolved.fps
    if (visible >= needed) continue
    const suggested = Math.ceil(needed * 10) / 10
    violations.push({
      check: 'timing.readingTime',
      severity: 'warn',
      targetId: entry.targetId,
      sceneId: entry.sceneId,
      message: `${entry.component} shows ${words} word${words === 1 ? '' : 's'} for ${(Math.round(visible * 100) / 100).toString()}s — ${suggested}s needed to read it (0.25s/word + 0.6s orientation, ≥1.2s)`,
      fix: { prop: 'for', suggested: `${suggested}s` },
    })
  }
  return violations
}
