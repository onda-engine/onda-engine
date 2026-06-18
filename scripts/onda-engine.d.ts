// Type declarations for the vendored ONDA engine bundle (onda-engine.js).
//
// SOURCE OF TRUTH: this file is checked in at onda-engine/scripts/onda-engine.d.ts
// and copied next to the bundle by scripts/build-studio-bundle.sh. It declares
// every export of .vendor-entry.mjs — if the entry gains an export, add it HERE
// (the bundle's consumers type-check against this file, not the package dists).
//
// The bundle inlines React 18 + the @onda-engine/* packages (bun build --target node
// --format esm), so it is self-contained and isolated from the consumer's own
// React. Composition elements are deliberately opaque (`CompositionElement`):
// they're created by `buildComposition` and consumed by `renderToFile` /
// `renderStillToFile` — never inspected by the caller — which keeps this file
// free of a `@types/react` dependency.
//
// The `onda` binary, the `synth_json`/`beats_json` audio tools, and
// `onda_wasm_bg.wasm` (text metrics) ship next to this file; `$ONDA_BIN`
// overrides the binary path. See manifest.json for the bundle's version/SHA.

/** An @onda-engine/react `<Composition>` element built by {@link buildComposition}.
 *  Opaque on purpose — pass it to renderToFile / renderStillToFile. */
export type CompositionElement = unknown

// ── @onda-engine/cinema ────────────────────────────────────────────────────────────

export interface BuildOptions {
  /** Component lookup. Default: every `@onda-engine/components` component. */
  registry?: Record<string, unknown>
}

export interface Diagnostic {
  /** `error` = won't render correctly (fix it); `warning` = renders, but off or
   *  fragile; `info` = an FYI an agent should weigh (e.g. a degraded component). */
  level: 'error' | 'warning' | 'info'
  path: string
  message: string
}

/** Build an `@onda-engine/react` `<Composition>` from a timeline payload. Pass the
 *  result to `renderToFile` (export) or `renderStillToFile` (still). */
export function buildComposition(payload: unknown, opts?: BuildOptions): CompositionElement

/** Check a payload before rendering — the tight feedback loop an agent
 *  self-corrects against. Flags structural issues, unknown components (with a
 *  did-you-mean), unknown patterns/transitions, malformed timing, and degraded/
 *  GPU-only components. Returns `[]` when the composition is clean. */
export function validateComposition(payload: unknown, opts?: BuildOptions): Diagnostic[]

export interface InspectOptions {
  /** Override the inferred output format (`'16:9' | '9:16' | '1:1' | '4:5'`). */
  format?: '16:9' | '9:16' | '1:1' | '4:5'
  /** Frame indices intended as stills/thumbnails — flagged when they land
   *  mid-transition. */
  frames?: number[]
}

export interface InspectViolation {
  check: string
  severity: 'error' | 'warn' | 'info'
  targetId: string
  sceneId?: string
  message: string
  /** Mechanical fix metadata (e.g. the minimum passing value) when computable. */
  fix?: { prop: string; suggested: unknown }
}

export interface InspectReport {
  violations: InspectViolation[]
  /** Counts keyed by severity — matches `Violation['severity']` exactly. */
  summary: { error: number; warn: number; info: number }
  format: string
  fps: number
  totalFrames: number
  density: unknown[]
}

/** The quality-metrics INSPECTOR: deterministic measurements over a resolved
 *  composition — text legibility (font floors + WCAG contrast), layout overflow
 *  vs per-platform safe areas, reading time, focal-entrance collisions +
 *  transition budget, per-scene density, and mid-transition still capture.
 *  Run `validateComposition` first; `inspect` assumes structural validity.
 *  Never blocks — enforcement policy belongs to the caller. */
export function inspect(payload: unknown, opts?: InspectOptions): InspectReport

// ── @onda-engine/render ────────────────────────────────────────────────────────────

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

// ── @onda-engine/react ─────────────────────────────────────────────────────────────

/** Register raw `.ttf`/`.otf` bytes with the RENDERER (serialized into the
 *  scene graph for the engine to draw with). Does NOT feed the author-time
 *  measurement engine — pair with {@link loadFont} when components measure
 *  text in that family. */
export function registerFont(data: Uint8Array): void

/** Evaluate frames `[startFrame, endFrame)` of a composition to a JSON array of
 *  scene graphs — the `frames.json` the `onda` CLI's vision verbs consume
 *  (`onda lint` geometry measurement, `onda contact-sheet` annotated tiles,
 *  `onda render-frame --crop` zoom, `onda export-frames` short clips). The
 *  agent's motion-perception bridge: a scene's transition window becomes
 *  numbers + an annotated strip without rendering the whole video. */
export function renderFrameRangeJSON(
  composition: CompositionElement,
  startFrame: number,
  endFrame: number,
  space?: number,
): string

// ── @onda-engine/components ────────────────────────────────────────────────────────

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

/** A `placement` value — a region keyword (e.g. 'center', 'top-left',
 *  'lower-third') or a normalized 0..1 canvas point anchored at the element center. */
export type Placement = string | { x?: number; y?: number }

/** Shaped text metrics (real metrics when the wasm engine is loaded, else an
 *  estimate). Width/height in px; extra per-engine fields may be present. */
export function measureText(
  content: string,
  fontSize: number,
  opts?: { fontFamily?: string; fontWeight?: number; italic?: boolean; letterSpacing?: number },
): { width: number; height: number } & Record<string, unknown>

/** Narrowing helper: is this value a placement region/point at all? */
export function isPlacement(value: unknown): value is Placement

/** Resolve a `placement` to canvas px (pure). Edge/corner regions sit flush on
 *  the safe margin when `element` size is known; `{x,y}` points are center-anchored. */
export function resolvePlacement(
  placement: Placement | undefined,
  frame: { width: number; height: number },
  element?: { width?: number; height?: number },
): { x: number; y: number; originX: number; originY: number; dx: number; dy: number }

/** One prop on a component, schema-derived (name, kind, role, constraints). */
export interface PropMeta {
  name: string
  type: string
  role: string
  required: boolean
  themeable: boolean
  description: string
  enumValues?: string[]
  default?: string
  min?: number
  max?: number
  unit?: string
}

/** One component-catalog entry: identity + curation + capability + prop schema.
 *  (A subset of the full shape; extra fields may be present.) */
export interface ManifestEntry {
  slug: string
  name: string
  category: string
  title: string
  description: string
  sceneRole: string
  occlusion: string
  props?: PropMeta[]
  [key: string]: unknown
}

/** A capability the engine advertises (camera moves, finishes/LUTs, effects,
 *  audio, …) — for the agent's planning. (A subset; extra fields may be present.) */
export interface Capability {
  id: string
  [key: string]: unknown
}

/** The capability catalog — what the engine can do, beyond the component list.
 *  Imported from `@onda-engine/components/manifest`. */
export const CAPABILITIES: Capability[]

/** The component manifest — the agent's vocabulary (names + prop schemas +
 *  fidelity/occlusion classes). Imported from `@onda-engine/components/manifest`. */
export const MANIFEST: ManifestEntry[]
