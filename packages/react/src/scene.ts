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
  /** Trim paths: draw only the [start, end] arc-length slice of the stroke (0..1),
   *  rotated by offset. Animate end 0→1 for a line-draw. */
  trim?: { start?: number; end?: number; offset?: number }
}

export interface Composition {
  width: number
  height: number
  fps: number
  duration_in_frames: number
  /** Opt-in cinematic LINEAR + ACES finishing pipeline (gpu/export only). */
  linear?: boolean
  /** Composition-level cinematic finish: a linear-HDR finishing chain + ACES tone-map
   *  run after the comp rasterizes (gpu/export only). */
  finish?: Finish
}

/** Composition-level cinematic finish (linear HDR + ACES). See {@link Composition.finish}. */
export interface Finish {
  /** Linear exposure multiplier before the tone-map (1 = neutral). */
  exposure?: number
  /** Comp-level bloom in linear HDR. */
  bloom?: { sigma: number; threshold?: number; intensity?: number }
  /** Warm halation around highlights (0 = off). */
  halation?: number
  /** Grade: white-balance (+ warm / − cool; 0 = neutral). */
  temperature?: number
  /** Grade: contrast around mid-grey (1 = identity). */
  contrast?: number
  /** Grade: saturation (1 = identity, 0 = greyscale). */
  saturation?: number
  /** Vignette: radial edge darkening (0 = off). */
  vignette?: number
  /** Film-grain intensity, added in linear (0 = off). */
  grain?: number
  /** Grain animation seed (the reconciler injects the current frame). */
  grain_seed?: number
  /** A cinematic 3D color LUT (`.cube`-style lookup table) applied as the FINAL
   *  finish step, in DISPLAY space (after the grade + ACES tone-map + sRGB encode),
   *  as a trilinear lookup. `table` holds `size³` RGB triples in 0..1, **red varying
   *  fastest, then green, then blue** (the entry for grid cell (r,g,b) is at
   *  `((b*size + g)*size + r) * 3`). Omitted = no LUT (identity). Honored by both the
   *  GPU (3D texture) and the CPU reference (software trilinear). */
  lut?: { size: number; table: number[] }
}

export type ShapeGeometry =
  | { shape: 'rect'; size: Size; corner_radius?: number }
  | { shape: 'ellipse'; size: Size }
  | { shape: 'path'; data: string }
  | { shape: 'boolean'; op: BooleanOp; operands: BooleanOperand[] }

/** Boolean (merge-paths) operation for a {@link ShapeGeometry} of `shape: 'boolean'`. */
export type BooleanOp = 'union' | 'difference' | 'intersect' | 'xor'

/** One input to a boolean geometry: a sub-geometry + the transform placing it. */
export interface BooleanOperand {
  geometry: ShapeGeometry
  transform: Transform
}

/** A color stop of a {@link Gradient}: a color at offset 0..1. */
export interface GradientStop {
  offset: number
  color: Color
}

