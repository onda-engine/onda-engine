//! Render a React element tree into an ONDA scene graph.

import type { ReactElement } from 'react'
import Reconciler from 'react-reconciler'
import { parseColor } from './color.js'
import { type HostNode, type RootContainer, hostConfig } from './host-config.js'
import type { Scene, SceneNode, ShapeGeometry, Stroke, Transform } from './scene.js'

const reconciler = Reconciler(hostConfig)

/** Render `element` (whose root must be a `<Composition>`) to a {@link Scene}. */
export function renderToScene(element: ReactElement): Scene {
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
  reconciler.updateContainer(element, root, null, null)

  const top = container.children[0]
  if (container.children.length !== 1 || !top || top.type !== 'onda-composition') {
    throw new Error('renderToScene: the root element must be a single <Composition>')
  }
  return compositionToScene(top)
}

/** Render to a JSON string (ready for `onda render`/`onda export`). */
export function renderToSceneJSON(element: ReactElement, space = 2): string {
  return JSON.stringify(renderToScene(element), null, space)
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

    case 'onda-text':
      return {
        ...base,
        kind: {
          type: 'text',
          content: node.text ?? '',
          ...(typeof props.fontSize === 'number' ? { font_size: props.fontSize } : {}),
          ...(props.color !== undefined ? { color: parseColor(props.color as never) } : {}),
        },
        ...withChildren,
      }

    case 'onda-image':
      return {
        ...base,
        kind: { type: 'image', src: stringProp(props, 'src', 'Image') },
        ...withChildren,
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
  return transform.translate || transform.scale ? transform : undefined
}

function fillStroke(props: Record<string, unknown>): {
  fill?: ReturnType<typeof parseColor>
  stroke?: Stroke
} {
  const out: { fill?: ReturnType<typeof parseColor>; stroke?: Stroke } = {}
  if (props.fill !== undefined) out.fill = parseColor(props.fill as never)
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
