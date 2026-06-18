//! Layout queries + single-line auto-fit — keep type ON the frame.
//!
//! The engine knows every glyph's advance (`measureText`, cosmic-text via wasm),
//! but nothing used to CONNECT that knowledge to the frame: "WEEKS OF WORK" at
//! 140px happily overflowed 1920px. Two tools close the loop:
//!
//! - {@link useResolvedBounds} — the layout QUERY: the measured box of a line in
//!   px AND as a fraction of the frame, plus an `overflows` verdict against the
//!   safe band. Authors (and the Studio agent) can ask "how big is this, really?"
//! - {@link fitFontSize} / {@link useFittedFontSize} — the auto-FIT: scale a
//!   font size DOWN (never up) so the measured line cannot exceed a width cap.
//!   Components expose it as `fit="frame"` (cap = frame minus the safe margins)
//!   and/or `maxWidth` (explicit px cap). Letter-spacing is scaled with the font
//!   size, so tracked display type fits faithfully.
//!
//! Fallback honesty: before the wasm engine warms (browser first paint), widths
//! come from the glyph-count estimate — the fit then re-resolves when real
//! metrics arrive (the same contract as `useTextMetrics`).

import { useVideoConfig } from '@onda-engine/react'
import { SAFE_MARGIN } from './placement.js'
import { type MeasureOpts, measureText, useTextMetricsReady } from './text-metrics.js'

/** The resolved box of a measured line, px and frame-relative. */
export interface ResolvedBounds {
  /** Shaped line width (px). */
  width: number
  /** Line-box height (px). */
  height: number
  /** Width as a fraction of the frame width. */
  widthFrac: number
  /** Height as a fraction of the frame height. */
  heightFrac: number
  /** True when the line is wider than the frame's safe band
   *  (`frameWidth × (1 − 2×margin)`). */
  overflows: boolean
}

/** Measure `content` against the live frame: px box + %-of-frame + an overflow
 *  verdict against the safe band (`margin` per side, default the shared
 *  {@link SAFE_MARGIN} = 10%). Loads the metrics engine in the browser and
 *  re-renders when real metrics arrive. */
export function useResolvedBounds(
  content: string,
  fontSize: number,
  opts: MeasureOpts & { margin?: number } = {},
): ResolvedBounds {
  useTextMetricsReady()
  const { width: frameW, height: frameH } = useVideoConfig()
  const { margin = SAFE_MARGIN, ...measure } = opts
  const m = measureText(content, fontSize, measure)
  return {
    width: m.width,
    height: m.height,
    widthFrac: frameW > 0 ? m.width / frameW : 0,
    heightFrac: frameH > 0 ? m.height / frameH : 0,
    overflows: m.width > frameW * (1 - 2 * margin),
  }
}

/** The largest font size ≤ `fontSize` at which `content` measures ≤ `maxWidth`
 *  px. Pure + synchronous (uses whatever metrics `measureText` has). The
 *  caller's `letterSpacing` (given at the ORIGINAL `fontSize`) is scaled
 *  proportionally, so tracked type fits exactly. Never scales UP. */
export function fitFontSize(
  content: string,
  fontSize: number,
  maxWidth: number,
  opts: MeasureOpts = {},
): number {
  if (!content || fontSize <= 0 || !Number.isFinite(maxWidth) || maxWidth <= 0) return fontSize
  let size = fontSize
  // Advances are ~linear in font size, so one ratio step lands ~exactly; the
  // loop absorbs shaping non-linearities (hinting/rounding) in a few nudges.
  for (let i = 0; i < 4; i++) {
    const letterSpacing =
      opts.letterSpacing !== undefined ? opts.letterSpacing * (size / fontSize) : undefined
    const w = measureText(content, size, { ...opts, letterSpacing }).width
    if (w <= maxWidth || size <= 1) return size
    size = Math.max(1, size * (maxWidth / w) * 0.999)
  }
  return size
}

/** Auto-fit options shared by the text-bearing components. */
export interface FitOpts {
  /** `'frame'` caps the line to the frame width minus the safe margins
   *  (10% per side). Opt-in; default `'none'` (the historical behavior). */
  fit?: 'none' | 'frame'
  /** Explicit width cap in px. Combines with `fit` (the smaller cap wins). */
  maxWidth?: number
  /** Safe-margin fraction per side for `fit: 'frame'` (default 0.1). */
  fitMargin?: number
}

/** Resolve the effective width cap in px for {@link FitOpts} against a frame
 *  width — `undefined` when no fit is requested. */
export function fitMaxWidth(opts: FitOpts, frameWidth: number): number | undefined {
  const caps: number[] = []
  if (opts.maxWidth !== undefined && opts.maxWidth > 0) caps.push(opts.maxWidth)
  if (opts.fit === 'frame') caps.push(frameWidth * (1 - 2 * (opts.fitMargin ?? SAFE_MARGIN)))
  return caps.length > 0 ? Math.min(...caps) : undefined
}

/** Hook form of {@link fitFontSize} driven by {@link FitOpts}: returns the
 *  (possibly reduced) font size for `content` against the live frame. Returns
 *  `fontSize` untouched when no fit is requested. Loads the metrics engine in
 *  the browser and re-renders when real metrics arrive. */
export function useFittedFontSize(
  content: string,
  fontSize: number,
  opts: MeasureOpts & FitOpts = {},
): number {
  useTextMetricsReady()
  const { width: frameW } = useVideoConfig()
  const { fit, maxWidth, fitMargin, ...measure } = opts
  const cap = fitMaxWidth({ fit, maxWidth, fitMargin }, frameW)
  if (cap === undefined) return fontSize
  return fitFontSize(content, fontSize, cap, measure)
}
