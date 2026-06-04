//! TypeScript shapes for the ONDA scene-graph JSON.
//!
//! These mirror `onda-scene`'s serde representation exactly (field names,
//! snake_case, internally-tagged enums) so the JSON this package emits
//! round-trips into the Rust engine. Keep them in lockstep with that crate.

export interface Vec2 {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

/** Straight-alpha sRGB, components in 0..1. `a` defaults to 1 on the Rust side. */
export interface Color {
  r: number
  g: number
  b: number
  a?: number
}

export interface Transform {
  translate?: Vec2
  scale?: Vec2
  /** Clockwise rotation in degrees about the node's local origin. */
  rotate?: number
}

export interface Stroke {
  color: Color
  width: number
}

export interface Composition {
  width: number
  height: number
  fps: number
  duration_in_frames: number
}

export type ShapeGeometry =
  | { shape: 'rect'; size: Size; corner_radius?: number }
  | { shape: 'ellipse'; size: Size }
  | { shape: 'path'; data: string }

/** A color stop of a {@link Gradient}: a color at offset 0..1. */
export interface GradientStop {
  offset: number
  color: Color
}

/** A gradient paint, in the shape's local coordinate space. */
export type Gradient =
  | { gradient: 'linear'; start: Vec2; end: Vec2; stops: GradientStop[] }
  | { gradient: 'radial'; center: Vec2; radius: number; stops: GradientStop[] }

/** One styled run of rich text (mirrors onda-scene's `TextRun`). */
export interface SceneTextRun {
  text: string
  color?: Color
  font_size?: number
  font_family?: string
  weight?: number
  italic?: boolean
}

export type NodeKind =
  | { type: 'group' }
  | {
      type: 'text'
      content: string
      font_size?: number
      color?: Color
      font_family?: string
      weight?: number
      italic?: boolean
      letter_spacing?: number
      runs?: SceneTextRun[]
    }
  | { type: 'image'; src: string; width?: number; height?: number; fit?: ImageFit }
  | {
      type: 'video'
      src: string
      /** Source position in seconds of the frame to display. */
      time?: number
      width?: number
      height?: number
      fit?: ImageFit
      /** Preview-only hint (ignored by renderers + export): how the player should
       *  preview a source it can't composite (cross-origin without CORS).
       *  `'skip'` (default) leaves it blank + warns; `'element'` overlays a plain
       *  `<video>`. Never affects `onda export`. */
      previewFallback?: 'skip' | 'element'
    }
  | {
      /** A non-visual audio clip (renderers skip it; the player plays it). */
      type: 'audio'
      src: string
      /** Composition time (seconds) the clip begins at. */
      start?: number
      /** Seconds into the source to begin from (trim the head). */
      start_at?: number
      /** Linear gain 0..1. */
      volume?: number
    }
  | { type: 'shape'; geometry: ShapeGeometry; fill?: Color; gradient?: Gradient; stroke?: Stroke }
  | { type: 'svg'; src?: string; markup?: string }

/** How a bitmap is fitted into its `width`×`height` box (mirrors onda-scene's
 *  `ImageFit`). The renderer measures the decoded image to compute the scale. */
export type ImageFit = 'fill' | 'cover' | 'contain'

/** Flex layout for a node's direct children (mirrors onda-scene's `Layout`).
 *  Resolved to absolute child transforms by the engine's layout pass. */
export interface Layout {
  direction?: 'row' | 'column'
  justify?: 'start' | 'center' | 'end' | 'space-between' | 'space-around'
  align?: 'start' | 'center' | 'end'
  gap?: number
  padding?: number
  /** Wrap children onto multiple lines when they overflow the main axis
   *  (CSS `flex-wrap`). Needs a fixed main-axis size (`width`/`height`). */
  wrap?: boolean
  width?: number
  height?: number
}

export interface SceneNode {
  id?: number
  transform?: Transform
  opacity?: number
  /** Clip this node and its subtree to a geometry (local space). */
  clip?: ShapeGeometry
  /** Flex-lay-out this node's direct children. */
  layout?: Layout
  kind: NodeKind
  children?: SceneNode[]
}

export interface Scene {
  composition: Composition
  root: SceneNode
}
