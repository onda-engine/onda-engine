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
import type { ImageFit, Layout } from './scene.js'

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
  /** Clip this node and its subtree to a region (local space). */
  clip?: ClipInput
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
