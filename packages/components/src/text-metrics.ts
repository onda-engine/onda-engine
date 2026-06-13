//! Real text measurement for components that must size to the *actual* text —
//! Highlight's accent bar, Underline, Button padding, InputField's caret, etc.
//!
//! Backed by `@onda/wasm`'s `OndaEngine.measureText` — the SAME cosmic-text
//! shaping the engine draws with — so a bar/underline hugs the text exactly
//! instead of the old glyph-count guess (`length * fontSize * 0.56`), which is
//! wrong for proportional fonts.
//!
//! Two paths, mirroring `useAudioData`:
//! - **Browser preview**: `useTextMetrics` lazily loads the wasm (async), falls
//!   back to the estimate until ready, and re-renders when it is.
//! - **Node export**: `preloadTextMetrics()` warms the engine before the
//!   synchronous `renderFramesJSON`, so `measureText` returns real metrics
//!   during the bake (`@onda/render` calls it; the CLI stays text-agnostic).
//!
//! `measureText` is always synchronous and never throws: real metrics when the
//! engine is warm, the estimate otherwise — so a composition never blocks.

import { registerEngineWarmer, registerFont } from '@onda/react'
import { useEffect, useState } from 'react'

export interface TextMetrics {
  /** Shaped advance width — the true rendered width of the string (px). */
  width: number
  /** Total laid-out height (px). */
  height: number
  /** Top of the line box to the baseline (px). */
  ascent: number
  /** Baseline to the bottom of the line box (px). */
  descent: number
  /** Baseline-to-baseline line height (px). */
  lineHeight: number
}

/** Resolve a CSS letter-spacing value to engine px. `'-0.02em'` → `-0.02 *
 *  fontSize`; `'2px'` → `2`; a bare number passes through. Undefined → 0. */
export function letterSpacingPx(
  value: string | number | undefined | null,
  fontSize: number,
): number {
  if (value == null) return 0
  if (typeof value === 'number') return value
  const v = value.trim()
  const n = Number.parseFloat(v)
  if (!Number.isFinite(n)) return 0
  return v.endsWith('em') ? n * fontSize : n
}

export interface MeasureOpts {
  fontFamily?: string
  fontWeight?: number
  italic?: boolean
  /** Extra px between glyphs (CSS letter-spacing) — included in the width so a
   *  component can center/size letter-spaced text faithfully. */
  letterSpacing?: number
}

/** Font-level vertical metrics returned by `fontMetrics()`. Derived by
 *  rasterizing 'H' and 'x' — pixel-accurate for the actual rendered font.
 *  Call once per (fontSize, family, weight) combo, not per frame. */
export interface FontMetrics {
  /** Distance from the Text node's `y` to the top of capital letters (px). */
  capTop: number
  /** Height of capital letters from their top to the baseline (px). */
  capHeight: number
  /** Distance from the Text node's `y` to the top of lowercase 'x' (px). */
  xTop: number
  /** x-height: height of lowercase letters from their top to the baseline (px). */
  xHeight: number
  /** Distance from node's `y` to the baseline (px). Same as `TextMetrics.ascent`. */
  ascent: number
  /** Baseline to bottom of the line box (px). */
  descent: number
  /** Baseline-to-baseline line height (px). */
  lineHeight: number
}

/** One kerning-aware character cluster from `glyphLayout()`. */
export interface GlyphInfo {
  /** Byte offset of this cluster's start in the original string. */
  start: number
  /** Byte offset of this cluster's end (exclusive). */
  end: number
  /** Pen x relative to the layout origin (includes letter-spacing). */
  x: number
  /** Advance width to the next cluster — includes kern pairs. */
  advance: number
}

/** Minimal shape of `@onda/wasm` we use — kept local so this file doesn't
 *  hard-depend on the generated wasm types at build time. */
interface OndaEngineLike {
  measureText(
    content: string,
    fontSize: number,
    family?: string,
    weight?: number,
    italic?: boolean,
    letterSpacing?: number,
  ): TextMetrics
  fontMetrics(fontSize: number, family?: string, weight?: number, italic?: boolean): FontMetrics
  glyphLayout(
    content: string,
    fontSize: number,
    family?: string,
    weight?: number,
    italic?: boolean,
    letterSpacing?: number,
  ): Float32Array
  /** Load `.ttf`/`.otf` bytes; returns the newline-joined family name(s). */
  loadFont(data: Uint8Array): string
}
interface WasmModule {
  default: (opts?: unknown) => Promise<unknown>
  initSync: (opts: { module: BufferSource }) => unknown
  OndaEngine: new () => OndaEngineLike
}

let engine: OndaEngineLike | null = null
let loadFailed = false
let loadPromise: Promise<void> | null = null

/** The old glyph-count estimate — the fallback while the engine warms (or if it
 *  fails to load). Intentionally matches the legacy `WIDTH_RATIO` so behavior is
 *  unchanged until real metrics arrive. */
