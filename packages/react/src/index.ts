//! `@onda/react` — write React, get an ONDA scene graph.

export { parseColor, type ColorInput } from './color.js'
export {
  type ClipInput,
  clipEllipse,
  clipPath,
  clipRect,
  parseClip,
} from './clip.js'
export {
  type GradientInput,
  type GradientStopInput,
  type Point,
  linearGradient,
  parseGradient,
  radialGradient,
} from './gradient.js'
export {
  AbsoluteFill,
  type AbsoluteFillProps,
  Composition,
  type CompositionProps,
  Ellipse,
  type EllipseProps,
  Flex,
  type FlexProps,
  Group,
  type GroupProps,
  Image,
  type ImageProps,
  Path,
  type PathProps,
  type PaintProps,
  Rect,
  type RectProps,
  Svg,
  type SvgProps,
  Text,
  type TextProps,
  type TextRunInput,
  type NodeProps,
} from './components.js'
export {
  Easing,
  type EasingFn,
  type InterpolateOptions,
  cubicBezier,
  interpolate,
} from './interpolate.js'
export { type VideoConfig, useCurrentFrame, useVideoConfig } from './frame.js'
export { type SpringConfig, type SpringOptions, spring } from './spring.js'
export {
  Loop,
  type LoopProps,
  Sequence,
  type SequenceProps,
  Series,
  type SeriesSequenceProps,
} from './sequence.js'
export { noise2D, noise3D, random } from './random.js'
export {
  type PresentationState,
  type SlideDirection,
  TransitionSeries,
  type TransitionSeriesSequenceProps,
  type TransitionSeriesTransitionProps,
  type TransitionPresentation,
  type TransitionTiming,
  fade,
  linearTiming,
  slide,
  springTiming,
  wipe,
} from './transitions.js'
export {
  renderFrame,
  renderFrames,
  renderFramesJSON,
  renderToScene,
  renderToSceneJSON,
} from './reconciler.js'
export type {
  Color,
  Composition as CompositionData,
  Gradient,
  GradientStop,
  Layout,
  NodeKind,
  Scene,
  SceneNode,
  SceneTextRun,
  ShapeGeometry,
  Size,
  Stroke,
  Transform,
  Vec2,
} from './scene.js'
