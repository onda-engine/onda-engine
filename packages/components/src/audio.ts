//! Audio analysis for audio-reactive components (e.g. {@link AudioVisualizer}).
//!
//! Lazily loads `@onda/wasm-audio` — the SAME decode + FFT the native `onda
//! export` runs — decodes an audio file once, and exposes a per-frame spectrum.
//! Async + cached + shared across components; callers fall back to procedural
//! data until it's ready, so the composition never blocks. Browser only (the
//! export path warms the cache separately before the synchronous frame render).

import { useVideoConfig } from '@onda/react'
import { useEffect, useState } from 'react'

/** `@onda/wasm-audio`'s `Beats` handle — beat/onset/tempo analysis in frame units. */
export interface BeatsHandle {
  readonly tempo: number
  readonly beats: Uint32Array
  readonly onsets: Uint32Array
  readonly onsetEnv: Float32Array
}

/** Beat / onset / tempo analysis of a clip, in VIDEO-FRAME units — for syncing motion
 *  to the music. Returned by {@link useAudioBeats}; pair with {@link beatPulse}. */
export interface Beats {
  /** Estimated tempo, beats per minute (0 if undetectable). */
  tempo: number
  /** Frame indices on the beat grid (ascending). */
  beats: number[]
  /** Frame indices of picked onsets — any transient (drum hit, note, accent). */
  onsets: number[]
  /** Per-frame onset strength `0..1` (one value per frame) — a continuous envelope. */
  onsetEnv: Float32Array
}

/** Minimal shape of `@onda/wasm-audio`'s `AudioAnalyzer` — kept local so this
 *  file doesn't hard-depend on the generated wasm types at build time. */
export interface AudioAnalyzer {
  /** Per-frame spectrum: flat, frame-major (`frames * bands`), each `0..1`,
   *  low→high. Deterministic — identical to the native export. */
  spectrogram(fps: number, frames: number, bands: number): Float32Array
  /** Beat / onset / tempo analysis over `frames` frames at `fps`. Deterministic. */
  beats(fps: number, frames: number): BeatsHandle
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

// Beat analysis is a whole-clip computation — memoize per (src, fps, frames).
const beatCache = new Map<string, Beats>()

/** Analyze `src` for BEATS / onsets / tempo (frame units, from the composition's fps +
 *  duration) so you can sync motion to the music. Returns `null` while the audio loads
 *  or on failure (browser only — the export path preloads). Pair with {@link beatPulse}:
 *  `scaleX={1 + 0.3 * beatPulse(frame, b.beats)}` punches an element on every beat.
 *
 *  For deterministic export an agent can instead bake the `beats` array into the
 *  composition as a constant and use the pure helpers directly. */
export function useAudioBeats(src: string | undefined): Beats | null {
  const analyzer = useAudioData(src)
  const { fps, durationInFrames } = useVideoConfig()
  if (!src || !analyzer) return null
  const key = `${src}@${fps}/${durationInFrames}`
  let cached = beatCache.get(key)
  if (!cached) {
    const raw = analyzer.beats(fps, durationInFrames)
    cached = {
      tempo: raw.tempo,
      beats: Array.from(raw.beats),
      onsets: Array.from(raw.onsets),
      onsetEnv: raw.onsetEnv,
    }
    beatCache.set(key, cached)
  }
  return cached
}

/** Frames since the most recent beat at or before `frame` (`Infinity` before the first).
 *  `beats` must be ascending (as {@link useAudioBeats} returns it). */
export function framesSinceBeat(frame: number, beats: readonly number[]): number {
  let last = Number.NEGATIVE_INFINITY
  for (const b of beats) {
    if (b <= frame) last = b
    else break
  }
  return frame - last
}

/** A `1 → 0` PUNCH that fires on each beat and decays over `decay` frames — the core
 *  audio-sync primitive. Drive a scale / opacity / glow with it so the element hits on
 *  the beat: `scaleX={1 + amount * beatPulse(frame, beats)}`. */
export function beatPulse(frame: number, beats: readonly number[], decay = 6): number {
  const since = framesSinceBeat(frame, beats)
  if (!Number.isFinite(since) || since < 0) return 0
  return Math.max(0, 1 - since / Math.max(1, decay))
}

/** True when `frame` is on a beat (within `tolerance` frames) — for hard cuts/swaps. */
export function isBeat(frame: number, beats: readonly number[], tolerance = 0): boolean {
  return beats.some((b) => Math.abs(b - frame) <= tolerance)
}