const WIDTH_RATIO = 0.56
function estimate(content: string, fontSize: number, letterSpacing = 0): TextMetrics {
  const n = Math.max(0, content.length)
  return {
    width: n * fontSize * WIDTH_RATIO + letterSpacing * Math.max(0, n - 1),
    height: fontSize * 1.2,
    ascent: fontSize * 0.8,
    descent: fontSize * 0.2,
    lineHeight: fontSize * 1.2,
  }
}

/** Load + init `@onda/wasm` once and build the shared engine. Idempotent. In the
 *  browser the wasm auto-locates next to its JS; in Node we read the bytes and
 *  `initSync` (the auto-locate is browser-only). */
export function preloadTextMetrics(): Promise<void> {
  if (engine || loadFailed) return Promise.resolve()
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const mod = (await import('@onda/wasm')) as unknown as WasmModule
        if (typeof window === 'undefined') {
          // Node: explicit bytes. `node:` imports are @vite-ignored so the
          // browser bundle never tries to include them.
          const { readFileSync } = await import(/* @vite-ignore */ 'node:fs')
          // `ONDA_WASM_PATH` overrides where the `.wasm` is read from — required
          // when a bundler INLINES the JS glue (e.g. the vendored ONDA Studio
          // bundle), where `import.meta.resolve` can't locate the adjacent file.
          // Falls back to auto-locating next to the resolved `@onda/wasm` JS.
          const override = process.env.ONDA_WASM_PATH
          let wasmBytes: BufferSource
          if (override) {
            wasmBytes = readFileSync(override)
          } else {
            const { fileURLToPath } = await import(/* @vite-ignore */ 'node:url')
            const jsUrl = import.meta.resolve('@onda/wasm')
            const wasmUrl = new URL('./onda_wasm_bg.wasm', jsUrl)
            wasmBytes = readFileSync(fileURLToPath(wasmUrl))
          }
          mod.initSync({ module: wasmBytes })
        } else {
          await mod.default()
        }
        engine = new mod.OndaEngine()
      } catch (e) {
        loadFailed = true
        if (typeof console !== 'undefined') {
          console.warn(`[onda] text metrics unavailable — using estimates.\n  ${String(e)}`)
        }
      }
    })()
  }
  return loadPromise
}

/** Measure `content` at `fontSize` synchronously: real shaped metrics if the
 *  engine is warm (Node export, or browser after `useTextMetrics` loads it),
 *  else the glyph-count estimate. Never throws. */
export function measureText(
  content: string,
  fontSize: number,
  opts: MeasureOpts = {},
): TextMetrics {
  if (!engine || !content || fontSize <= 0) return estimate(content, fontSize, opts.letterSpacing)
  try {
    return engine.measureText(
      content,
      fontSize,
      opts.fontFamily,
      opts.fontWeight,
      opts.italic,
      opts.letterSpacing,
    )
  } catch {
    return estimate(content, fontSize, opts.letterSpacing)
  }
}

// ─── font-level vertical metrics ─────────────────────────────────────────────

function estimateFontMetrics(fontSize: number): FontMetrics {
  return {
    capTop: fontSize * 0.1,
    capHeight: fontSize * 0.7,
    xTop: fontSize * 0.3,
    xHeight: fontSize * 0.52,
    ascent: fontSize * 0.8,
    descent: fontSize * 0.2,
    lineHeight: fontSize * 1.2,
  }
}

/** Font-level vertical metrics for `fontSize` + optional family/weight — derived
 *  by rasterizing 'H' and 'x'. Call ONCE per (fontSize, family, weight) combo
 *  (not per frame). Use `capTop`/`capHeight` to center text without guessing:
 *  ```
 *  const m = fontMetrics(SIZE, { fontFamily: SANS })
 *  const y = height / 2 - m.capTop - m.capHeight / 2   // centers caps at height/2
 *  const cursorY = y + m.capTop                         // cursor aligned to cap top
 *  ```
 */
export function fontMetrics(fontSize: number, opts: MeasureOpts = {}): FontMetrics {
  if (!engine || fontSize <= 0) return estimateFontMetrics(fontSize)
  try {
    return engine.fontMetrics(fontSize, opts.fontFamily, opts.fontWeight, opts.italic)
  } catch {
    return estimateFontMetrics(fontSize)
  }
}

/** Like `fontMetrics` but loads the engine in the browser and re-renders when
 *  ready. Returns estimates until the engine is warm. */
