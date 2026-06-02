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
      runs?: SceneTextRun[]
    }
  | { type: 'image'; src: string }
  | { type: 'shape'; geometry: ShapeGeometry; fill?: Color; gradient?: Gradient; stroke?: Stroke }
  | { type: 'svg'; src?: string; markup?: string }

/** Flex layout for a node's direct children (mirrors onda-scene's `Layout`).
 *  Resolved to absolute child transforms by the engine's layout pass. */
export interface Layout {
  direction?: 'row' | 'column'
  justify?: 'start' | 'center' | 'end' | 'space-between' | 'space-around'
  align?: 'start' | 'center' | 'end'
  gap?: number
  padding?: number
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
