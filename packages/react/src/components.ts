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
import type { ColorInput } from './color.js'

/** Properties shared by every scene node: identity, placement, opacity. */
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
  children?: ReactNode
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

export interface RectProps extends NodeProps {
  width: number
  height: number
  cornerRadius?: number
  fill?: ColorInput
  stroke?: ColorInput
  strokeWidth?: number
}

export function Rect(props: RectProps) {
  return createElement('onda-rect', props)
}

export interface EllipseProps extends NodeProps {
  width: number
  height: number
  fill?: ColorInput
  stroke?: ColorInput
  strokeWidth?: number
}

export function Ellipse(props: EllipseProps) {
  return createElement('onda-ellipse', props)
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