export function useFontMetrics(fontSize: number, opts: MeasureOpts = {}): FontMetrics {
  const [, bump] = useState(0)
  useEffect(() => {
    if (engine || loadFailed || typeof window === 'undefined') return
    let cancelled = false
    preloadTextMetrics().then(() => {
      if (!cancelled) bump((v) => v + 1)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return fontMetrics(fontSize, opts)
}

// ─── kerning-aware glyph layout ───────────────────────────────────────────────

/** Kerning-aware glyph layout for `content`: returns one [`GlyphInfo`] per
 *  shaped cluster with the pen `x` and `advance` that already include kern
 *  pairs + letter-spacing. Unlike calling `measureText` per character, this is
 *  accurate for tightly-set display type where kerning is visible. */
function estimateGlyphLayout(content: string, fontSize: number, opts: MeasureOpts): GlyphInfo[] {
  let x = 0
  let byteOffset = 0
  return Array.from(content).map((ch) => {
    const advance = measureText(ch, fontSize, opts).width
    const start = byteOffset
    byteOffset += new TextEncoder().encode(ch).length
    const info: GlyphInfo = { start, end: byteOffset, x, advance }
    x += advance
    return info
  })
}

export function glyphLayout(
  content: string,
  fontSize: number,
  opts: MeasureOpts = {},
): GlyphInfo[] {
  if (!engine || !content || fontSize <= 0) return estimateGlyphLayout(content, fontSize, opts)
  try {
    const raw = engine.glyphLayout(
      content,
      fontSize,
      opts.fontFamily,
      opts.fontWeight,
      opts.italic,
      opts.letterSpacing,
    )
    const out: GlyphInfo[] = []
    for (let i = 0; i < raw.length; i += 4) {
      // biome-ignore lint/style/noNonNullAssertion: stride-4 walk — i..i+3 in bounds by the loop condition
      out.push({ start: raw[i]!, end: raw[i + 1]!, x: raw[i + 2]!, advance: raw[i + 3]! })
    }
    return out
  } catch {
    return estimateGlyphLayout(content, fontSize, opts)
  }
}

/** Like `glyphLayout` but loads the engine in the browser and re-renders when
 *  ready. Returns the no-kerning fallback until the engine is warm. */
export function useGlyphLayout(
  content: string,
  fontSize: number,
  opts: MeasureOpts = {},
): GlyphInfo[] {
  const [, bump] = useState(0)
  useEffect(() => {
    if (engine || loadFailed || typeof window === 'undefined') return
    let cancelled = false
    preloadTextMetrics().then(() => {
      if (!cancelled) bump((v) => v + 1)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return glyphLayout(content, fontSize, opts)
}

/** Measure `content`, loading the engine in the browser on first use and
 *  re-rendering when it's ready. Returns the estimate until then. In Node it
 *  returns whatever `measureText` has (real metrics when `preloadTextMetrics`
 *  ran before the render; the estimate otherwise). */
export function useTextMetrics(
  content: string,
  fontSize: number,
  opts: MeasureOpts = {},
): TextMetrics {
  const [, bump] = useState(0)
  useEffect(() => {
    if (engine || loadFailed || typeof window === 'undefined') return
    let cancelled = false
    preloadTextMetrics().then(() => {
      if (!cancelled) bump((v) => v + 1)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return measureText(content, fontSize, opts)
}

/** Loader-only companion to {@link measureText} for components that measure a
 *  VARIABLE number of strings (a `.map`/loop), where the {@link useTextMetrics}
 *  hook can't be called per item without breaking the rules of hooks. Call this
 *  ONCE at the top of the component, then `measureText(...)` synchronously in the
 *  loop. It loads the engine in the browser and re-renders when ready; returns
 *  `true` once measurements are real. In Node it reflects whether the engine is
 *  warm (the export path warms it via `preloadTextMetrics`). */
export function useTextMetricsReady(): boolean {
  const [, bump] = useState(0)
  useEffect(() => {
    if (engine || loadFailed || typeof window === 'undefined') return
    let cancelled = false
    preloadTextMetrics().then(() => {
      if (!cancelled) bump((v) => v + 1)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return engine !== null
}

// ─── custom font loading (author-time ↔ render parity) ───────────────────────

/** Load a custom font (`.ttf`/`.otf` bytes) into the author-time measurement
 *  engine so `measureText`/`glyphLayout`/`fontMetrics` — and therefore
 *  `<TextAnimator>` / `KineticText` glyph placement — are kerning-accurate for
 *  that family instead of silently falling back to the bundled default. Select
 *  the font by a returned family name on `<Text fontFamily=…>` or `TextAnimator`'s
 *  `fontFamily`. Resolves to the family name(s) the font provides.
 *
 *  Parity: the RENDERER must be given the SAME bytes (CLI `--font <path>`, or the
 *  wasm preview's own `loadFont`). Identical bytes + identical cosmic-text shaping
 *  ⇒ the positions measured here match the glyphs the engine draws. Loading the
 *  same family twice is harmless. Awaits engine init; never throws (logs + returns
 *  `[]` if the engine is unavailable or the bytes don't parse). */
export async function loadFont(data: Uint8Array): Promise<string[]> {
  // Single source: retain the bytes so `@onda/render` hands the SAME font to the
  // renderer (`--font`) — no separate flag. Synchronous + before the async engine
  // load, so the registration lands the instant `loadFont` is called.
  registerFont(data)
  await preloadTextMetrics()
  if (!engine) return []
  try {
    const families = engine.loadFont(data)
    return families ? families.split('\n').filter(Boolean) : []
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn(
        `[onda] loadFont failed — text will measure against the bundled font.\n  ${String(e)}`,
      )
    }
    return []
  }
}

// Register with @onda/react so `@onda/render` warms the engine before a (sync)
// export render — components bake real metrics into exported frames, not the
// estimate. Importing @onda/components is enough; no caller setup.
registerEngineWarmer(preloadTextMetrics)
