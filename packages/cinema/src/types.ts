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

/** One element on a track: a component placed at `at` for `for`, with optional motion. */
export interface Entry {
  at: TimeSpec
  for: TimeSpec
  component: string
  props?: Record<string, unknown>
  animate?: EntryAnimation[]
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
}

export interface Scene {
  id: string
  label?: string
  for?: TimeSpec
  transition?: SceneTransition
  tracks: Track[]
}

/** A composition-level layer entry — absolute-timed, spans scene cuts. */
export interface LayerEntry {
  at?: TimeSpec
  for?: TimeSpec
  component: string
  props?: Record<string, unknown>
  animate?: EntryAnimation[]
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

export interface CompositionPayload {
  fps: number
  width: number
  height: number
  scenes: Scene[]
  layers?: Layer[]
  brand?: Brand
}
