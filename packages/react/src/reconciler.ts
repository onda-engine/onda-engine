//! Render a React element tree into an ONDA scene graph.

import { type ReactElement, createElement } from 'react'
import Reconciler from 'react-reconciler'
import { type ClipInput, parseClip } from './clip.js'
import { parseColor } from './color.js'
import { Composition, type TextRunInput } from './components.js'
import { FrameContext, type VideoConfig } from './frame.js'
import { type GradientInput, parseGradient } from './gradient.js'
import { type HostNode, type RootContainer, hostConfig } from './host-config.js'
import type {
  Gradient,
  Layout,
  NodeKind,
  Scene,
  SceneNode,
  ShapeGeometry,
  Stroke,
  Transform,
} from './scene.js'

const reconciler = Reconciler(hostConfig)

/** Render `element` (root must be `<Composition>`) at `frame` to a static
 *  {@link Scene}. Components read the frame via {@link useCurrentFrame}. */
export function renderFrame(element: ReactElement, frame: number): Scene {
  const config = videoConfig(element)
  const container: RootContainer = { children: [] }
  const root = reconciler.createContainer(
    container,
    0, // LegacyRoot — renders synchronously
    null,
    false,
    null,
    '',
    (error) => {
      throw error
    },
    null,
  )
  reconciler.updateContainer(
    createElement(FrameContext.Provider, { value: { ...config, frame } }, element),
    root,
    null,
    null,
  )

  const top = container.children[0]
  if (container.children.length !== 1 || !top || top.type !== 'onda-composition') {
    throw new Error('render: the root element must be a single <Composition>')
  }
  const scene = compositionToScene(top)
  reconciler.updateContainer(null, root, null, null) // unmount, running effect cleanups
  return scene
}

/** Render the composition once, at frame 0. */
export function renderToScene(element: ReactElement): Scene {
  return renderFrame(element, 0)
}

/** Render every frame `0..durationInFrames` to static scenes. */
export function renderFrames(element: ReactElement): Scene[] {
  const { durationInFrames } = videoConfig(element)
  const frames: Scene[] = []
  for (let frame = 0; frame < durationInFrames; frame++) {
    frames.push(renderFrame(element, frame))
  }
  return frames
}

/** Render frame 0 to a JSON string (for `onda render`). */
export function renderToSceneJSON(element: ReactElement, space = 2): string {
  return JSON.stringify(renderToScene(element), null, space)
}

/** Render all frames to a JSON array of scenes (for `onda export-frames`). */
export function renderFramesJSON(element: ReactElement, space = 0): string {
  return JSON.stringify(renderFrames(element), null, space)
}

function videoConfig(element: ReactElement): VideoConfig {
  if (element.type !== Composition) {
    throw new Error('render: the root element must be a <Composition>')
  }
  const props = element.props as Record<string, unknown>
  return {
    width: numberProp(props, 'width', 'Composition'),
    height: numberProp(props, 'height', 'Composition'),
    fps: numberProp(props, 'fps', 'Composition'),
    durationInFrames: numberProp(props, 'durationInFrames', 'Composition'),
  }
}

function compositionToScene(node: HostNode): Scene {
  const { props } = node
  return {
    composition: {
      width: numberProp(props, 'width', 'Composition'),
      height: numberProp(props, 'height', 'Composition'),
      fps: numberProp(props, 'fps', 'Composition'),
      duration_in_frames: numberProp(props, 'durationInFrames', 'Composition'),
    },
    root: {
      kind: { type: 'group' },
      ...(node.children.length ? { children: node.children.map(toNode) } : {}),
    },
  }
}

