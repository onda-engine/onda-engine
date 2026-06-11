//! The ONDA React components. Each is a thin typed wrapper that emits an
//! internal host element; the reconciler maps those to scene-graph nodes.
//!
//! ```tsx
//! <Composition width={1200} height={360} fps={30} durationInFrames={30}>
//!   <Rect width={1200} height={360} fill="#0a0d17" />
//!   <Text fontSize={96} color="#fff" x={96} y={110}>Hello ONDA</Text>
//! </Composition>
//! ```

import { type ReactElement, type ReactNode, createElement } from 'react'
import type { ClipInput } from './clip.js'
import type { ColorInput } from './color.js'
import { useCurrentFrame, useVideoConfig } from './frame.js'
import type { GradientInput } from './gradient.js'
import type { BlendMode, Camera3D, Effect, ImageFit, Layout, MatteMode } from './scene.js'

/** Properties shared by every scene node: identity, placement, opacity, clip. */
export interface NodeProps {
  /** Stable id, required to target the node from an animation timeline. */
  id?: number
  /** Translation in pixels. */
  x?: number
  y?: number
  /** Scale factor (1 = identity). */
  scaleX?: number
  scaleY?: number
  /** Clockwise rotation in degrees, about the transform origin (default (0,0)).
   *  Renders on the GPU (Vello) backend; the CPU reference rasterizer ignores it. */
  rotation?: number
  /** Pivot for scale + rotation in local px (CSS transform-origin). Default (0,0).
   *  For "about the center", pass half the node's width/height. */
  originX?: number
  originY?: number
  /** Opacity, 0..1. */
  opacity?: number
  /** DEPTH (z) of this layer for depth-of-field, in the same arbitrary units as
   *  `<Composition dof={{ focus }}>`. Layers at the focus depth stay sharp; the
   *  farther a layer's `depth` is from `focus`, the more it defocuses (a blur the
   *  reconciler computes from the camera aperture). Animate the comp's `focus` for a
   *  rack-focus pull. No effect unless the comp sets `dof`. */
  depth?: number
  /** 3D LAYER position `[x, y, z]` in world pixels — meaningful only inside a
   *  `<Scene3D>`. `z = 0` is the framing plane (matches the 2D placement); larger
   *  `z` is farther into the screen (smaller), negative `z` nearer the camera (After
   *  Effects convention). Animate for fly-throughs / parallax / exploded views. */
  position3d?: [number, number, number]
  /** 3D LAYER rotation `[x, y, z]` in degrees (Z·Y·X): X pitch (tilt toward/away),
   *  Y yaw (swing), Z roll (in-plane spin). Inside `<Scene3D>` only. GPU-only — the
   *  CPU reference degrades to a flat depth-sorted composite (no out-of-plane tilt). */
  rotation3d?: [number, number, number]
  /** Pivot within this layer's content plane (px) that `position3d`/`rotation3d`
   *  act about. Default: the layer's center. */
  anchor3d?: [number, number]
  /** EXTRUDE this layer's 2D outline into a lit 3D SOLID (the "3D logo / title"):
   *  inside a `<Scene3D>`, a shape or text layer becomes a mesh with `depth`
   *  thickness + side walls, shaded by a directional light so it catches the light
   *  as it rotates. GPU only — the CPU reference + live preview draw the flat outline. */
  extrude?: number | { depth: number }
  /** Blend this node's subtree against the backdrop (CSS mix-blend-mode).
   *  GPU/Vello-rendered (e.g. `'screen'`, `'multiply'`, `'overlay'`). */
  blendMode?: BlendMode
  /** Clip this node and its subtree to a region (local space). */
  clip?: ClipInput
  /** Matte (track matte / mask): a stencil SUBTREE, passed as a React element,
   *  through which this node's content is revealed. The matte's alpha — or its
   *  luminance, per `matteMode` — multiplies the content's alpha, so the content
   *  (this node's children) shows only where the matte covers. The
   *  strictly-more-powerful sibling of `clip`: the matte is a fully rendered,
   *  animatable subtree (giant text, a gradient, a shape) — the signature
   *  "media-through-type" move (a photo seen only through animated type). */
  matte?: ReactElement
  /** Which channel of the {@link NodeProps.matte} subtree drives the reveal (CSS
   *  `mask-mode`). `'alpha'` (default): content alpha ×= matte alpha. `'luminance'`:
   *  content alpha ×= luma(matte) × matte alpha (white reveals, black hides). */
  matteMode?: MatteMode
  /** Ordered, low-level screen-space effects on this node + subtree (render-to-texture). */
  effects?: Effect[]
  /** Gaussian blur std-dev in output px; sugar for `effects: [{ effect: 'blur', sigma }]`.
   *  Honored by Vello AND the CPU reference once Phase 1 lands. */
  blur?: number
  /** Directional (motion) blur sugar for `effects: [{ effect: 'directional_blur', … }]`:
   *  a 1D blur of std-dev `sigma` (px) along `angle` (radians, default 0 = horizontal) —
   *  the cinematic "in-motion" smear. Honored by Vello AND the CPU reference. */
  directionalBlur?: { sigma: number; angle?: number }
  /** Chromatic-aberration sugar: R/B split by `amount` px radially from centre. */
  chromaticAberration?: number
  /** Vignette sugar — radial edge darkening. `amount` 0..1; `softness` 0..1 (default 0.5). */
  vignette?: number | { amount: number; softness?: number }
  /** Posterize sugar: quantize each channel to `levels` (≥2) discrete steps. */
  posterize?: number
  /** Duotone sugar: map luminance to a gradient from `shadow` to `highlight`. */
  duotone?: { shadow: ColorInput; highlight: ColorInput }
  /** Chroma-key sugar: knock out `color`; `threshold` (default 0.4) + `smoothness`
   *  (default 0.1) shape the soft matte edge. */
  chromaKey?: { color: ColorInput; threshold?: number; smoothness?: number }
  /** Glow / bloom sugar for `effects: [{ effect: 'bloom', ... }]`: bright regions
   *  (luminance above `threshold`, default 0.7; scaled by `intensity`, default 1)
   *  blur with `sigma` and composite additively over the sharp subtree. Honored by
   *  Vello AND the CPU reference. */
  bloom?: number | { sigma: number; threshold?: number; intensity?: number }
  /** Cinematic color-grade sugar for `effects: [{ effect: 'color_grade', ... }]` —
   *  the "land AI media" wedge: one grade unifies mismatched clips into a single
   *  look. All five fields are optional and default to the neutral identity
   *  (`exposure` 0, `contrast` 1, `saturation` 1, `temperature` 0, `tint` 0), so
   *  `{}` is a no-op. Honored by Vello AND the CPU reference. */
  grade?: {
    /** Linear exposure gain (`2^exposure`); 0 = identity. */
    exposure?: number
    /** Contrast around a 0.5 pivot; 1 = identity. */
    contrast?: number
    /** Saturation; 1 = identity, 0 = grayscale, >1 = punchier. */
    saturation?: number
    /** Warm/cool shift (R up / B down for positive); 0 = neutral. */
    temperature?: number
    /** Green/magenta shift on G (positive = green); 0 = neutral. */
    tint?: number
  }
  /** Gooey / liquid / metaball-morph sugar for `effects: [{ effect: 'goo', ... }]`:
   *  the subtree is blurred with `sigma`, then its alpha is sharpened around
   *  `threshold` (the 0..1 cutoff, default 0.5) so overlapping shapes fuse into
   *  solid forms joined by smooth necks (the "drops of liquid coalescing" look).
   *  A bare number is the `sigma`. Honored by Vello AND the CPU reference. */
  goo?: number | { sigma: number; threshold?: number }
  /** Film-grain sugar for `effects: [{ effect: 'grain', ... }]`: luminance-banded,
   *  animated monochrome noise added late over the subtree — the compositing "glue"
   *  that makes mismatched sources read as one photographed image, and the dither
   *  that hides 8-bit banding on dark gradients. A bare number is the `intensity`
   *  (~0.04–0.1 is filmic); the object form adds `size` (grain scale in px, default
   *  1) and `seed` (animation offset — pass the current frame for *living* grain,
   *  default 0 = static). Honored by Vello AND the CPU reference. */
  grain?: number | { intensity: number; size?: number; seed?: number }
  /** Frosted-glass sugar for `effects: [{ effect: 'backdrop_blur', ... }]`: samples
   *  the already-composited BACKDROP *behind* this node (not its own subtree),
   *  blurs it by `sigma` (output px), and draws it as the node's backing — then the
   *  node's own content (e.g. a translucent panel `fill`) composites on top. A bare
   *  number is just the `sigma`; the object form adds a `tint` (its alpha = tint
   *  strength), a `brightness` and a `saturation` (CSS-style, `1` = identity).
   *  Honored by Vello AND the CPU reference. */
  backdropBlur?:
    | number
    | { sigma: number; tint?: ColorInput; brightness?: number; saturation?: number }
  /** Light-wrap sugar for `effects: [{ effect: 'light_wrap', ... }]`: bleeds the
   *  blurred BACKDROP behind this node onto its own feathered EDGES — the #1
   *  "shot in, not pasted on" compositing tell for a cut-out plate. A bare number
   *  is the `sigma` (the backdrop blur / rim width); the object form adds a
   *  `strength` (0 = off, ~1 = a natural spill). EXPORT/NATIVE only — the live
   *  preview draws the node un-wrapped. */
  lightWrap?: number | { sigma: number; strength?: number }
  children?: ReactNode
}

