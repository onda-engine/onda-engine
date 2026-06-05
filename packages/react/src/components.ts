//! The ONDA React components. Each is a thin typed wrapper that emits an
//! internal host element; the reconciler maps those to scene-graph nodes.
//!
//! ```tsx
//! <Composition width={1200} height={360} fps={30} durationInFrames={30}>
//!   <Rect width={1200} height={360} fill="#0a0d17" />
//!   <Text fontSize={96} color="#fff" x={96} y={110}>Hello ONDA</Text>
//! </Composition>
//! ```

import { type ReactNode, createElement } from 'react'
import type { ClipInput } from './clip.js'
import type { ColorInput } from './color.js'
import { useCurrentFrame, useVideoConfig } from './frame.js'
import type { GradientInput } from './gradient.js'
import type { BlendMode, Effect, ImageFit, Layout } from './scene.js'

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
  /** Blend this node's subtree against the backdrop (CSS mix-blend-mode).
   *  GPU/Vello-rendered (e.g. `'screen'`, `'multiply'`, `'overlay'`). */
  blendMode?: BlendMode
  /** Clip this node and its subtree to a region (local space). */
  clip?: ClipInput
  /** Ordered, low-level screen-space effects on this node + subtree (render-to-texture). */
  effects?: Effect[]
  /** Gaussian blur std-dev in output px; sugar for `effects: [{ effect: 'blur', sigma }]`.
   *  Honored by Vello AND the CPU reference once Phase 1 lands. */
  blur?: number
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
