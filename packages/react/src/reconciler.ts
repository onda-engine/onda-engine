//! Render a React element tree into an ONDA scene graph.

import { type ReactElement, createElement } from 'react'
import Reconciler from 'react-reconciler'
import { type ClipInput, parseClip } from './clip.js'
import { type ColorInput, parseColor } from './color.js'
import { Composition, type TextRunInput } from './components.js'
import { FrameContext, type VideoConfig } from './frame.js'
import { type GradientInput, parseGradient } from './gradient.js'
import { type HostNode, type RootContainer, hostConfig } from './host-config.js'
import type {
  Color,
  Effect,
  Gradient,
  Layout,
  NodeKind,
  Scene,
  SceneNode,
  Shadow,
  ShapeGeometry,
  Stroke,
  Transform,
} from './scene.js'

const reconciler = Reconciler(hostConfig)

/** The frame context active during the current {@link renderFrame} pass
 *  (`{ ...VideoConfig, frame }`). Captured here so {@link elementToNode} can
 *  reconcile a `matte` prop-element under the SAME frame context as the main
 *  tree — its hooks (`useCurrentFrame`/`useVideoConfig`) read the live frame, so
 *  the matte animates per-frame just like the content. `null` outside a render. */
let activeFrameState: (VideoConfig & { frame: number }) | null = null

/** Render `element` (root must be `<Composition>`) at `frame` to a static
 *  {@link Scene}. Components read the frame via {@link useCurrentFrame}. */