/** Paint props shared by shapes: a solid fill, a gradient (which takes
 *  precedence), and a stroke. */
export interface PaintProps {
  fill?: ColorInput
  gradient?: GradientInput
  stroke?: ColorInput
  strokeWidth?: number
  /** Stroke end-cap (CSS stroke-linecap). Default 'butt'. */
  strokeCap?: 'butt' | 'round' | 'square'
  /** Stroke corner-join (CSS stroke-linejoin). Default 'miter'. */
  strokeJoin?: 'miter' | 'round' | 'bevel'
  /** Dash pattern: alternating on/off px (e.g. [12, 8]). Omit for solid. */
  strokeDash?: number[]
  /** Phase offset into the dash pattern (px) — animate for a draw-on reveal. */
  strokeDashOffset?: number
  /** TRIM PATHS (mograph line-draw): draw only a slice of the stroked outline.
   *  `trimStart`/`trimEnd` are fractions 0..1 of the path's length (default 0 / 1);
   *  `trimOffset` rotates the visible window around the path. Animate `trimEnd` 0→1
   *  for a draw-on reveal. Needs a `stroke`; length is measured by the engine. */
  trimStart?: number
  trimEnd?: number
  trimOffset?: number
  /** Drop shadow / glow behind the shape (CSS box-shadow). `blur` is the gaussian
   *  std-dev; `(0,0)` offset reads as a centered glow. GPU/Vello-rendered. */
  shadow?: {
    color: ColorInput
    blur: number
    offsetX?: number
    offsetY?: number
    spread?: number
  }
}

