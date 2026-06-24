//! The timeline composition payload — the document an agent (ONDA Studio) emits
//! and `buildComposition` turns into an @onda-engine/react scene. Structural mirror of
//! Studio's `composition.ts` schema (kept as plain types; validation is
//! `validateComposition`).

/** A time: seconds (number) or a spec string — `"2s"`, `"500ms"`, `"0:02"`, `"90f"`. */
export type TimeSpec = string | number

/** An entry's motion: an `@onda-engine/components` choreography pattern name + params. */
export interface EntryAnimation {
  pattern: string
  params?: Record<string, unknown>
}

/** Per-entry cinematic EFFECTS — the same sugar props @onda-engine/react's `<Group>`
 *  accepts (each maps 1:1 to the engine `Effect` enum). The renderer spreads
 *  these onto a wrapping `<Group>` so they render on Vello in EXPORT (twin of the
 *  Studio preview renderer's `entryEffectsSchema`). */
export interface EntryEffects {
  blur?: number
  directionalBlur?: { sigma: number; angle?: number }
  bloom?: number | { sigma: number; threshold?: number; intensity?: number }
  grade?: {
    exposure?: number
    contrast?: number
    saturation?: number
    temperature?: number
    tint?: number
  }
  grain?: number | { intensity: number; size?: number; seed?: number }
  vignette?: number | { amount: number; softness?: number }
  chromaticAberration?: number
  posterize?: number
  duotone?: { shadow: string; highlight: string }
  chromaKey?: { color: string; threshold?: number; smoothness?: number }
  goo?: number | { sigma: number; threshold?: number }
  backdropBlur?: number | { sigma: number; tint?: string; brightness?: number; saturation?: number }
  lightWrap?: number | { sigma: number; strength?: number }
  blendMode?: string
  shadow?: { color: string; blur: number; offsetX?: number; offsetY?: number; spread?: number }
}

/** AE-style 3D placement for an entry (rendered inside a `<Scene3D>`). */
export interface Transform3D {
  position3d?: [number, number, number]
  rotation3d?: [number, number, number]
  anchor3d?: [number, number]
  extrude?: number | { depth: number }
}

/** Track matte: reveal an entry through a stencil component subtree. */
export interface EntryMatte {
  component: string
  props?: Record<string, unknown>
  mode?: 'alpha' | 'luminance'
}

/** Clip an entry to a region. */
export interface EntryClip {
  shape: 'rect' | 'ellipse' | 'path'
  width?: number
  height?: number
  cornerRadius?: number
  data?: string
}

/** An entry's attention weight — the contract the inspector's hierarchy,
 *  collision, and density checks run on. Consumers (the Studio director)
 *  ASSIGN roles; nothing infers them. */
export type EntryRole = 'focal' | 'support' | 'ambient'

/** Per-entry Magic-Resize behaviour for `fit:"responsive"` scenes — refines how THIS
 *  element re-frames onto an off-design output canvas (hide on an aspect, stay inside
 *  the safe area, clamp the fit scale). Structural mirror of `@onda-engine/components`'
 *  `ResponsiveBehavior` (the math source of truth) and Studio's Zod `responsiveSchema`. */
export interface ResponsiveBehavior {
  hideOn?: ('portrait' | 'landscape' | 'square')[]
  safeArea?: boolean | number
  minScale?: number
  maxScale?: number
  /** REFLOW: per-output-aspect placement override `{x,y,scale}` (normalized output coords). */
  byAspect?: Partial<
    Record<'portrait' | 'landscape' | 'square', { x?: number; y?: number; scale?: number }>
  >
}

/** One element on a track: a component placed at `at` for `for`, with optional motion. */
export interface Entry {
  at: TimeSpec
  for: TimeSpec
  component: string
  /** Attention weight: `'focal'` = the one thing the viewer should be reading /
   *  watching right now (≤1 visible at a time; entrances must not collide),
   *  `'support'` = secondary content, `'ambient'` = atmosphere (backgrounds,
   *  grain, washes — exempt from density budgets). Drives the inspector's
   *  hierarchy / collision / density checks. Absent = `'support'`. */
  role?: EntryRole
  props?: Record<string, unknown>
  animate?: EntryAnimation[]
  /** Per-entry cinematic effects (bloom/grade/grain/blur/vignette/…). */
  effects?: EntryEffects
  /** 2.5D depth for composition `dof` rack-focus. */
  depth?: number
  /** AE-style 3D placement (position3d / rotation3d / extrude). */
  transform3d?: Transform3D
  /** Track matte: reveal through a stencil component (media-through-type). */
  matte?: EntryMatte
  /** Clip to a rect/ellipse/path region. */
  clip?: EntryClip
  /** Magic-Resize behaviour on `fit:"responsive"` scenes (hide-on-aspect / safe-area /
   *  scale clamp). Only affects positioned entries when output ≠ design canvas. */
  responsive?: ResponsiveBehavior
  /** Magic-move continuity key. When the SAME `morphKey` appears on an entry in
   *  two ADJACENT scenes, the element MORPHS its position/scale across the cut
   *  (one continuous move) instead of cross-fading — Keynote Magic Move / a
   *  matched cut. The morphing instance is built from the destination scene's
   *  entry (same component + props). */
  morphKey?: string
  id?: string
  label?: string
}

