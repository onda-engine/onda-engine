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

import { registerEngineWarmer } from '@onda/react'
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
          const { fileURLToPath } = await import(/* @vite-ignore */ 'node:url')
          const jsUrl = import.meta.resolve('@onda/wasm')
          const wasmUrl = new URL('./onda_wasm_bg.wasm', jsUrl)
          mod.initSync({ module: readFileSync(fileURLToPath(wasmUrl)) })
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

// Register with @onda/react so `@onda/render` warms the engine before a (sync)
// export render — components bake real metrics into exported frames, not the
// estimate. Importing @onda/components is enough; no caller setup.
registerEngineWarmer(preloadTextMetrics)