export interface CompositionProps {
  width: number
  height: number
  fps: number
  durationInFrames: number
  /** Opt into the cinematic LINEAR + ACES finishing pipeline (correct bloom/light,
   *  light-wrap, halation). GPU/export only; off by default (gamma). */
  linear?: boolean
  /** Composition-level cinematic FINISH: a linear-HDR finishing chain run after the
   *  comp rasterizes — bloom bleeding REAL light (highlights exceed 1.0 and roll off),
   *  warm halation — ending in one ACES film tone-map. The correct "looks shot" output
   *  transform (unlike per-node effects, no HDR is lost between passes). GPU/export only. */
  finish?: {
    /** Linear exposure multiplier before the tone-map (1 = neutral; >1 brightens). */
    exposure?: number
    /** Comp-level bloom in linear HDR. `sigma` = halo blur radius (px). */
    bloom?: { sigma: number; threshold?: number; intensity?: number }
    /** Warm red/orange halation around highlights (0 = off, ~0.6 filmic). */
    halation?: number
    /** Grade — white balance: + warm (boost red/cut blue), − cool. 0 = neutral. */
    temperature?: number
    /** Grade — contrast around mid-grey. 1 = identity, >1 punchier. */
    contrast?: number
    /** Grade — saturation. 1 = identity, 0 = greyscale, >1 richer. */
    saturation?: number
    /** Vignette — radial edge darkening of the finished frame. 0 = off. */
    vignette?: number
    /** Film grain intensity added in linear light (luminance-banded). 0 = off; the
     *  current frame is used as the animation seed automatically. */
    grain?: number
  }
  /** Per-object MOTION BLUR via temporal supersampling: each output frame is the
   *  average of `samples` sub-frames spread across the shutter window, so anything
   *  that MOVES smears by its own motion and static elements stay sharp — the
   *  shutter-angle blur every pro comp ships with. `true` = a 180° shutter, 16
   *  samples. Cost is `samples`× the render, so it's an EXPORT feature (the live
   *  preview shows the sharp frame). */
  motionBlur?:
    | boolean
    | {
        /** Shutter angle in degrees: how much of the frame the shutter is open. 180 =
         *  half a frame (the film default); 360 = full-frame (heavier blur). */
        shutter?: number
        /** Sub-frames averaged per output frame. More = smoother smear, linearly costlier. */
        samples?: number
      }
  /** DEPTH OF FIELD (2.5D rack focus): with this set, any layer carrying a `depth`
   *  prop defocuses by how far its `depth` is from `focus` — sharp at the focus plane,
   *  blurrier away from it. Animate `focus` for a focus pull. Resolved as a per-layer
   *  blur (reuses the blur effect), so it works on both backends. */
  dof?: {
    /** The `depth` value that is in sharp focus. */
    focus: number
    /** How fast blur grows with depth distance (px of blur per unit of depth past the
     *  in-focus band). Bigger = shallower depth of field. Default 0.04. */
    aperture?: number
    /** A sharp band (± in depth units) around `focus` that stays unblurred. Default 0. */
    range?: number
    /** Clamp the blur σ (px) so far layers don't blur to mush. Default 40. */
    maxBlur?: number
  }
  children?: ReactNode
}