function toNode(node: HostNode): SceneNode {
  const { props } = node
  const base: Omit<SceneNode, 'kind'> = {}
  if (typeof props.id === 'number') base.id = props.id
  const transform = transformOf(props)
  if (transform) base.transform = transform
  if (typeof props.opacity === 'number') base.opacity = props.opacity
  if (props.clip !== undefined) base.clip = parseClip(props.clip as ClipInput)
  if (props.layout !== undefined) base.layout = parseLayout(props.layout as Layout)
  const children = node.children.map(toNode)
  const withChildren = children.length ? { children } : {}

  switch (node.type) {
    case 'onda-group':
      return { ...base, kind: { type: 'group' }, ...withChildren }

    case 'onda-rect': {
      const geometry: ShapeGeometry = {
        shape: 'rect',
        size: {
          width: numberProp(props, 'width', 'Rect'),
          height: numberProp(props, 'height', 'Rect'),
        },
        ...(typeof props.cornerRadius === 'number' ? { corner_radius: props.cornerRadius } : {}),
      }
      return { ...base, kind: { type: 'shape', geometry, ...fillStroke(props) }, ...withChildren }
    }

    case 'onda-ellipse': {
      const geometry: ShapeGeometry = {
        shape: 'ellipse',
        size: {
          width: numberProp(props, 'width', 'Ellipse'),
          height: numberProp(props, 'height', 'Ellipse'),
        },
      }
      return { ...base, kind: { type: 'shape', geometry, ...fillStroke(props) }, ...withChildren }
    }

    case 'onda-path': {
      const geometry: ShapeGeometry = { shape: 'path', data: stringProp(props, 'd', 'Path') }
      return { ...base, kind: { type: 'shape', geometry, ...fillStroke(props) }, ...withChildren }
    }

    case 'onda-text': {
      const kind: Extract<NodeKind, { type: 'text' }> = {
        type: 'text',
        content: node.text ?? '',
        ...(typeof props.fontSize === 'number' ? { font_size: props.fontSize } : {}),
        ...(props.color !== undefined ? { color: parseColor(props.color as never) } : {}),
        ...(typeof props.fontFamily === 'string' ? { font_family: props.fontFamily } : {}),
        ...(typeof props.fontWeight === 'number' ? { weight: props.fontWeight } : {}),
        ...(props.italic === true ? { italic: true } : {}),
      }
      if (Array.isArray(props.runs)) {
        kind.runs = (props.runs as TextRunInput[]).map((r) => ({
          text: r.text,
          ...(r.color !== undefined ? { color: parseColor(r.color) } : {}),
          ...(typeof r.fontSize === 'number' ? { font_size: r.fontSize } : {}),
          ...(typeof r.fontFamily === 'string' ? { font_family: r.fontFamily } : {}),
          ...(typeof r.fontWeight === 'number' ? { weight: r.fontWeight } : {}),
          ...(r.italic === true ? { italic: true } : {}),
        }))
      }
      return { ...base, kind, ...withChildren }
    }

    case 'onda-image':
      return {
        ...base,
        kind: { type: 'image', src: stringProp(props, 'src', 'Image') },
        ...withChildren,
      }

    case 'onda-svg': {
      if (typeof props.src !== 'string' && typeof props.markup !== 'string') {
        throw new Error("<Svg> requires a 'src' or 'markup' prop")
      }
      return {
        ...base,
        kind: {
          type: 'svg',
          ...(typeof props.src === 'string' ? { src: props.src } : {}),
          ...(typeof props.markup === 'string' ? { markup: props.markup } : {}),
        },
        ...withChildren,
      }
    }

    default:
      throw new Error(`renderToScene: unsupported element <${node.type}>`)
  }
}

function transformOf(props: Record<string, unknown>): Transform | undefined {
  const transform: Transform = {}
  if (typeof props.x === 'number' || typeof props.y === 'number') {
    transform.translate = { x: (props.x as number) ?? 0, y: (props.y as number) ?? 0 }
  }
  if (typeof props.scaleX === 'number' || typeof props.scaleY === 'number') {
    transform.scale = { x: (props.scaleX as number) ?? 1, y: (props.scaleY as number) ?? 1 }
  }
  if (typeof props.rotation === 'number') {
    transform.rotate = props.rotation
  }
  return transform.translate || transform.scale || transform.rotate !== undefined
    ? transform
    : undefined
}

// Tolerate CSS flexbox spellings on justify/align. The engine's layout enum is
// `start | center | end` (+ `space-*` for justify), but components ported from
// the browser — and agent payloads written against CSS — use `flex-start` /
// `flex-end` / edge words. Normalize here, at the single layout→scene boundary,
// so every node is forgiving rather than failing scene-graph deserialization.
const ALIGN_ALIASES: Record<string, string> = {
  'flex-start': 'start',
  'flex-end': 'end',
  left: 'start',
  top: 'start',
  right: 'end',
  bottom: 'end',
  middle: 'center',
  'space-evenly': 'space-around',
}
const normAlign = (v: unknown): unknown =>
  typeof v === 'string' && v in ALIGN_ALIASES ? ALIGN_ALIASES[v] : v

/** Copy the defined layout fields (names/values already match the scene JSON). */
function parseLayout(layout: Layout): Layout {
  const out: Layout = {}
  if (layout.direction !== undefined) out.direction = layout.direction
  if (layout.justify !== undefined) out.justify = normAlign(layout.justify) as Layout['justify']
  if (layout.align !== undefined) out.align = normAlign(layout.align) as Layout['align']
  if (typeof layout.gap === 'number') out.gap = layout.gap
  if (typeof layout.padding === 'number') out.padding = layout.padding
  if (layout.wrap === true) out.wrap = true
  if (typeof layout.width === 'number') out.width = layout.width
  if (typeof layout.height === 'number') out.height = layout.height
  return out
}

function fillStroke(props: Record<string, unknown>): {
  fill?: ReturnType<typeof parseColor>
  gradient?: Gradient
  stroke?: Stroke
} {
  const out: { fill?: ReturnType<typeof parseColor>; gradient?: Gradient; stroke?: Stroke } = {}
  if (props.fill !== undefined) out.fill = parseColor(props.fill as never)
  if (props.gradient !== undefined) out.gradient = parseGradient(props.gradient as GradientInput)
  if (props.stroke !== undefined) {
    out.stroke = {
      color: parseColor(props.stroke as never),
      width: typeof props.strokeWidth === 'number' ? props.strokeWidth : 1,
    }
  }
  return out
}

function numberProp(props: Record<string, unknown>, key: string, ctx: string): number {
  const value = props[key]
  if (typeof value !== 'number') throw new Error(`<${ctx}> requires a numeric '${key}' prop`)
  return value
}

function stringProp(props: Record<string, unknown>, key: string, ctx: string): string {
  const value = props[key]
  if (typeof value !== 'string') throw new Error(`<${ctx}> requires a string '${key}' prop`)
  return value
}
