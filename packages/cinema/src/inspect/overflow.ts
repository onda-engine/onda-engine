//! `layout.overflow` — does measured text stay inside the frame and the
//! format's safe area?
//!
//! Width comes from the engine's own text metrics (`measureText`, cosmic-text
//! via wasm — warm it with `preloadTextMetrics()` in Node for real numbers; the
//! glyph-count estimate is the documented fallback). Placement resolves through
//! the shared `resolvePlacement` contract with the measured element size, so
//! the checked box is where the component actually sits. Entries whose own
//! `fit`/`maxWidth` auto-fit caps the line are measured at the FITTED size.

import {
  type Placement,
  fitFontSize,
  fitMaxWidth,
  isPlacement,
  measureText,
  resolvePlacement,
} from '@onda/components'
import type { Check, Violation } from './report.js'
import { WRAPPING_COMPONENTS, textBlocks } from './text.js'

export const checkOverflow: Check = (ctx) => {
  const { resolved, safe, theme, format } = ctx
  const { width, height } = resolved
  const safeRect = {
    left: safe.left * width,
    top: safe.top * height,
    right: width - safe.right * width,
    bottom: height - safe.bottom * height,
  }
  const violations: Violation[] = []

  for (const entry of [...resolved.entries, ...resolved.layerEntries]) {
    if (WRAPPING_COMPONENTS.has(entry.component)) continue // wraps, never one long line
    const blocks = textBlocks(entry, theme)
    for (const b of blocks) {
      if (b.content.includes('\n')) continue // multi-line content stacks, not one line
      const measureOpts = {
        fontFamily: b.fontFamily,
        fontWeight: b.fontWeight,
        letterSpacing: b.letterSpacing,
      }
      // Honor the component's own auto-fit: measure at the size it would land on.
      const cap = fitMaxWidth({ fit: b.fit, maxWidth: b.maxWidth }, width)
      const size =
        cap !== undefined ? fitFontSize(b.content, b.fontSize, cap, measureOpts) : b.fontSize
      const m = measureText(b.content, size, measureOpts)
      if (m.width <= 0) continue

      const placement = entry.adapted.placement
      const box = resolvePlacement(
        isPlacement(placement) ? (placement as Placement) : undefined,
        { width, height },
        { width: m.width, height: m.height },
      )
      const x0 = box.originX
      const y0 = box.originY
      const x1 = x0 + m.width
      const y1 = y0 + m.height

      const escapesFrame = x0 < 0 || y0 < 0 || x1 > width || y1 > height
      const escapesSafe =
        x0 < safeRect.left || y0 < safeRect.top || x1 > safeRect.right || y1 > safeRect.bottom
      if (!escapesFrame && !escapesSafe) continue

      // Mechanical fix: the largest size at which the box sits inside the safe
      // rect AT ITS PLACEMENT — found by reusing the SAME resolve+measure
      // predicate as the check above, not a flat width fit. (Fitting to the raw
      // safe-area WIDTH is wrong for a CENTERED element under ASYMMETRIC safe
      // margins — e.g. 9:16, whose right/bottom band is wider: a centered box
      // bumps the nearer edge first, so a width-only fit still overflows and the
      // agent shrink-loops. Reusing the box-in-rect predicate converges by
      // construction.)
      const boxFitsSafe = (fs: number): boolean => {
        const fm = measureText(b.content, fs, measureOpts)
        const fb = resolvePlacement(
          isPlacement(placement) ? (placement as Placement) : undefined,
          { width, height },
          { width: fm.width, height: fm.height },
        )
        return (
          fb.originX >= safeRect.left &&
          fb.originY >= safeRect.top &&
          fb.originX + fm.width <= safeRect.right &&
          fb.originY + fm.height <= safeRect.bottom
        )
      }
      let lo = 1
      let hi = Math.floor(size)
      let fitted = 0
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (boxFitsSafe(mid)) {
          fitted = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      const fix =
        b.sizeProp && fitted > 0 && fitted < size
          ? { prop: b.sizeProp, suggested: fitted }
          : undefined

      violations.push({
        check: 'layout.overflow',
        severity: escapesFrame ? 'error' : 'warn',
        targetId: entry.targetId,
        sceneId: entry.sceneId,
        message: escapesFrame
          ? `${entry.component} "${b.textProp}" measures ${Math.round(m.width)}px wide at ${Math.round(size)}px — it escapes the ${width}×${height} frame`
          : `${entry.component} "${b.textProp}" measures ${Math.round(m.width)}px wide at ${Math.round(size)}px — outside the ${format} safe area (platform UI / title-safe band)`,
        fix,
      })
    }
  }
  return violations
}