/** The root of every ONDA tree: resolution + timing, like Remotion's. */
export function Composition(props: CompositionProps) {
  return createElement('onda-composition', props)
}

export type GroupProps = NodeProps

/** A transform/opacity container with no visual of its own. */
export function Group(props: GroupProps) {
  return createElement('onda-group', props)
}

/** Props for {@link Repeater} (After Effects' shape "Repeater"). */
export interface RepeaterProps {
  /** Number of copies (including the original). */
  count: number
  /** Per-copy translation, applied cumulatively (copy i is offset i×). */
  offsetX?: number
  offsetY?: number
  /** Per-copy rotation in degrees, applied cumulatively (a radial array / spiral). */
  rotation?: number
  /** Per-copy scale factor, applied cumulatively (copy i is `scale**i`). 1 = none. */
  scale?: number
  /** Pivot for the per-copy rotation/scale (local px). Default (0,0). */
  originX?: number
  originY?: number
  /** Opacity of the first / last copy; the rest interpolate (a fade-out trail). */
  startOpacity?: number
  endOpacity?: number
  children?: ReactNode
}

/** REPEATER — stamp `children` `count` times, each copy COMPOUNDING one more step of
 *  the transform (offset / rotation / scale) and a step of the opacity ramp: grids,
 *  radial arrays, spirals, motion trails. Mirrors After Effects' shape Repeater.
 *
 *  Implemented as `count` nested transform groups (each adds one increment on top of
 *  the previous, so the transforms truly compound into a spiral rather than a naive
 *  `i×` fan), with a copy of `children` drawn at every level. Pure composition — it
 *  renders identically on every backend. */