/** A gradient paint, in the shape's local coordinate space. */
export type Gradient =
  | { gradient: 'linear'; start: Vec2; end: Vec2; stops: GradientStop[] }
  | { gradient: 'radial'; center: Vec2; radius: number; stops: GradientStop[] }
  | {
      gradient: 'fbm'
      stops: GradientStop[]
      scale?: number
      time?: number
      warp?: number
    }

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
  /** Isolate / precomp: flatten the subtree to one layer (render-to-texture) so the
   *  node's opacity/blend apply to the composited result, not per-child. */
  | { effect: 'isolate' }
  /** Gaussian blur; `sigma` = std-dev in OUTPUT px (CSS `blur()`). */
  | { effect: 'blur'; sigma: number }
  /** Directional (motion) blur: a 1D blur of std-dev `sigma` (px) smeared along
   *  `angle` (radians, 0 = horizontal) — the cinematic "in-motion" tell. */
  | { effect: 'directional_blur'; sigma: number; angle: number }
  /** Chromatic aberration: R/B split by `amount` px radially from centre. */
  | { effect: 'chromatic_aberration'; amount: number }
  /** Vignette: radial edge-darkening, `amount` (0..1) over `softness` (0..1). */
  | { effect: 'vignette'; amount: number; softness: number }
  /** Posterize: quantize each channel to `levels` (≥2) steps. */
  | { effect: 'posterize'; levels: number }
  /** Duotone: luma → gradient from `shadow` to `highlight` (RGB, 0..1). */
  | { effect: 'duotone'; shadow: [number, number, number]; highlight: [number, number, number] }
  /** Chroma key: alpha-cut pixels within `threshold` of `key` (RGB 0..1), ramping
   *  over `smoothness`. */
  | { effect: 'chroma_key'; key: [number, number, number]; threshold: number; smoothness: number }
  /** Glow / bloom: bright regions (luminance above `threshold`, scaled by
   *  `intensity`) are blurred with `sigma` and composited *additively* over the
   *  sharp subtree — a bright accent glows a soft halo. */
  | { effect: 'bloom'; threshold: number; intensity: number; sigma: number }
  /** Cinematic color grade: a per-pixel remap (no blur) — the "land AI media"
   *  wedge. `exposure` (linear gain, 0 = identity), `contrast` (1 = identity),
   *  `saturation` (1 = identity, 0 = grayscale), `temperature` (warm/cool on R/B,
   *  0 = neutral) and `tint` (green/magenta on G, 0 = neutral). */
  | {
      effect: 'color_grade'
      exposure: number
      contrast: number
      saturation: number
      temperature: number
      tint: number
    }
  /** Gooey / liquid / metaball morph: the subtree is blurred with `sigma`, then
   *  its alpha is sharpened around `threshold` (0..1 cutoff) so overlapping shapes
   *  fuse into solid forms joined by smooth necks (the "drops coalescing" look). */
  | { effect: 'goo'; sigma: number; threshold: number }
  /** Film grain — luminance-banded, animated monochrome noise added late over the
   *  subtree (the compositing "glue" that unifies mismatched sources, and the dither
   *  that hides 8-bit banding on dark gradients). Peaks in the midtones, clean at
   *  pure black/white. `intensity` ~0.04–0.1 is filmic, `size` is the grain scale in
   *  px (~1 = fine), `seed` an animation offset — pass the frame for living grain. */
  | { effect: 'grain'; intensity: number; size: number; seed: number }
  /** Displacement / warp — re-sample the subtree at coordinates offset by a
   *  procedural fBm field (`out = src(p + (fbm·2-1)·amount)`). The primitive behind
   *  liquid-melt, ink-bleed, heat-haze, ripple and glass-refraction looks that
   *  transform/opacity/clip cannot fake. `amount` is the warp magnitude in output
   *  px (0 = identity), `scale` the noise frequency over the frame (~3 = broad
   *  swells, larger = finer churn), `time` an animation phase — advance it per frame
   *  (e.g. `frame * 0.05`) for flowing motion. Honored by Vello (GPU) and the CPU
   *  reference. Ramp `amount` 0→N→0 across a transition for a melt-and-reform. */
  | {
      effect: 'displace'
      amount: number
      scale: number
      time: number
      /** Field driving the warp. `'fbm'` (default): organic noise (melt/ink/haze).
       *  `'ripple'`: concentric rings from the frame centre (water-drop / shockwave). */
      mode?: 'fbm' | 'ripple'
    }
  /** Frosted glass (CSS `backdrop-filter`). The ODD ONE OUT: instead of capturing
   *  this node's OWN subtree, it samples the already-composited BACKDROP *behind*
   *  the node, blurs it by `sigma` (output px, like CSS `blur()`), scales its
   *  `brightness`/`saturation` (CSS-style, `1` = identity), and tints it toward
   *  `tint` by that color's ALPHA (alpha 0 = no tint). The blurred backdrop is
   *  drawn as the node's backing; the node's own content composites on top. */
  | {
      effect: 'backdrop_blur'
      sigma: number
      tint: Color
      brightness: number
      saturation: number
    }
  /** Light-wrap — the #1 "integrated vs pasted" compositing tell. Like
   *  `backdrop_blur` it samples the already-composited BACKDROP *behind* the node,
   *  but instead of laying it under the node it bleeds that blurred light onto the
   *  node's own FEATHERED EDGES (a real lens spilling a bright background a few px
   *  onto a foreground subject), so a cut-out plate reads as *shot in* the scene.
   *  `sigma` is the backdrop blur / rim width, `strength` scales the added light
   *  (0 = off). Export/native only — the web preview draws the node un-wrapped. */
  | { effect: 'light_wrap'; sigma: number; strength: number }

