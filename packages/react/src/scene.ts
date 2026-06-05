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
  /** Clockwise rotation in degrees about `origin` (default the local origin). */
  rotate?: number
  /** Pivot for scale + rotation in local space (CSS transform-origin). Default (0,0). */
  origin?: Vec2
}

/** A drop shadow / glow behind a shape (mirrors onda-scene's `Shadow`). */
export interface Shadow {
  color: Color
  /** Gaussian blur std-dev in px. */
  blur: number
  /** Shadow offset from the shape; default (0,0) = a centered glow. */
  offset?: Vec2
  /** Grow the shadow box by this many px on every side. Default 0. */
  spread?: number
}

export interface Stroke {
  color: Color
  width: number
  /** End-cap style (CSS stroke-linecap). Default 'butt'. */
  cap?: 'butt' | 'round' | 'square'
  /** Corner-join style (CSS stroke-linejoin). Default 'miter'. */
  join?: 'miter' | 'round' | 'bevel'
  /** Dash pattern: alternating on/off lengths in px. Omit for a solid stroke. */
  dash?: number[]
  /** Phase offset into the dash pattern (px) — animate for a draw-on reveal. */
  dash_offset?: number
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
  | { type: 'image'; src: string; width?: number; height?: number; fit?: ImageFit; blur?: number }
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
  | {
      type: 'shape'
      geometry: ShapeGeometry
      fill?: Color
      gradient?: Gradient
      stroke?: Stroke
      shadow?: Shadow
    }
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

/** An ordered, screen-space effect applied to a node + its subtree via
 *  render-to-texture (mirrors onda-scene's internally-tagged `Effect` enum).
 *  The subtree renders to an offscreen surface, the chain runs, then the result
 *  composites back at the node's transform/opacity/blend/clip. */
export type Effect =
  /** Gaussian blur; `sigma` = std-dev in OUTPUT px (CSS `blur()`). */
  | { effect: 'blur'; sigma: number }
  /** Glow / bloom: bright regions (luminance above `threshold`, scaled by
   *  `intensity`) are blurred with `sigma` and composited *additively* over the
   *  sharp subtree — a bright accent glows a soft halo. */
  | { effect: 'bloom'; threshold: number; intensity: number; sigma: number }

/** Compositing blend mode (CSS `mix-blend-mode`). Vello renders the full set;
 *  the CPU reference composites `normal` only. */
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'

export interface SceneNode {
  id?: number
  transform?: Transform
  opacity?: number
  /** Clip this node and its subtree to a geometry (local space). */
  clip?: ShapeGeometry
  /** Blend this node's subtree against the backdrop (CSS mix-blend-mode). */
  blend?: BlendMode
  /** Ordered screen-space effects applied to this node + subtree (render-to-texture). */
  effects?: Effect[]
  /** Flex-lay-out this node's direct children. */
  layout?: Layout
  kind: NodeKind
  children?: SceneNode[]
}

export interface Scene {
  composition: Composition
  root: SceneNode
}