export function Repeater({
  count,
  offsetX = 0,
  offsetY = 0,
  rotation = 0,
  scale = 1,
  originX = 0,
  originY = 0,
  startOpacity = 1,
  endOpacity = 1,
  children,
}: RepeaterProps): ReactElement {
  const n = Math.max(1, Math.floor(count))
  const opacityAt = (i: number): number =>
    startOpacity + (endOpacity - startOpacity) * (n > 1 ? i / (n - 1) : 0)
  // Build inside-out: level L sits inside L increment groups → transform compounded
  // L times. Each level draws ONE copy (with its own ramped opacity) plus the deeper,
  // further-incremented levels.
  const buildLevel = (level: number): ReactElement | null => {
    if (level >= n) return null
    const copy = createElement(Group, { key: 'copy', opacity: opacityAt(level) }, children)
    const deeper = buildLevel(level + 1)
    // Level 0 is the identity copy; every deeper level adds one transform increment.
    const transform =
      level === 0
        ? {}
        : { x: offsetX, y: offsetY, rotation, scaleX: scale, scaleY: scale, originX, originY }
    return createElement(Group, { key: level, ...transform }, copy, deeper)
  }
  return buildLevel(0) ?? createElement(Group, null)
}

/** Props for {@link Merge} (After Effects' shape "Merge Paths"). */
export interface MergeProps extends PaintProps, Omit<NodeProps, 'children'> {
  /** Boolean operation over the SHAPE children: `union` (add) / `difference` (the
   *  first minus the rest) / `intersect` (common area) / `xor` (symmetric difference).
   *  Default `union`. */
  op?: 'union' | 'difference' | 'intersect' | 'xor'
  children?: ReactNode
}

/** MERGE PATHS — combine the SHAPE children into ONE outline via a boolean `op`
 *  (union / difference / intersect / xor). A ring = circle − circle; a lens =
 *  circle ∩ circle; a speech bubble = rect ∪ triangle. The children are folded into
 *  the result (not drawn separately), so fill/stroke the `<Merge>` itself. Curve
 *  outlines are flattened before the boolean; resolved on both backends (i_overlay). */
export function Merge(props: MergeProps) {
  return createElement('onda-boolean', props)
}

export type PrecompProps = NodeProps

/** PRECOMP — flatten this subtree to a SINGLE layer (render-to-texture) before its
 *  `opacity` / `blendMode` / effects apply, the way After Effects' precomp /
 *  collapse-transformations does. Reach for it when you fade or blend-mode a GROUP of
 *  overlapping layers and don't want the overlaps to double-up, or to treat a group as
 *  one unit. (It's a `<Group>` carrying the `isolate` effect.) */
export function Precomp(props: PrecompProps) {
  const effects: Effect[] = [{ effect: 'isolate' }, ...(props.effects ?? [])]
  return createElement(Group, { ...props, effects })
}

/** Flex layout props for {@link Flex} / {@link AbsoluteFill} (CSS-flexbox subset). */
export interface FlexProps extends NodeProps, Layout {}

/** A flex container: lays out its direct children (row/column, with
 *  justify/align/gap/padding) instead of requiring absolute x/y. Resolved to
 *  absolute positions by the engine's layout pass. */
export function Flex(props: FlexProps) {
  const { direction, justify, align, gap, padding, wrap, width, height, ...rest } = props
  const layout: Layout = { direction, justify, align, gap, padding, wrap, width, height }
  return createElement('onda-group', { ...rest, layout })
}

