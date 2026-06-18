//! `text.legibility` — is every readable string big enough and contrasty enough?
//!
//! Two measurements per text block:
//! 1. Font size vs the per-format research floor (legibility.info: 40px body
//!    minimum for full-HD phone-first formats — see constants.ts).
//! 2. WCAG 2.x contrast of the text color vs what's BEHIND its placement box,
//!    found by walking the z-order beneath the entry: solid fills and gradient
//!    stops are checked analytically (worst stop wins, translucent veils are
//!    alpha-composited); an image/video behind yields an `info` — contrast is
//!    unverifiable analytically.

import { manifestEntry } from '@onda-engine/components'
import type { Brand } from '../types.js'
import { type Rgb, contrastRatio, parseColor } from './color.js'
import {
  BOLD_WEIGHT,
  CONTRAST_MIN_BODY,
  CONTRAST_MIN_LARGE,
  LARGE_TEXT_BOLD_PX,
  LARGE_TEXT_PX,
  fontFloorPx,
} from './constants.js'
import type { Check, Violation } from './report.js'
import type { ResolvedComposition, ResolvedEntry } from './resolve.js'
import { windowsOverlap } from './resolve.js'
import { parseDefault, textBlocks } from './text.js'

/** Components that cover the whole frame for backdrop purposes. The manifest's
 *  `occlusion`/`sceneRole` carry the signal; Scrim is metadata'd
 *  `non_occluding` (it doesn't COMPETE for attention) but is literally a
 *  full-frame veil, so it's force-included. */
function isCovering(component: string): boolean {
  if (component === 'Scrim') return true
  const m = manifestEntry(component)
  return m?.occlusion === 'full_frame' || m?.sceneRole === 'background'
}

/** Does the entry place image/video pixels on screen? (Manifest `url`-role
 *  prop or the Media category.) */
function isMediaBearing(entry: ResolvedEntry): boolean {
  const m = manifestEntry(entry.component)
  if (!m) return false
  if (m.category === 'Media') return true
  return m.props.some(
    (p) => p.role === 'url' && (p.required || entry.adapted[p.name] !== undefined),
  )
}

/** The candidate fill colors of a covering entry: every `color`-role prop's
 *  explicit value or manifest default (string or string[]). */
function fillColors(entry: ResolvedEntry): Rgb[] {
  const m = manifestEntry(entry.component)
  if (!m) return []
  const out: Rgb[] = []
  for (const p of m.props) {
    if (p.role !== 'color') continue
    const value = entry.adapted[p.name] ?? parseDefault(p.default)
    const candidates = Array.isArray(value) ? value : [value]
    for (const c of candidates) {
      const parsed = parseColor(c)
      if (parsed) out.push(parsed)
    }
  }
  // Scrim's documented default is a white veil (schema carries no literal).
  if (out.length === 0 && entry.component === 'Scrim') {
    const white = parseColor('#ffffff')
    if (white) out.push(white)
  }
  return out
}

/** A covering entry's overall coverage opacity (its `opacity` prop, default 1). */
function coverOpacity(entry: ResolvedEntry): number {
  const m = manifestEntry(entry.component)
  const meta = m?.props.find((p) => p.name === 'opacity')
  const v = entry.adapted.opacity ?? parseDefault(meta?.default)
  return typeof v === 'number' && v >= 0 && v <= 1 ? v : 1
}

/** Alpha-composite `top` (with extra `alpha`) over `under`. */
function over(top: Rgb, alpha: number, under: Rgb): Rgb {
  const a = Math.max(0, Math.min(1, alpha * top.a))
  return {
    r: top.r * a + under.r * (1 - a),
    g: top.g * a + under.g * (1 - a),
    b: top.b * a + under.b * (1 - a),
    a: 1,
  }
}

/** What's behind `target` over its visible window: solid color(s), media, or
 *  unknown. Walks the z-order beneath it (same-scene lower tracks / earlier
 *  same-track entries, then `under` layers, then the composition background),
 *  top-down, compositing translucent veils. */
