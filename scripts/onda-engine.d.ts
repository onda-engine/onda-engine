// Type declarations for the vendored ONDA engine bundle (onda-engine.js).
//
// SOURCE OF TRUTH: this file is checked in at onda-engine/scripts/onda-engine.d.ts
// and copied next to the bundle by scripts/build-studio-bundle.sh. It declares
// every export of .vendor-entry.mjs — if the entry gains an export, add it HERE
// (the bundle's consumers type-check against this file, not the package dists).
//
// The bundle inlines React 18 + the @onda/* packages (bun build --target node
// --format esm), so it is self-contained and isolated from the consumer's own
// React. Composition elements are deliberately opaque (`CompositionElement`):
// they're created by `buildComposition` and consumed by `renderToFile` /
// `renderStillToFile` — never inspected by the caller — which keeps this file
// free of a `@types/react` dependency.
//
// The `onda` binary, the `synth_json`/`beats_json` audio tools, and
// `onda_wasm_bg.wasm` (text metrics) ship next to this file; `$ONDA_BIN`
// overrides the binary path. See manifest.json for the bundle's version/SHA.

/** An @onda/react `<Composition>` element built by {@link buildComposition}.
 *  Opaque on purpose — pass it to renderToFile / renderStillToFile. */
export type CompositionElement = unknown

// ── @onda/cinema ────────────────────────────────────────────────────────────

export interface BuildOptions {
  /** Component lookup. Default: every `@onda/components` component. */
  registry?: Record<string, unknown>
}

export interface Diagnostic {
  /** `error` = won't render correctly (fix it); `warning` = renders, but off or
   *  fragile; `info` = an FYI an agent should weigh (e.g. a degraded component). */
  level: 'error' | 'warning' | 'info'
  path: string
  message: string
}

/** Build an `@onda/react` `<Composition>` from a timeline payload. Pass the
 *  result to `renderToFile` (export) or `renderStillToFile` (still). */
export function buildComposition(payload: unknown, opts?: BuildOptions): CompositionElement

/** Check a payload before rendering — the tight feedback loop an agent
 *  self-corrects against. Flags structural issues, unknown components (with a
 *  did-you-mean), unknown patterns/transitions, malformed timing, and degraded/
 *  GPU-only components. Returns `[]` when the composition is clean. */
export function validateComposition(payload: unknown, opts?: BuildOptions): Diagnostic[]

// ── @onda/render ────────────────────────────────────────────────────────────

export type Backend = 'auto' | 'vello' | 'cpu'
export type Encoder = 'auto' | 'videotoolbox' | 'nvenc' | 'qsv' | 'libx264'

export interface RenderProgress {
  renderedFrames: number
  totalFrames: number
}

export interface RenderToFileOptions {
  /** Output path — `.mp4` (or `.gif`). */
  output: string
  /** Rendering backend. Default `'auto'` (Vello/GPU if available, else CPU). */
  backend?: Backend
  /** H.264 encoder for mp4. Default `'auto'` (probes hardware, else libx264). */
  encoder?: Encoder
  /** Called once per rendered frame. */
  onProgress?: (progress: RenderProgress) => void
  /** Path to the `onda` binary. Default: `$ONDA_BIN`, else `onda` on PATH. */
  ondaBin?: string
}

export interface RenderStillOptions {
  /** Output path — `.png`. */
  output: string
  /** Which frame to render. Default `0`. */
  frame?: number
  backend?: Backend
  ondaBin?: string
}

/** Render a composition to a video file. Generates every frame's scene graph
 *  in-process, then hands it to the `onda` CLI to rasterize + encode. */
export function renderToFile(
  composition: CompositionElement,
  options: RenderToFileOptions,
): Promise<void>

/** Render a single frame to a PNG (e.g. a poster frame or a vision check). */
export function renderStillToFile(
  composition: CompositionElement,
  options: RenderStillOptions,
): Promise<void>

// ── @onda/react ─────────────────────────────────────────────────────────────

/** Register raw `.ttf`/`.otf` bytes with the RENDERER (serialized into the
 *  scene graph for the engine to draw with). Does NOT feed the author-time
 *  measurement engine — pair with {@link loadFont} when components measure
 *  text in that family. */
export function registerFont(data: Uint8Array): void

// ── @onda/components ────────────────────────────────────────────────────────

/** Load a custom font (`.ttf`/`.otf` bytes) into the author-time measurement
 *  engine so `measureText`-driven layout (centering, glyph placement) is
 *  kerning-accurate for that family — AND register the bytes for the renderer.
 *  Resolves to the family name(s) the font provides; select one via the
 *  component's `fontFamily`. Idempotent per family; never throws (logs and
 *  resolves `[]` if the engine is unavailable or the bytes don't parse). */
export function loadFont(data: Uint8Array): Promise<string[]>

/** Load + init the text-metrics wasm engine once (reads `onda_wasm_bg.wasm`).
 *  Call before building/rendering so text measurement uses real shaped metrics
 *  instead of the glyph-count estimate. Idempotent. */
export function preloadTextMetrics(): Promise<void>