export interface CenterProps extends Omit<NodeProps, 'children'> {
  /** Top of the centering row (px). Default 0. */
  y?: number
  /** Height of the row the content is centered within (px). Omit to size to content. */
  height?: number
  children?: ReactNode
}

/** Horizontally CENTER children across the composition width at vertical position `y` —
 *  sugar for a full-width `<Flex justify="center">`. The reliable way to center text:
 *  the layout pass measures the real glyph width natively, so you never hand-compute an
 *  `x` (which mis-centers the moment the text, font, or size changes). */
export function Center(props: CenterProps) {
  const { children, y, height, ...rest } = props
  const { width } = useVideoConfig()
  return createElement(
    Flex,
    {
      ...rest,
      x: 0,
      y: y ?? 0,
      width,
      ...(height !== undefined ? { height } : {}),
      justify: 'center',
      align: 'center',
    },
    children,
  )
}

export type AbsoluteFillProps = Omit<FlexProps, 'width' | 'height'>

/** A full-canvas flex container (like Remotion's `<AbsoluteFill>`): fills the
 *  composition and lays children out (column by default) — ideal for centering
 *  or stacking. Combine with `justify`/`align` to center content. */
export function AbsoluteFill(props: AbsoluteFillProps) {
  const { width, height } = useVideoConfig()
  return Flex({ direction: 'column', ...props, width, height })
}

export interface CameraProps {
  /** The world — children laid out in absolute WORLD-pixel coordinates. */
  children?: ReactNode
  /** World x (px) to center in the viewport. Default: viewport center (no pan). */
  focusX?: number
  /** World y (px) to center in the viewport. Default: viewport center (no pan). */
  focusY?: number
  /** Zoom about the focus point. 1 = neutral, >1 = pushed in. */
  zoom?: number
  /** Camera roll in degrees (2D rotation about the focus point). GPU-only. */
  rotate?: number
  /** Viewport size; defaults to the composition canvas. */
  viewportWidth?: number
  viewportHeight?: number
}

/**
 * A 2D camera: frames an oversized "world" (its children, laid out in world-pixel
 * coordinates) by centering a world point in the viewport at a given zoom + roll —
 * pans across a grid larger than the canvas, push-in fly-overs, focus moves.
 *
 * Pure translate/scale/rotate — a STACK OF {@link Group}s, no new scene node:
 * `translate(vw/2,vh/2) ∘ [scale·rotate about origin] ∘ translate(-focus)`, so the
 * world point `focus` lands at the viewport center, scaled by `zoom`. (`rotate`
 * renders on the GPU/Vello backend only, like {@link NodeProps.rotation}.) Animate
 * focus/zoom per frame ({@link useCurrentFrame} + interpolate) for a moving camera.
 */
export function Camera(props: CameraProps) {
  const { children, focusX, focusY, zoom = 1, rotate = 0, viewportWidth, viewportHeight } = props
  const { width, height } = useVideoConfig()
  const vw = viewportWidth ?? width
  const vh = viewportHeight ?? height
  const fx = focusX ?? vw / 2
  const fy = focusY ?? vh / 2
  return createElement(
    Group,
    { x: vw / 2, y: vh / 2 },
    createElement(
      Group,
      { rotation: rotate, scaleX: zoom, scaleY: zoom, originX: 0, originY: 0 },
      createElement(Group, { x: -fx, y: -fy }, children),
    ),
  )
}

export interface Scene3DProps extends Omit<NodeProps, 'children'> {
  /** The perspective camera for this 3D world. Omit fields to derive a default that
   *  frames the `z = 0` plane to fill the comp (so layers at `z = 0` match their 2D
   *  placement). Animate `position`/`target` per frame for camera moves. */
  camera?: Camera3D
  /** The 3D LAYERS — direct children, each placed by its `position3d` / `rotation3d`
   *  / `anchor3d`. Layers without a `position3d` sit at `z = 0` (their 2D spot). */
  children?: ReactNode
}