export function backdropFor(
  target: ResolvedEntry,
  resolved: ResolvedComposition,
): { kind: 'colors'; colors: Rgb[] } | { kind: 'media' } | { kind: 'unknown' } {
  // Beneath-the-target candidates, BOTTOM-up in z.
  const beneath: ResolvedEntry[] = []
  const overlapsTarget = (e: ResolvedEntry): boolean =>
    windowsOverlap(e.absStart, e.visibleFrames, target.absStart, target.visibleFrames)
  for (const e of resolved.layerEntries) {
    if (e.under && overlapsTarget(e)) beneath.push(e)
  }
  if (target.kind === 'scene') {
    for (const e of resolved.entries) {
      if (e.sceneIndex !== target.sceneIndex || !overlapsTarget(e)) continue
      const ti = e.trackIndex ?? 0
      const ei = e.entryIndex ?? 0
      const tTi = target.trackIndex ?? 0
      const tEi = target.entryIndex ?? 0
      if (ti < tTi || (ti === tTi && ei < tEi)) beneath.push(e)
    }
  } else {
    // An overlay layer rides above every scene entry.
    for (const e of resolved.entries) if (overlapsTarget(e)) beneath.push(e)
  }

  // Walk TOP-down; collect translucent veils until an opaque backdrop.
  const veils: { colors: Rgb[]; alpha: number }[] = []
  for (let i = beneath.length - 1; i >= 0; i--) {
    const e = beneath[i]
    if (!e || !isCovering(e.component)) continue
    if (isMediaBearing(e)) return { kind: 'media' }
    const colors = fillColors(e)
    if (colors.length === 0) return { kind: 'unknown' }
    const alpha = coverOpacity(e)
    const opaque = alpha >= 0.95 && colors.every((c) => c.a >= 0.95)
    if (opaque) return { kind: 'colors', colors: composite(colors, veils) }
    veils.push({ colors, alpha })
  }
  const bg = parseColor(resolveBackground(resolved.payload.brand))
  if (!bg) return { kind: 'unknown' }
  return { kind: 'colors', colors: composite([bg], veils) }
}

/** The composition's base background — `brand.bg` else the renderer's literal. */
export function resolveBackground(brand: Brand | undefined): string {
  return brand?.bg ?? '#08080a'
}

// Composite the recorded veils (top-down order) over each base color.
function composite(base: Rgb[], veils: { colors: Rgb[]; alpha: number }[]): Rgb[] {
  let result = base
  for (let i = veils.length - 1; i >= 0; i--) {
    const veil = veils[i]
    if (!veil) continue
    const next: Rgb[] = []
    for (const under of result)
      for (const top of veil.colors) next.push(over(top, veil.alpha, under))
    result = next
  }
  return result
}

/** WCAG threshold for a text block: 3:1 for large text (≥24px regular /
 *  ≥18.67px bold), 4.5:1 otherwise. */
export function requiredContrast(fontSize: number, fontWeight: number): number {
  const large =
    fontSize >= LARGE_TEXT_PX || (fontWeight >= BOLD_WEIGHT && fontSize >= LARGE_TEXT_BOLD_PX)
  return large ? CONTRAST_MIN_LARGE : CONTRAST_MIN_BODY
}

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString()

export const checkLegibility: Check = (ctx) => {
  const { resolved, theme, format } = ctx
  const floor = fontFloorPx(format, resolved.width, resolved.height)
  const violations: Violation[] = []

  for (const entry of [...resolved.entries, ...resolved.layerEntries]) {
    const blocks = textBlocks(entry, theme)
    if (blocks.length === 0) continue

    // 1. Font floor.
    for (const b of blocks) {
      if (b.fontSize < floor) {
        violations.push({
          check: 'text.legibility',
          severity: 'warn',
          targetId: entry.targetId,
          sceneId: entry.sceneId,
          message: `${entry.component} "${b.textProp}" is ${fmt(b.fontSize)}px — below the ${fmt(floor)}px ${format} floor (body text on a phone-scale canvas needs ≥${fmt(floor)}px; legibility.info video-text rules)`,
          fix: { prop: b.sizeProp ?? 'fontSize', suggested: Math.ceil(floor) },
        })
      }
    }

    // 2. Contrast vs the backdrop.
    const backdrop = backdropFor(entry, resolved)
    if (backdrop.kind === 'media') {
      violations.push({
        check: 'text.legibility',
        severity: 'info',
        targetId: entry.targetId,
        sceneId: entry.sceneId,
        message: `${entry.component} sits over image/video — contrast unverifiable analytically (verify on a rendered frame, or put a Scrim behind it)`,
      })
      continue
    }
    if (backdrop.kind === 'unknown') {
      violations.push({
        check: 'text.legibility',
        severity: 'info',
        targetId: entry.targetId,
        sceneId: entry.sceneId,
        message: `${entry.component}'s backdrop color can't be resolved analytically — contrast unverified`,
      })
      continue
    }
    for (const b of blocks) {
      const textColor = parseColor(b.color)
      if (!textColor) continue
      const required = requiredContrast(b.fontSize, b.fontWeight)
      let worst = Number.POSITIVE_INFINITY
      for (const c of backdrop.colors) worst = Math.min(worst, contrastRatio(textColor, c))
      if (worst < required) {
        violations.push({
          check: 'text.legibility',
          severity: 'error',
          targetId: entry.targetId,
          sceneId: entry.sceneId,
          message: `${entry.component} "${b.textProp}" contrast is ${fmt(worst)}:1 against its backdrop — below the WCAG ${fmt(required)}:1 minimum for ${fmt(b.fontSize)}px text (SC 1.4.3)`,
        })
      }
    }
  }
  return violations
}
