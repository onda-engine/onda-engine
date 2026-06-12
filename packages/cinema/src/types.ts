//! The timeline composition payload — the document an agent (ONDA Studio) emits
//! and `buildComposition` turns into an @onda/react scene. Structural mirror of
//! Studio's `composition.ts` schema (kept as plain types; validation is
//! `validateComposition`).

/** A time: seconds (number) or a spec string — `"2s"`, `"500ms"`, `"0:02"`, `"90f"`. */
export type TimeSpec = string | number

/** An entry's motion: an `@onda/components` choreography pattern name + params. */
export interface EntryAnimation {
  pattern: string
  params?: Record<string, unknown>
}

/** Per-entry cinematic EFFECTS — the same sugar props @onda/react's `<Group>`
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

/** One element on a track: a component placed at `at` for `for`, with optional motion. */
export interface Entry {
  at: TimeSpec
  for: TimeSpec
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