/**
 * A 3D SCENE: its direct children become 3D LAYERS in one shared 3D world, viewed
 * through a perspective `camera`. Each layer is a flat plane (its rendered 2D
 * content) placed by `position3d` (world x/y/z) and tilted by `rotation3d`, then
 * depth-sorted and composited as a single layer. The mograph core of "3D" —
 * camera fly-throughs, card walls, parallax, exploded UI, billboard text.
 *
 * GPU (Vello) runs true perspective; the CPU reference degrades to a 2.5D
 * depth-sorted composite (per-layer distance scale, no out-of-plane tilt). A layer
 * at `z = 0` with no rotation renders pixel-identical to its 2D placement, so
 * wrapping content in `<Scene3D>` changes nothing until you move layers in z.
 */
export function Scene3D(props: Scene3DProps) {
  const { camera, children, ...rest } = props
  return createElement('onda-group', { ...rest, camera3d: camera ?? {} }, children)
}

export interface RectProps extends NodeProps, PaintProps {
  width: number
  height: number
  cornerRadius?: number
}

export function Rect(props: RectProps) {
  return createElement('onda-rect', props)
}

export interface EllipseProps extends NodeProps, PaintProps {
  width: number
  height: number
}

export function Ellipse(props: EllipseProps) {
  return createElement('onda-ellipse', props)
}

export interface PathProps extends NodeProps, PaintProps {
  /** SVG path data (e.g. `"M0 0 L100 0 Z"`), in the node's local space. */
  d: string
}

/** An arbitrary vector outline from SVG path data. Renders on the GPU (Vello)
 *  backend; the CPU reference rasterizer skips paths. */
export function Path(props: PathProps) {
  return createElement('onda-path', props)
}

/** One styled run for rich `<Text>` — overrides the node's style. */
export interface TextRunInput {
  text: string
  color?: ColorInput
  fontSize?: number
  /** Font family (must be loaded; bundled: "Open Sans", "IBM Plex Sans"). */
  fontFamily?: string
  /** CSS weight 1..1000 (700 = bold). */
  fontWeight?: number
  italic?: boolean
}

export interface TextProps extends NodeProps {
  fontSize?: number
  color?: ColorInput
  /** Font family (must be loaded; bundled: "Open Sans", "IBM Plex Sans"). */
  fontFamily?: string
  /** CSS weight 1..1000 (700 = bold). */
  fontWeight?: number
  italic?: boolean
  /** Extra px between glyphs (CSS `letter-spacing` / tracking). `0` = natural;
   *  negative tightens. Applied on the GPU/preview (Vello) text path. */
  letterSpacing?: number
  /** Rich multi-style runs. When set, these replace the text children — each run
   *  may override color/size/family/weight/style. Renders per-run on the GPU
   *  (Vello); the CPU backend draws their concatenated text in the node style. */
  runs?: TextRunInput[]
  children?: ReactNode
}

export function Text(props: TextProps) {
  return createElement('onda-text', props)
}

export interface ImageProps extends NodeProps {
  src: string
  /** Target box width in px. With `height`, the decoded image is fitted into this
   *  box per `fit` — the renderer measures the image, so the component doesn't
   *  need its intrinsic size. Omit both for the image's intrinsic pixel size. */
  width?: number
  height?: number
  /** How to fit the image into the `width`×`height` box (default `'cover'`). */
  fit?: ImageFit
  /** Gaussian blur radius (sigma, in source pixels) applied to the decoded image
   *  by the engine's image pass. `0`/omitted leaves it sharp; animating it gives
   *  a soft→sharp "focus pull" entrance. Identical on every backend. */
  blur?: number
}

export function Image(props: ImageProps) {
  return createElement('onda-image', props)
}