export function renderFrame(element: ReactElement, frame: number): Scene {
  const config = videoConfig(element)
  const frameState = { ...config, frame }
  const prevFrameState = activeFrameState
  activeFrameState = frameState
  try {
    const container: RootContainer = { children: [] }
    const root = reconciler.createContainer(
      container,
      0, // LegacyRoot — renders synchronously
      null, // hydrationCallbacks
      false, // isStrictMode
      null, // concurrentUpdatesByDefaultOverride
      '', // identifierPrefix
      (error: Error) => {
        throw error // onUncaughtError
      },
      (error: Error) => {
        throw error // onCaughtError
      },
      () => {}, // onRecoverableError — non-fatal (e.g. hydration); ignore
      () => {}, // onDefaultTransitionIndicator — no transitions in a static render
    )
    // React 19's reconciler no longer flushes the initial mount synchronously via
    // `updateContainer`; use the explicit sync API so ONDA can read the built tree
    // immediately after.
    reconciler.updateContainerSync(
      createElement(FrameContext.Provider, { value: frameState }, element),
      root,
      null,
      null,
    )
    reconciler.flushSyncWork()

    const top = container.children[0]
    if (container.children.length !== 1 || !top || top.type !== 'onda-composition') {
      throw new Error('render: the root element must be a single <Composition>')
    }
    const scene = compositionToScene(top)
    // Unmount (runs effect cleanups), synchronously.
    reconciler.updateContainerSync(null, root, null, null)
    reconciler.flushSyncWork()
    return scene
  } finally {
    activeFrameState = prevFrameState
  }
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

/** Render a sub-range `[startFrame, endFrame)` to static scenes.
 *  The returned array starts at index 0; the scenes carry the original frame
 *  numbers so `useCurrentFrame()` reads the correct composition time. */
export function renderFramesRange(
  element: ReactElement,
  startFrame: number,
  endFrame: number,
): Scene[] {
  const frames: Scene[] = []
  for (let frame = startFrame; frame < endFrame; frame++) {
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

/** Render a sub-range `[startFrame, endFrame)` to a JSON array (for `onda export-frames`).
 *  Produces a short clip covering only those frames — useful for fast scene-level iteration. */
export function renderFrameRangeJSON(
  element: ReactElement,
  startFrame: number,
  endFrame: number,
  space = 0,
): string {
  return JSON.stringify(renderFramesRange(element, startFrame, endFrame), null, space)
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
      // Opt-in cinematic LINEAR + ACES finishing (gpu/export only); omitted (→ gamma)
      // unless explicitly enabled, so existing scenes stay byte-identical.
      ...(props.linear === true ? { linear: true } : {}),
    },
    root: {
      kind: { type: 'group' },
      ...(node.children.length ? { children: node.children.map(toNode) } : {}),
    },
  }
}

/** Reconcile a SINGLE prop-element (e.g. a `matte` subtree) into one
 *  {@link SceneNode}. Mirrors {@link renderFrame}'s machinery — create a fresh
 *  container, render the element, flush synchronously, take the single root host
 *  child, and {@link toNode} it — but for one element rather than a whole tree.
 *
 *  The element is wrapped in the SAME {@link FrameContext} as the main tree (the
 *  module-level {@link activeFrameState}, set by the enclosing `renderFrame`), so
 *  its hooks (`useCurrentFrame`/`useVideoConfig`) read the live frame and the
 *  matte ANIMATES per-frame — `renderFrames` re-runs this for every frame. The
 *  prop-element must resolve to exactly one root host node (e.g. a single
 *  `<Text>`/`<Rect>`/`<Group>`); wrap multiple nodes in a `<Group>`. */
function elementToNode(element: ReactElement): SceneNode {
  const container: RootContainer = { children: [] }
  const root = reconciler.createContainer(
    container,
    0, // LegacyRoot — renders synchronously
    null,
    false,
    null,
    '',
    (error: Error) => {
      throw error
    },
    (error: Error) => {
      throw error
    },
    () => {},
    () => {},
  )
  // Reconcile under the active frame context so the matte animates per-frame.
  const wrapped = activeFrameState
    ? createElement(FrameContext.Provider, { value: activeFrameState }, element)
    : element
  reconciler.updateContainerSync(wrapped, root, null, null)
  reconciler.flushSyncWork()
  const top = container.children[0]
  if (container.children.length !== 1 || !top) {
    throw new Error(
      'matte: the matte element must resolve to a single node (wrap many in a <Group>)',
    )
  }
  const node = toNode(top)
  reconciler.updateContainerSync(null, root, null, null)
  reconciler.flushSyncWork()
  return node
}

function toNode(node: HostNode): SceneNode {
  const { props } = node
  const base: Omit<SceneNode, 'kind'> = {}
  if (typeof props.id === 'number') base.id = props.id
  const transform = transformOf(props)
  if (transform) base.transform = transform
  if (typeof props.opacity === 'number') base.opacity = props.opacity
  if (props.clip !== undefined) base.clip = parseClip(props.clip as ClipInput)
  if (props.matte !== undefined) {
    base.matte = {
      mode: props.matteMode === 'luminance' ? 'luminance' : 'alpha',
      source: elementToNode(props.matte as ReactElement),
    }
  }
  if (typeof props.blendMode === 'string') base.blend = props.blendMode as SceneNode['blend']
  const effects: Effect[] = Array.isArray(props.effects) ? [...(props.effects as Effect[])] : []
  if (typeof props.blur === 'number' && props.blur > 0)
    effects.unshift({ effect: 'blur', sigma: props.blur })
  const bloom = parseBloom(props.bloom)
  if (bloom) effects.push(bloom)
  const grade = parseGrade(props.grade)
  if (grade) effects.push(grade)
  const goo = parseGoo(props.goo)
  if (goo) effects.push(goo)
  const grain = parseGrain(props.grain)
  if (grain) effects.push(grain)
  const backdropBlur = parseBackdropBlur(props.backdropBlur)
  if (backdropBlur) effects.push(backdropBlur)
  const lightWrap = parseLightWrap(props.lightWrap)
  if (lightWrap) effects.push(lightWrap)
  if (effects.length) base.effects = effects
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
        ...(typeof props.letterSpacing === 'number' ? { letter_spacing: props.letterSpacing } : {}),
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
        kind: {
          type: 'image',
          src: stringProp(props, 'src', 'Image'),
          ...(typeof props.width === 'number' ? { width: props.width } : {}),
          ...(typeof props.height === 'number' ? { height: props.height } : {}),
          ...(props.fit === 'fill' || props.fit === 'cover' || props.fit === 'contain'
            ? { fit: props.fit }
            : {}),
          ...(typeof props.blur === 'number' && props.blur > 0 ? { blur: props.blur } : {}),
        },
        ...withChildren,
      }

    case 'onda-video':
      return {
        ...base,
        kind: {
          type: 'video',
          src: stringProp(props, 'src', 'Video'),
          ...(typeof props.time === 'number' ? { time: props.time } : {}),
          ...(typeof props.width === 'number' ? { width: props.width } : {}),
          ...(typeof props.height === 'number' ? { height: props.height } : {}),
          ...(props.fit === 'fill' || props.fit === 'cover' || props.fit === 'contain'
            ? { fit: props.fit }
            : {}),
          ...(props.previewFallback === 'element' || props.previewFallback === 'skip'
            ? { previewFallback: props.previewFallback }
            : {}),
        },
        ...withChildren,
      }

    case 'onda-audio':
      return {
        ...base,
        kind: {
          type: 'audio',
          src: stringProp(props, 'src', 'Audio'),
          ...(typeof props.start === 'number' ? { start: props.start } : {}),
          ...(typeof props.startAt === 'number' ? { start_at: props.startAt } : {}),
          ...(typeof props.volume === 'number' ? { volume: props.volume } : {}),
        },
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

    case '#text':
      throw new Error(
        `renderToScene: raw text "${String(node.text ?? '').slice(0, 60)}" ` +
          `was placed inside a non-Text node. ` +
          `String children are only valid inside <Text>. ` +
          `Wrap it: h(Text, { x, y, fontSize, color }, '${String(node.text ?? '').slice(0, 30)}')`,
      )

    default:
      throw new Error(
        `renderToScene: unsupported element type "${node.type}". ` +
          `Only ONDA primitives (Group/Rect/Ellipse/Path/Text/Image/Video/Svg) are valid. ` +
          `DOM elements like <div>/<span> and custom types are not rendered — ` +
          `use @onda/react primitives only.`,
      )
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
  if (typeof props.originX === 'number' || typeof props.originY === 'number') {
    transform.origin = { x: (props.originX as number) ?? 0, y: (props.originY as number) ?? 0 }
  }
  return transform.translate ||
    transform.scale ||
    transform.rotate !== undefined ||
    transform.origin
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
/** Resolve the `bloom` sugar prop into a `{ effect: 'bloom', ... }` effect, or
 *  `undefined` when absent/degenerate. A bare number is the `sigma`; the object
 *  form overrides `threshold` (default 0.7) / `intensity` (default 1). */
function parseBloom(input: unknown): Extract<Effect, { effect: 'bloom' }> | undefined {
  if (typeof input === 'number') {
    return input > 0 ? { effect: 'bloom', threshold: 0.7, intensity: 1, sigma: input } : undefined
  }
  if (input && typeof input === 'object') {
    const b = input as { sigma?: number; threshold?: number; intensity?: number }
    if (typeof b.sigma === 'number' && b.sigma > 0) {
      return {
        effect: 'bloom',
        threshold: typeof b.threshold === 'number' ? b.threshold : 0.7,
        intensity: typeof b.intensity === 'number' ? b.intensity : 1,
        sigma: b.sigma,
      }
    }
  }
  return undefined
}

/** Resolve the `grade` sugar prop into a `{ effect: 'color_grade', ... }` effect,
 *  or `undefined` when absent or a neutral identity (which would be a render
 *  no-op). Each field defaults to the neutral identity (exposure 0, contrast 1,
 *  saturation 1, temperature 0, tint 0). */
function parseGrade(input: unknown): Extract<Effect, { effect: 'color_grade' }> | undefined {
  if (!input || typeof input !== 'object') return undefined
  const g = input as {
    exposure?: number
    contrast?: number
    saturation?: number
    temperature?: number
    tint?: number
  }
  const exposure = typeof g.exposure === 'number' ? g.exposure : 0
  const contrast = typeof g.contrast === 'number' ? g.contrast : 1
  const saturation = typeof g.saturation === 'number' ? g.saturation : 1
  const temperature = typeof g.temperature === 'number' ? g.temperature : 0
  const tint = typeof g.tint === 'number' ? g.tint : 0
  // The neutral identity is a no-op — omit it so a plain `grade={{}}` stays a
  // zero-diff (matching the engine's neutral fast path).
  if (exposure === 0 && contrast === 1 && saturation === 1 && temperature === 0 && tint === 0) {
    return undefined
  }
  return { effect: 'color_grade', exposure, contrast, saturation, temperature, tint }
}

/** Resolve the `goo` sugar prop into a `{ effect: 'goo', ... }` effect, or
 *  `undefined` when absent/degenerate. A bare number is the `sigma`; the object
 *  form overrides `threshold` (default 0.5). A non-positive `sigma` is dropped
 *  (no blur → nothing to fuse). */
function parseGoo(input: unknown): Extract<Effect, { effect: 'goo' }> | undefined {
  if (typeof input === 'number') {
    return input > 0 ? { effect: 'goo', sigma: input, threshold: 0.5 } : undefined
  }
  if (input && typeof input === 'object') {
    const g = input as { sigma?: number; threshold?: number }
    if (typeof g.sigma === 'number' && g.sigma > 0) {
      return {
        effect: 'goo',
        sigma: g.sigma,
        threshold: typeof g.threshold === 'number' ? g.threshold : 0.5,
      }
    }
  }
  return undefined
}

/** Resolve the `grain` sugar prop into a `{ effect: 'grain', ... }` effect, or
 *  `undefined` when absent/degenerate. A bare number is the `intensity`; the object
 *  form adds `size` (grain scale in px, default 1) and `seed` (animation offset,
 *  default 0). A non-positive `intensity` is dropped (no grain to add). */
function parseGrain(input: unknown): Extract<Effect, { effect: 'grain' }> | undefined {
  if (typeof input === 'number') {
    return input > 0 ? { effect: 'grain', intensity: input, size: 1, seed: 0 } : undefined
  }
  if (input && typeof input === 'object') {
    const g = input as { intensity?: number; size?: number; seed?: number }
    if (typeof g.intensity === 'number' && g.intensity > 0) {
      return {
        effect: 'grain',
        intensity: g.intensity,
        size: typeof g.size === 'number' ? g.size : 1,
        seed: typeof g.seed === 'number' ? g.seed : 0,
      }
    }
  }
  return undefined
}

/** Resolve the `backdropBlur` sugar prop into a `{ effect: 'backdrop_blur', ... }`
 *  effect, or `undefined` when absent/degenerate. A bare number is the `sigma`; the
 *  object form adds a `tint` (any {@link ColorInput} — its alpha is the strength),
 *  a `brightness` and a `saturation` (both default to the `1` identity). An omitted
 *  tint emits transparent `{r:0,g:0,b:0,a:0}`. A non-positive `sigma` is dropped (no
 *  blur → nothing to frost). */
function parseBackdropBlur(
  input: unknown,
): Extract<Effect, { effect: 'backdrop_blur' }> | undefined {
  const TRANSPARENT: Color = { r: 0, g: 0, b: 0, a: 0 }
  if (typeof input === 'number') {
    return input > 0
      ? { effect: 'backdrop_blur', sigma: input, tint: TRANSPARENT, brightness: 1, saturation: 1 }
      : undefined
  }
  if (input && typeof input === 'object') {
    const b = input as {
      sigma?: number
      tint?: ColorInput
      brightness?: number
      saturation?: number
    }
    if (typeof b.sigma === 'number' && b.sigma > 0) {
      return {
        effect: 'backdrop_blur',
        sigma: b.sigma,
        tint: b.tint !== undefined ? parseColor(b.tint) : TRANSPARENT,
        brightness: typeof b.brightness === 'number' ? b.brightness : 1,
        saturation: typeof b.saturation === 'number' ? b.saturation : 1,
      }
    }
  }
  return undefined
}

/** Resolve the `lightWrap` sugar prop into a `{ effect: 'light_wrap', ... }` effect,
 *  or `undefined` when absent/degenerate. A bare number is the `sigma` (backdrop
 *  blur / rim width); the object form adds a `strength` (defaults to the `1` natural
 *  spill). A non-positive `sigma` is dropped (no spill → nothing to wrap). */
function parseLightWrap(input: unknown): Extract<Effect, { effect: 'light_wrap' }> | undefined {
  if (typeof input === 'number') {
    return input > 0 ? { effect: 'light_wrap', sigma: input, strength: 1 } : undefined
  }
  if (input && typeof input === 'object') {
    const w = input as { sigma?: number; strength?: number }
    if (typeof w.sigma === 'number' && w.sigma > 0) {
      return {
        effect: 'light_wrap',
        sigma: w.sigma,
        strength: typeof w.strength === 'number' ? w.strength : 1,
      }
    }
  }
  return undefined
}

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
  shadow?: Shadow
} {
  const out: {
    fill?: ReturnType<typeof parseColor>
    gradient?: Gradient
    stroke?: Stroke
    shadow?: Shadow
  } = {}
  if (props.fill !== undefined) out.fill = parseColor(props.fill as never)
  if (props.gradient !== undefined) out.gradient = parseGradient(props.gradient as GradientInput)
  const sh = props.shadow as
    | { color: unknown; blur?: number; offsetX?: number; offsetY?: number; spread?: number }
    | undefined
  if (sh && typeof sh.blur === 'number') {
    out.shadow = {
      color: parseColor(sh.color as never),
      blur: sh.blur,
      ...(typeof sh.offsetX === 'number' || typeof sh.offsetY === 'number'
        ? { offset: { x: sh.offsetX ?? 0, y: sh.offsetY ?? 0 } }
        : {}),
      ...(typeof sh.spread === 'number' ? { spread: sh.spread } : {}),
    }
  }
  if (props.stroke !== undefined) {
    out.stroke = {
      color: parseColor(props.stroke as never),
      width: typeof props.strokeWidth === 'number' ? props.strokeWidth : 1,
      ...(props.strokeCap === 'round' || props.strokeCap === 'square'
        ? { cap: props.strokeCap }
        : {}),
      ...(props.strokeJoin === 'round' || props.strokeJoin === 'bevel'
        ? { join: props.strokeJoin }
        : {}),
      ...(Array.isArray(props.strokeDash) && props.strokeDash.length
        ? { dash: props.strokeDash as number[] }
        : {}),
      ...(typeof props.strokeDashOffset === 'number'
        ? { dash_offset: props.strokeDashOffset }
        : {}),
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
