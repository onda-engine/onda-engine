//! Audio analysis for audio-reactive components (e.g. {@link AudioVisualizer}).
//!
//! Lazily loads `@onda/wasm-audio` — the SAME decode + FFT the native `onda
//! export` runs — decodes an audio file once, and exposes a per-frame spectrum.
//! Async + cached + shared across components; callers fall back to procedural
//! data until it's ready, so the composition never blocks. Browser only (the
//! export path warms the cache separately before the synchronous frame render).

import { useEffect, useState } from 'react'

/** Minimal shape of `@onda/wasm-audio`'s `AudioAnalyzer` — kept local so this
 *  file doesn't hard-depend on the generated wasm types at build time. */
export interface AudioAnalyzer {
  /** Per-frame spectrum: flat, frame-major (`frames * bands`), each `0..1`,
   *  low→high. Deterministic — identical to the native export. */
  spectrogram(fps: number, frames: number, bands: number): Float32Array
  /** Clip duration in seconds. */
  duration_secs(): number
  /** Decoded sample rate (Hz). */
  sample_rate(): number
}

interface WasmAudio {
  default: (opts?: unknown) => Promise<unknown>
  AudioAnalyzer: new (bytes: Uint8Array, extHint: string) => AudioAnalyzer
}

// Resolved analyzers by src (null = load failed → procedural fallback). Shared.
const analyzers = new Map<string, AudioAnalyzer | null>()
const inflight = new Map<string, Promise<void>>()
let modulePromise: Promise<WasmAudio> | null = null

/** Load + init the wasm module once. `init()` with no arg auto-locates the
 *  `.wasm` next to the JS module (handled by Vite/webpack/esbuild). */
function loadModule(): Promise<WasmAudio> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const mod = (await import('@onda/wasm-audio')) as unknown as WasmAudio
      await mod.default()
      return mod
    })()
  }
  return modulePromise
}

function extOf(src: string): string {
  const path = src.split(/[?#]/)[0] ?? src
  const dot = path.lastIndexOf('.')
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : ''
}

async function loadAnalyzer(src: string): Promise<void> {
  try {
    const mod = await loadModule()
    const res = await fetch(src)
    if (!res.ok) throw new Error(`audio fetch failed: ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    analyzers.set(src, new mod.AudioAnalyzer(bytes, extOf(src)))
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn(`[onda] couldn't load audio for the visualizer: ${src}\n  ${String(e)}`)
    }
    analyzers.set(src, null) // fall back to procedural
  } finally {
    inflight.delete(src)
  }
}

/** Load + decode `src` (cached + shared) and return its analyzer once ready, or
 *  `null` while loading / on failure (the caller uses a procedural fallback). The
 *  component re-renders when the analyzer becomes available. Browser only —
 *  returns `null` outside a browser (export preloads the cache separately). */
export function useAudioData(src: string | undefined): AudioAnalyzer | null {
  const [, bump] = useState(0)
  useEffect(() => {
    if (!src || typeof window === 'undefined' || analyzers.has(src)) return
    let cancelled = false
    let p = inflight.get(src)
    if (!p) {
      p = loadAnalyzer(src)
      inflight.set(src, p)
    }
    p.then(() => {
      if (!cancelled) bump((v) => v + 1)
    })
    return () => {
      cancelled = true
    }
  }, [src])
  return src ? (analyzers.get(src) ?? null) : null
}