export interface VideoProps extends NodeProps {
  /** Path, URL, or `data:` URI of the video. The frame at the current time is
   *  decoded by the player (browser: an off-screen `<video>`/WebCodecs) or by
   *  `onda export` (native ffmpeg) — the author layer never decodes. */
  src: string
  /** Seconds into the SOURCE shown at this clip's frame 0 (trim the head).
   *  Default `0`. */
  startFrom?: number
  /** Source seconds advanced per composition second (1 = realtime, 2 = 2× fast,
   *  0.5 = slow-mo). Default `1`. */
  playbackRate?: number
  /** Seconds into the SOURCE to stop at (trim the tail). Past it the clip holds
   *  its last frame, unless `loop` is set. Omit to play to the source's end. */
  endAt?: number
  /** Loop the trimmed span `[startFrom, endAt)` (requires `endAt`). The source
   *  time wraps so the clip repeats for as long as the `<Sequence>` shows it. */
  loop?: boolean
  /** Target box width in px. With `height`, the frame is fitted into this box
   *  per `fit`. Omit both for the video's intrinsic pixel size. */
  width?: number
  height?: number
  /** How to fit the frame into the `width`×`height` box (default `'cover'`). */
  fit?: ImageFit
  /**
   * Preview-only behaviour when the browser can't composite this source — i.e. a
   * cross-origin video without CORS headers. **Never affects `onda export`**,
   * which always composites via ffmpeg.
   *  - `'skip'` (default): leave it blank in preview + log a one-time hint.
   *  - `'element'`: overlay a plain `<video>` so it still *plays* in preview
   *    (display-only — no engine effects, and it sits above the canvas). Useful
   *    for prototyping with a third-party URL you can't add CORS to. For your own
   *    assets, serving them same-origin or with CORS is better (full compositing).
   */
  previewFallback?: 'skip' | 'element'
}

/** A video clip. At composition frame *f* it shows the source frame at
 *  `startFrom + (f / fps) * playbackRate` seconds; the player/engine decodes that
 *  exact frame (browser: `<video>`/WebCodecs; native export: ffmpeg) and the
 *  renderer draws it like an image. Place/scale it like any node; combine with a
 *  `<Sequence>` to position it on the timeline. */
export function Video({ startFrom = 0, playbackRate = 1, endAt, loop, ...rest }: VideoProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  // Resolve the source time IN THE AUTHOR LAYER (the engine just gets a number):
  // advance from the trim-head at playbackRate, then trim-tail / loop the span.
  let time = startFrom + (frame / Math.max(1, fps)) * playbackRate
  if (endAt != null && endAt > startFrom) {
    const span = endAt - startFrom
    time = loop
      ? startFrom + ((((time - startFrom) % span) + span) % span) // wrap to repeat
      : Math.min(time, endAt) // hold the last frame past the tail
  }
  return createElement('onda-video', { ...rest, time: Math.max(0, time) })
}

export interface AudioProps {
  /** Path, URL, or `data:` URI of the audio. */
  src: string
  /** Composition time (seconds) at which the clip begins playing. Default 0. */
  start?: number
  /** Seconds into the source to begin from (trim the head). Default 0. */
  startAt?: number
  /** Linear gain, 0..1. Default 1. */
  volume?: number
}

/** A non-visual audio clip on the timeline. It draws nothing — the player plays
 *  it during preview (and export muxes it). Place it anywhere in the tree; `start`
 *  sets when it begins (seconds), `startAt` trims into the source, `volume`
 *  scales its gain. The higher-level `<AudioClip>` (`@onda/components`) wraps this
 *  with a fade envelope. */
export function Audio(props: AudioProps) {
  return createElement('onda-audio', props)
}

export interface SvgProps extends NodeProps {
  /** A file path/URL to the SVG (resolved at render time by `onda render`). */
  src?: string
  /** Inline SVG markup (self-contained; preferred when present). */
  markup?: string
}

/** An SVG document, expanded into vector nodes by the engine (`onda-svg`).
 *  Use `x`/`y`/`scaleX`/`scaleY` to place and size it. Renders on the GPU
 *  (Vello) backend. */
export function Svg(props: SvgProps) {
  return createElement('onda-svg', props)
}
