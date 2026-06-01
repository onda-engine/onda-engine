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

export type NodeKind =
  | { type: 'group' }
  | { type: 'text'; content: string; font_size?: number; color?: Color }
  | { type: 'image'; src: string }
  | { type: 'shape'; geometry: ShapeGeometry; fill?: Color; stroke?: Stroke }

export interface SceneNode {
  id?: number
  transform?: Transform
  opacity?: number
  kind: NodeKind
  children?: SceneNode[]
}

export interface Scene {
  composition: Composition
  root: SceneNode
}
