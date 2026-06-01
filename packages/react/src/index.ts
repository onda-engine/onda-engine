//! `@onda/react` — write React, get an ONDA scene graph.

export { parseColor, type ColorInput } from './color.js'
export {
  Composition,
  type CompositionProps,
  Ellipse,
  type EllipseProps,
  Group,
  type GroupProps,
  Image,
  type ImageProps,
  Rect,
  type RectProps,
  Text,
  type TextProps,
  type NodeProps,
} from './components.js'
export { renderToScene, renderToSceneJSON } from './reconciler.js'
export type {
  Color,
  Composition as CompositionData,
  NodeKind,
  Scene,
  SceneNode,
  ShapeGeometry,
  Size,
  Stroke,
  Transform,
  Vec2,
} from './scene.js'