/** Which channel of a {@link Matte}'s rendered `source` subtree drives the reveal
 *  (CSS `mask-mode`). `'alpha'` (the default): content alpha ×= matte alpha — the
 *  signature media-through-type matte. `'luminance'`: content alpha ×= luma(matte
 *  rgb) × matte alpha (white reveals, black hides — gradient wipes / luma keys). */
export type MatteMode = 'alpha' | 'luminance'

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
  /** Matte (track matte / mask): reveal this node's content only through the
   *  `source` subtree's alpha — or luminance, per `mode` — multiplying the
   *  content's alpha by it. The strictly-more-powerful sibling of `clip` (a
   *  static geometry); `source` is a fully rendered subtree (animated text, a
   *  gradient, an image) — the "media-through-type" move. Omitted when absent. */
  matte?: { mode: MatteMode; source: SceneNode }
  /** Blend this node's subtree against the backdrop (CSS mix-blend-mode). */
  blend?: BlendMode
  /** Ordered screen-space effects applied to this node + subtree (render-to-texture). */
  effects?: Effect[]
  /** 3D SCENE ROOT: makes this node's direct children 3D layers, placed in one
   *  shared 3D world by their `transform3d` and rendered through this perspective
   *  camera (depth-sorted, composited as one layer). GPU runs true perspective;
   *  the CPU reference degrades to a 2.5D depth-sorted composite. */
  camera3d?: Camera3D
  /** This node's placement as a 3D layer (only meaningful inside a 3D scene). */
  transform3d?: Transform3D
  /** Extrude this layer's 2D outline into a lit 3D solid (GPU only; CPU draws flat). */
  extrude?: Extrude
  /** Flex-lay-out this node's direct children. */
  layout?: Layout
  kind: NodeKind
  children?: SceneNode[]
}

/** Extrude a 3D layer's 2D outline into a lit solid — the "3D logo / title" move
 *  (mirrors scene-rs `Extrude`). Shape/text layer inside a `<Scene3D>` only. */
export interface Extrude {
  /** Thickness along z, in world units (the solid spans ±depth/2 about the plane). */
  depth: number
}

/** A perspective camera for a 3D scene (mirrors scene-rs `Camera3D`). World units
 *  are composition pixels (x→right, y→down); `+z` points away from the camera, into
 *  the screen (larger z = farther = smaller), the After Effects convention. Leaving
 *  fields default frames the `z = 0` plane to fill the comp, so a layer at `z = 0`
 *  with no rotation matches its 2D placement. */
export interface Camera3D {
  /** Eye position `[x, y, z]`. Omit to derive from `fov` (centered, looking at +z). */
  position?: [number, number, number]
  /** Look-at point `[x, y, z]`. Omit ⇒ comp center at z = 0. */
  target?: [number, number, number]
  /** Up vector. Omit ⇒ `[0, -1, 0]` (screen up). */
  up?: [number, number, number]
  /** Vertical field of view, degrees. Default 50. */
  fov?: number
  near?: number
  far?: number
}

/** The 3D placement of a layer inside a 3D scene (mirrors scene-rs `Transform3D`). */
export interface Transform3D {
  /** World position of the anchor `[x, y, z]` in comp pixels. z = 0 is the framing
   *  plane; larger z is farther into the screen (smaller), negative z nearer the camera. */
  position?: [number, number, number]
  /** Degrees about each axis (Z·Y·X order): X pitch, Y yaw, Z roll. */
  rotation?: [number, number, number]
  /** Pivot within the layer's content plane (comp px). Omit ⇒ layer center. */
  anchor?: [number, number]
}

export interface Scene {
  composition: Composition
  root: SceneNode
}
