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
import type { GradientInput } from './gradient.js'

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

export interface TextProps extends NodeProps {
  fontSize?: number
  color?: ColorInput
  children?: ReactNode
}

export function Text(props: TextProps) {
  return createElement('onda-text', props)
}

export interface ImageProps extends NodeProps {
  src: string
}

export function Image(props: ImageProps) {
  return createElement('onda-image', props)
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