export interface Track {
  id?: string
  label?: string
  entries: Entry[]
}

export interface SceneTransition {
  /** A transition slug, e.g. `"cross-fade"`, `"iris"`, `"push"`. */
  type: string
  durationInFrames?: number
  /** Per-transition options forwarded to the presentation factory (direction /
   *  color / scaleAmount / bars) — each transition reads what it knows. */
  options?: { direction?: string; color?: string; scaleAmount?: number; bars?: number }
}

/** A camera keyframe: zoom (1 = neutral), focus x/y (canvas fractions, 0.5 =
 *  center), rotate (deg). Omitted keys default. */
export interface CameraKeyframe {
  zoom?: number
  x?: number
  y?: number
  rotate?: number
}

/** A camera move eased over a scene's duration (push-in / pan / roll). */
export interface CameraMove {
  from?: CameraKeyframe
  to?: CameraKeyframe
}

export interface Scene {
  id: string
  label?: string
  for?: TimeSpec
  transition?: SceneTransition
  tracks: Track[]
  /** A cinematic camera move over this scene. */
  camera?: CameraMove
  /** The canvas this scene's content was AUTHORED for. When it differs from the
   *  composition canvas, the renderer uniformly scales + centers the scene's
   *  content to `fit` the output (e.g. a 4:3 template scene into a 16:9 video). */
  designWidth?: number
  designHeight?: number
  /** How to re-frame the design canvas into the output:
   *  - `contain` — uniformly scale + center, letterbox.
   *  - `cover` — uniformly scale + center, fill + crop.
   *  - `responsive` — "Magic Resize": re-anchor each element individually (pin to
   *    edge / center per axis, size scaled uniformly) so one master adapts to any
   *    aspect ratio without per-format variants. */
  fit?: 'contain' | 'cover' | 'responsive'
  /** `responsive`-only: how much to scale content UP to fill the output (0 = FIT, never
   *  crops; 1 = COVER, fills + crops edges). Default: a moderate fill on an orientation
   *  FLIP (so a landscape→portrait reframe isn't tiny), 0 otherwise. */
  fill?: number
}

/** A composition-level layer entry — absolute-timed, spans scene cuts. */
export interface LayerEntry {
  at?: TimeSpec
  for?: TimeSpec
  component: string
  props?: Record<string, unknown>
  animate?: EntryAnimation[]
  /** Per-entry cinematic effects (bloom/grade/grain/blur/vignette/…). */
  effects?: EntryEffects
  /** 2.5D depth for composition `dof` rack-focus. */
  depth?: number
  /** AE-style 3D placement (position3d / rotation3d / extrude). */
  transform3d?: Transform3D
  /** Track matte: reveal through a stencil component (media-through-type). */
  matte?: EntryMatte
  /** Clip to a rect/ellipse/path region. */
  clip?: EntryClip
  id?: string
  label?: string
}

export interface Layer {
  id?: string
  label?: string
  /** `true` = behind the scene spine (a background); else over it (an overlay). */
  under?: boolean
  entries: LayerEntry[]
}

/** Optional brand override — surface tokens, mapped to the engine theme. */
export interface Brand {
  bg?: string
  surface?: string
  surface2?: string
  border?: string
  borderLit?: string
  text?: string
  dim?: string
  faint?: string
  accent?: string
  accentSoft?: string
  fontDisplay?: string
  fontBody?: string
}

/** Composition-level cinematic FINISH — the linear-HDR + ACES "looks-shot"
 *  output transform (GPU/export-only). Twin of the Studio `compositionFinishSchema`. */
export interface CompositionFinish {
  exposure?: number
  bloom?: { sigma: number; threshold?: number; intensity?: number }
  halation?: number
  temperature?: number
  contrast?: number
  saturation?: number
  vignette?: number
  grain?: number
  /** A cinematic 3D color LUT applied as the FINAL finish step (after grade + ACES
   *  + sRGB), as a trilinear lookup. `table` holds `size³` RGB triples in 0..1 with
   *  RED varying fastest, then green, then blue. Honored by BOTH backends. */
  lut?: { size: number; table: number[] }
}

export interface CompositionPayload {
  fps: number
  width: number
  height: number
  scenes: Scene[]
  layers?: Layer[]
  brand?: Brand
  /** Opt into the cinematic LINEAR + ACES color pipeline (GPU/export only). */
  linear?: boolean
  /** Composition-level cinematic finish (ACES tone-map look; GPU/export only). */
  finish?: CompositionFinish
  /** Per-object motion blur via temporal supersampling (export only). */
  motionBlur?: boolean | { shutter?: number; samples?: number }
  /** Depth-of-field / rack-focus over per-layer `depth`. */
  dof?: { focus: number; aperture?: number; range?: number; maxBlur?: number }
}
