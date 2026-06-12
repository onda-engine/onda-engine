//! `@onda/cinema` — turn a timeline composition payload into an `@onda/react`
//! scene. This is the spec→engine renderer ONDA Studio uses in place of its
//! Remotion `composition-renderer`: scenes play through a `<TransitionSeries>`,
//! tracks layer as `<AbsoluteFill>`s, and each entry is a registry component
//! wrapped in its choreography — applied as numeric `Motion` on a `<Group>`
//! (the engine transform), not CSS.

import * as Components from '@onda/components'
import type { Motion, Theme } from '@onda/components'
import {
  AbsoluteFill,
  Camera,
  Composition,
  Group,
  Rect,
  Scene3D,
  Sequence,
  Text,
  type TransitionPresentation,
  TransitionSeries,
  blur,
  chromaticAberration,
  clipEllipse,
  clipPath,
  clipRect,
  clockWipe,
  crossFade,
  depthPush,
  devicePullback,
  dipToColor,
  expandMorph,
  fade,
  flip,
  glassWipe,
  gridPixelate,
  iris,
  linearTiming,
  morph,
  none,
  push,
  slide,
  typeMask,
  useCurrentFrame,
  useVideoConfig,
  wipe,
  zoom,
} from '@onda/react'
import { type ComponentType, type ReactElement, createElement } from 'react'
import {
  sceneDurationFrames,
  timeSpecToSeconds,
  toFrames,
  totalFrames,
  transitionOverlapFrames,
} from './timing.js'
import type {
  Brand,
  CameraMove,
  CompositionPayload,
  EntryAnimation,
  EntryClip,
  EntryEffects,
  EntryMatte,
  Scene,
  TimeSpec,
  Track,
  Transform3D,
} from './types.js'

export * from './types.js'
export { timeSpecToSeconds, toFrames, totalFrames } from './timing.js'

const DUR = Components.DURATION
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const asDir = (v: unknown): 'up' | 'down' | 'left' | 'right' =>
  v === 'down' || v === 'left' || v === 'right' || v === 'up' ? v : 'up'

// An exit pattern lands in the clip's last `exitDur` frames; a positive `delay`
// nudges it earlier. Entries play from the clip start (offset 0).
const exitStart = (p: Record<string, unknown>, dur: number, exitDur: number): number =>
  Math.max(0, dur - exitDur - num(p.delay, 0))

type PatternFn = (frame: number, fps: number, p: Record<string, unknown>, dur: number) => Motion

/** Choreography by name — calls the `@onda/components` pattern (returns scene
 *  `Motion`). Mirrors Studio's `CHOREOGRAPHY` map but on the engine model. */
const CHOREOGRAPHY: Record<string, PatternFn> = {
  entryFade: (frame, fps, p) =>
    Components.entryFade({
      frame,
      fps,
      delay: num(p.delay, 0),
      durationInFrames: num(p.durationInFrames, DUR.base),
    }),
  entryFadeRise: (frame, fps, p) =>
    Components.entryFadeRise({
      frame,
      fps,
      delay: num(p.delay, 0),
      durationInFrames: num(p.durationInFrames, DUR.base),
      travelPx: num(p.travelPx, 12),
    }),
  entrySlide: (frame, fps, p) =>
    Components.entrySlide({
      frame,
      fps,
      delay: num(p.delay, 0),
      durationInFrames: num(p.durationInFrames, DUR.base),
      direction: asDir(p.direction),
      distance: num(p.distance, 12),
    }),
  entryScale: (frame, fps, p) =>
    Components.entryScale({
      frame,
      fps,
      delay: num(p.delay, 0),
      durationInFrames: num(p.durationInFrames, DUR.base),
      from: num(p.from, 0.9),
    }),
  heroReveal: (frame, fps, p) =>
    Components.heroReveal({
      frame,
      fps,
      delay: num(p.delay, 0),
      durationInFrames: num(p.durationInFrames, DUR.slow),
      travelPx: num(p.travelPx, 16),
    }),
  exitFade: (frame, fps, p, dur) => {
    const ed = num(p.durationInFrames, DUR.fast)
    return Components.exitFade({ frame, fps, delay: exitStart(p, dur, ed), durationInFrames: ed })
  },
  exitFadeFall: (frame, fps, p, dur) => {
    const ed = num(p.durationInFrames, DUR.fast)
    return Components.exitFadeFall({
      frame,
      fps,
      delay: exitStart(p, dur, ed),
      durationInFrames: ed,
      travelPx: num(p.travelPx, 8),
    })
  },
  exitSlide: (frame, fps, p, dur) => {
    const ed = num(p.durationInFrames, DUR.fast)
    return Components.exitSlide({
      frame,
      fps,
      delay: exitStart(p, dur, ed),
      durationInFrames: ed,
      direction: asDir(p.direction),
      distance: num(p.distance, 12),
    })
  },
  exitScale: (frame, fps, p, dur) => {
    const ed = num(p.durationInFrames, DUR.fast)
    return Components.exitScale({ frame, fps, delay: exitStart(p, dur, ed), durationInFrames: ed })
  },
}

const REST: Motion = { opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1 }

// Placement → fraction of the canvas the element's centre is moved to. Components
// self-centre (their own `<AbsoluteFill justify="center">`), so without this every
// entry stacks dead-centre — a regression vs the Remotion path, which anchored by
// `placement`. Shifting the centred element by the centre→target delta restores
// regions; centre/thirds are exact, corners are approximate (true corner-anchoring
// needs the laid-out element size — a follow-up once the bridge can measure).
const PLACEMENT_COORDS: Record<string, [number, number]> = {
  center: [0.5, 0.5],
  top: [0.5, 0.1],
  bottom: [0.5, 0.9],
  left: [0.1, 0.5],
  right: [0.9, 0.5],
  'top-left': [0.1, 0.1],
  'top-right': [0.9, 0.1],
  'bottom-left': [0.1, 0.9],
  'bottom-right': [0.9, 0.9],
  'upper-third': [0.5, 0.28],
  'lower-third': [0.5, 0.72],
}

// Components that consume `placement` THEMSELVES (anchoring their own assembly to
// a canvas corner) — the bridge must NOT also shift them, or placement applies
// twice and they fly off-canvas.
// Components that anchor their OWN assembly to a canvas position via their `placement`
// prop (top/bottom/center, a corner, …). The bridge must NOT also apply placementOffset
// for these, or `placement` is applied TWICE (e.g. BlurReveal `placement:"bottom"` got
// shifted a half-canvas down by the bridge AND anchored bottom by itself → off-screen).
const SELF_ANCHORING = new Set(['LowerThird', 'Callout', 'BlurReveal', 'Captions'])

/** Centre→anchor pixel offset for an entry's `placement` prop (string slug or
 *  `{x,y}` fractions). Returns `[0,0]` for centre / unknown. */
function placementOffset(
  props: Record<string, unknown> | undefined,
  w: number,
  h: number,
): [number, number] {
  const p = props?.placement
  let fx = 0.5
  let fy = 0.5
  const coords = typeof p === 'string' ? PLACEMENT_COORDS[p] : undefined
  if (coords) [fx, fy] = coords
  else if (p && typeof p === 'object') {
    const o = p as { x?: unknown; y?: unknown }
    if (typeof o.x === 'number') fx = o.x
    if (typeof o.y === 'number') fy = o.y
  }
  return [(fx - 0.5) * w, (fy - 0.5) * h]
}

// ── Studio prop vocabulary → @onda/components prop API ────────────────────────
// ondajs/Studio components take a semantic SIZE ROLE (a fraction of the SMALLER
// canvas dimension, resolved canvas-aware) under prop names like `size` /
// `titleSize` / `numberSize`, with a px companion (`fontSize` / `titleFontSize`,
// which wins when both are passed). The `@onda/components` ports instead take
// raw px under their own names (`fontSize`, `titleSize`, `valueSize`). Without a
// translation, a real Studio payload's `size: "hero"` is either dropped (default
// size) or — worse — fed into a component's arithmetic, yielding `NaN` → a `null`
// in the scene JSON that the Rust f32 parser rejects (hard render failure).
//
// SIZE_ROLES + the resolve formula MUST match Studio's `resolveSize` exactly
// (frontend/src/lib/onda/canvas.tsx) so bridged sizes equal Studio's pixels.
const SIZE_ROLES: Record<string, number> = {
  hero: 0.15,
  heading: 0.09,
  subheading: 0.052,
  body: 0.03,
  caption: 0.02,
}
const roleToPx = (role: string, w: number, h: number): number =>
  Math.round((SIZE_ROLES[role] ?? 0) * Math.min(w, h))

// Per-component prop map: Studio prop name → `@onda/components` prop name. Role
// sources (`…Size`/`size`) resolve through SIZE_ROLES; px sources
// (`…FontSize`/`fontSize`) pass numbers through and WIN over a role for the same
// target (matching Studio's "px wins" rule).
const isPxSource = (name: string): boolean => name === 'fontSize' || name.endsWith('FontSize')
const PROP_ALIASES: Record<string, Record<string, string>> = {
  TitleCard: {
    titleSize: 'titleSize',
    titleFontSize: 'titleSize',
    subtitleSize: 'subtitleSize',
    subtitleFontSize: 'subtitleSize',
  },
  Highlight: { size: 'fontSize', fontSize: 'fontSize' },
  WordStagger: { size: 'fontSize', fontSize: 'fontSize' },
  Captions: { size: 'fontSize', fontSize: 'fontSize' },
  StatCard: {
    numberSize: 'valueSize',
    numberFontSize: 'valueSize',
    labelSize: 'labelSize',
    labelFontSize: 'labelSize',
  },
}

/** Translate a Studio entry's props to the `@onda/components` prop API: resolve
 *  size-role tokens to canvas-aware px, alias the differing prop names, and (as a
 *  safety net) resolve any leftover role-token value in place so a stray token
 *  can never reach a component's arithmetic and produce a NaN→null scene node. */
function adaptProps(
  component: string,
  props: Record<string, unknown> | undefined,
  w: number,
  h: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(props ?? {}) }
  const aliases = PROP_ALIASES[component]
  if (aliases) {
    // For each target prop, a px source wins over a role source.
    const pxValue: Record<string, number> = {}
    const roleValue: Record<string, number> = {}
    for (const [src, target] of Object.entries(aliases)) {
      if (!(src in out)) continue
      const v = out[src]
      if (isPxSource(src)) {
        if (typeof v === 'number') pxValue[target] = v
      } else if (typeof v === 'string' && v in SIZE_ROLES) {
        roleValue[target] = roleToPx(v, w, h)
      } else if (typeof v === 'number') {
        roleValue[target] = v // already px under a role-named prop
      }
      if (src !== target) delete out[src] // drop the Studio-only name
    }
    for (const target of new Set([...Object.keys(roleValue), ...Object.keys(pxValue)])) {
      out[target] = pxValue[target] ?? roleValue[target]
    }
  }
  // Generic safety net: any remaining prop whose value is a bare role token.
  for (const k of Object.keys(out)) {
    const v = out[k]
    if (typeof v === 'string' && v in SIZE_ROLES) out[k] = roleToPx(v, w, h)
  }
  return out
}

/** Compose every `animate` pattern into one Motion (opacity/scale multiply,
 *  translate sums) at the entry-relative `frame`. */
function composeMotion(
  animate: EntryAnimation[] | undefined,
  frame: number,
  fps: number,
  dur: number,
): Motion {
  let m = REST
  for (const a of animate ?? []) {
    const fn = CHOREOGRAPHY[a.pattern]
    if (!fn) continue
    const r = fn(frame, fps, a.params ?? {}, dur)
    m = {
      opacity: m.opacity * r.opacity,
      x: m.x + r.x,
      y: m.y + r.y,
      scaleX: m.scaleX * r.scaleX,
      scaleY: m.scaleY * r.scaleY,
    }
  }
  return m
}

/** Scene transition slugs → engine presentations (defaults). Unknown slugs fall
 *  back to cross-fade. The effect transitions (blur/glass-wipe/chromatic/…) are
 *  approximated in the presentation layer — no engine filter pass needed. */
type TransOpts = Record<string, unknown> | undefined
const TRANSITIONS: Record<string, (o?: TransOpts) => TransitionPresentation> = {
  'cross-fade': () => crossFade(),
  fade: () => fade(),
  slide: (o) => slide(o as never),
  wipe: (o) => wipe(o as never),
  iris: () => iris(),
  flip: () => flip(),
  'clock-wipe': () => clockWipe(),
  push: (o) => push(o as never),
  zoom: (o) => zoom(o as never),
  'depth-push': () => depthPush(),
  'dip-to-color': (o) => dipToColor(o as never),
  none: () => none(),
  // Effect transitions — approximated in the presentation layer (no engine blur).
  blur: () => blur(),
  'chromatic-aberration': () => chromaticAberration(),
  'device-pullback': () => devicePullback(),
  'expand-morph': () => expandMorph(),
  'glass-wipe': (o) => glassWipe(o as never),
  'grid-pixelate': (o) => gridPixelate(o as never),
  morph: () => morph(),
  'type-mask': (o) => typeMask(o as never),
}
const presentationFor = (type: string, options?: TransOpts): TransitionPresentation =>
  (TRANSITIONS[type] ?? crossFade)(options)

// ── Registry ────────────────────────────────────────────────────────────────

export type Registry = Record<string, ComponentType<Record<string, unknown>>>

const isComponent = (v: unknown): v is ComponentType<Record<string, unknown>> =>
  typeof v === 'function'

// Slug-derived names (PascalCase of the ondajs/Studio slug) that differ from the
// `@onda/components` export name. The bridge accepts the slug name so existing
// agent payloads resolve; the canonical `@onda` name also works.
const NAME_ALIASES: Record<string, string> = {
  RgbGlitchText: 'RgbGlitch', // ondajs `rgb-glitch-text` → @onda `RgbGlitch`
}

/** Default registry: every PascalCase `@onda/components` export (the components),
 *  plus slug-name aliases for the few that were renamed in the port. */
function defaultRegistry(): Registry {
  const reg: Registry = {}
  for (const [name, value] of Object.entries(Components)) {
    if (/^[A-Z]/.test(name) && isComponent(value)) {
      reg[name] = value as ComponentType<Record<string, unknown>>
    }
  }
  for (const [alias, target] of Object.entries(NAME_ALIASES)) {
    if (reg[target] && !reg[alias]) reg[alias] = reg[target]
  }
  return reg
}

function errorPlaceholder(name: string): ReactElement {
  return createElement(
    AbsoluteFill,
    { justify: 'center', align: 'center' },
    createElement(
      Text,
      { fontSize: 32, color: '#ff6b6b', fontWeight: 600 },
      `⚠ unknown component: ${name}`,
    ),
  )
}

// ── Entry / track / scene → @onda/react ──────────────────────────────────────

interface AnimatedProps {
  component: string
  props?: Record<string, unknown>
  animate?: EntryAnimation[]
  effects?: EntryEffects
  depth?: number
  transform3d?: Transform3D
  matte?: EntryMatte
  clip?: EntryClip
  durationInFrames: number
  registry: Registry
}

/** Build the `matte`/`clip` node props for an entry: the matte stencil element
 *  (built from the registry like a normal entry) + the clip region. */
function matteClipProps(
  matte: EntryMatte | undefined,
  clip: EntryClip | undefined,
  registry: Registry,
  width: number,
  height: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (matte) {
    const Comp = registry[matte.component]
    if (Comp) {
      out.matte = createElement(Comp, adaptProps(matte.component, matte.props, width, height))
      out.matteMode = matte.mode ?? 'alpha'
    }
  }
  if (clip) {
    out.clip =
      clip.shape === 'ellipse'
        ? clipEllipse(clip.width ?? width, clip.height ?? height)
        : clip.shape === 'path' && clip.data
          ? clipPath(clip.data)
          : clipRect(clip.width ?? width, clip.height ?? height, clip.cornerRadius)
  }
  return out
}

/** A registry component wrapped in its composed choreography Motion (opacity +
 *  translate on the outer group; scale about the canvas centre, matching CSS
 *  transform-origin). Per-entry `effects` (bloom/grade/grain/…) + `depth` wrap
 *  the component's own subtree as a `<Group>` carrying the engine effect props. */
function AnimatedEntry({
  component,
  props,
  animate,
  effects,
  depth,
  transform3d,
  matte,
  clip,
  durationInFrames,
  registry,
}: AnimatedProps): ReactElement {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const m = composeMotion(animate, frame, fps, durationInFrames)
  const Comp = registry[component]
  const base = Comp
    ? createElement(Comp, adaptProps(component, props, width, height))
    : errorPlaceholder(component)
  // Per-entry effects + 2.5D depth → a wrapping <Group> (the @onda engine reads
  // these sugar props as scene-graph effects; rendered on Vello in export).
  const fxChild =
    effects || typeof depth === 'number'
      ? createElement(
          Group as ComponentType<Record<string, unknown>>,
          { ...(effects ?? {}), ...(typeof depth === 'number' ? { depth } : {}) },
          base,
        )
      : base
  // Track matte (media-through-type) + clip region.
  const matteChild =
    matte || clip
      ? createElement(
          Group as ComponentType<Record<string, unknown>>,
          matteClipProps(matte, clip, registry, width, height),
          fxChild,
        )
      : fxChild
  // AE-style 3D: wrap in a <Scene3D> (default camera) with the 3D layer carrying
  // position3d / rotation3d / extrude. Inert (pixel-identical) until moved in z.
  const child =
    transform3d && Object.keys(transform3d).length > 0
      ? createElement(
          Scene3D as ComponentType<Record<string, unknown>>,
          {},
          createElement(
            Group as ComponentType<Record<string, unknown>>,
            { ...transform3d },
            matteChild,
          ),
        )
      : matteChild
  const cx = width / 2
  const cy = height / 2
  const [px, py] = SELF_ANCHORING.has(component) ? [0, 0] : placementOffset(props, width, height)
  return createElement(
    Group,
    { x: m.x + px, y: m.y + py, opacity: m.opacity },
    createElement(
      Group,
      { x: cx, y: cy },
      createElement(
        Group,
        { scaleX: m.scaleX, scaleY: m.scaleY },
        createElement(Group, { x: -cx, y: -cy }, child),
      ),
    ),
  )
}

function EntrySlot({
  entry,
  registry,
}: { entry: Track['entries'][number]; registry: Registry }): ReactElement {
  const { fps } = useVideoConfig()
  return createElement(
    Sequence,
    { from: toFrames(entry.at, fps), durationInFrames: toFrames(entry.for, fps) },
    createElement(AnimatedEntry, {
      component: entry.component,
      props: entry.props,
      animate: entry.animate,
      effects: entry.effects,
      depth: entry.depth,
      transform3d: entry.transform3d,
      matte: entry.matte,
      clip: entry.clip,
      durationInFrames: toFrames(entry.for, fps),
      registry,
    }),
  )
}

// Overlay containers MUST be plain <Group>s, not <AbsoluteFill>s. `@onda/react`'s
// AbsoluteFill is a flex column (it lays children out top-to-bottom), not a
// Remotion-style absolutely-positioned overlay — so sibling tracks/entries would
// STACK and consume each other's space instead of overlapping. A plain Group
// applies no layout, so its children all render at (0,0) and overlay; each leaf
// component fills the canvas via its own AbsoluteFill. (See buildComposition root
// for the same fix — a full-frame bg Rect as a flex sibling otherwise eats all
// the height and the content collapses to nothing → a blank frame.)
/** A cinematic camera move over a scene — frames the content in an @onda
 *  `<Camera>` eased from `move.from` → `move.to` over the scene duration. */
function AnimatedCamera({
  move,
  durationInFrames,
  children,
}: { move: CameraMove; durationInFrames: number; children: ReactElement }): ReactElement {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const p = durationInFrames > 1 ? Math.min(1, Math.max(0, frame / (durationInFrames - 1))) : 1
  const e = p * p * (3 - 2 * p) // smoothstep ease-in-out
  const from = move.from ?? {}
  const to = move.to ?? {}
  const lerp = (a: number | undefined, b: number | undefined, d: number): number => {
    const av = a ?? d
    const bv = b ?? d
    return av + (bv - av) * e
  }
  return createElement(
    Camera,
    {
      focusX: lerp(from.x, to.x, 0.5) * width,
      focusY: lerp(from.y, to.y, 0.5) * height,
      zoom: lerp(from.zoom, to.zoom, 1),
      rotate: lerp(from.rotate, to.rotate, 0),
    },
    children,
  )
}

function SceneTracks({ scene, registry }: { scene: Scene; registry: Registry }): ReactElement {
  return createElement(
    Group,
    null,
    ...scene.tracks.map((track, ti) =>
      createElement(
        Group,
        { key: track.id ?? `track-${ti}` },
        ...track.entries.map((entry, ei) =>
          createElement(EntrySlot, { key: entry.id ?? `entry-${ei}`, entry, registry }),
        ),
      ),
    ),
  )
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface BuildOptions {
  /** Component lookup. Default: every `@onda/components` component. */
  registry?: Registry
}

function brandToTheme(brand: Brand): Partial<Theme> {
  const t: Partial<Theme> = {}
  if (brand.accent) t.accent = brand.accent
  if (brand.accentSoft) t.accentSoft = brand.accentSoft
  if (brand.text) t.text = brand.text
  if (brand.dim) t.textMuted = brand.dim
  if (brand.bg) t.background = brand.bg
  if (brand.surface) t.surface = brand.surface
  if (brand.border) t.border = brand.border
  if (brand.fontBody) t.fontFamily = brand.fontBody
  if (brand.fontDisplay) t.headingFamily = brand.fontDisplay
  return t
}

/**
 * Build an `@onda/react` `<Composition>` from a timeline payload. Pass the
 * result to `@onda/render`'s `renderToFile` (export) or `<Player>` (preview).
 */
export function buildComposition(
  payload: CompositionPayload,
  opts: BuildOptions = {},
): ReactElement {
  const {
    width,
    height,
    fps,
    scenes,
    layers = [],
    brand,
    linear,
    finish,
    motionBlur,
    dof,
  } = payload
  const registry = opts.registry ?? defaultRegistry()
  const total = totalFrames(payload, fps)

  const seriesChildren: ReactElement[] = []
  scenes.forEach((scene, i) => {
    if (i > 0 && scene.transition) {
      seriesChildren.push(
        createElement(TransitionSeries.Transition, {
          key: `transition-${i}`,
          presentation: presentationFor(scene.transition.type, scene.transition.options),
          timing: linearTiming({
            durationInFrames: transitionOverlapFrames(scenes[i - 1], scene, fps),
          }),
        }),
      )
    }
    seriesChildren.push(
      createElement(
        TransitionSeries.Sequence,
        { key: scene.id, durationInFrames: sceneDurationFrames(scene, fps) },
        scene.camera
          ? createElement(AnimatedCamera, {
              move: scene.camera,
              durationInFrames: sceneDurationFrames(scene, fps),
              children: createElement(SceneTracks, { scene, registry }),
            })
          : createElement(SceneTracks, { scene, registry }),
      ),
    )
  })

  const layerEls = (under: boolean): ReactElement[] =>
    layers
      .filter((l) => Boolean(l.under) === under)
      .flatMap((layer, li) =>
        layer.entries.map((entry, ei) => {
          const from = toFrames(entry.at ?? 0, fps)
          const dur = entry.for != null ? toFrames(entry.for, fps) : Math.max(1, total - from)
          return createElement(
            Sequence,
            { key: `layer-${under ? 'u' : 'o'}-${li}-${ei}`, from, durationInFrames: dur },
            createElement(AnimatedEntry, {
              component: entry.component,
              props: entry.props,
              animate: entry.animate,
              effects: entry.effects,
              depth: entry.depth,
              transform3d: entry.transform3d,
              matte: entry.matte,
              clip: entry.clip,
              durationInFrames: dur,
              registry,
            }),
          )
        }),
      )

  // Plain Group, NOT AbsoluteFill: the bg Rect, layers and TransitionSeries must
  // OVERLAY (z-stack at 0,0). AbsoluteFill's flex column would lay the full-height
  // bg Rect first and squeeze everything after it to zero height → blank render.
  const root = createElement(
    Group,
    null,
    createElement(Rect, { width, height, fill: brand?.bg ?? '#08080a' }),
    ...layerEls(true),
    createElement(TransitionSeries, null, ...seriesChildren),
    ...layerEls(false),
  )
  const content = brand
    ? createElement(Components.ThemeProvider, { theme: brandToTheme(brand) }, root)
    : root

  // Composition-level cinematic finish/dof/motion-blur/linear ride on the root
  // <Composition> — the @onda engine applies them after the comp rasterizes
  // (finish + motionBlur are GPU/export-only).
  return createElement(
    Composition,
    { width, height, fps, durationInFrames: total, linear, finish, motionBlur, dof },
    content,
  )
}

// ── Validation ──────────────────────────────────────────────────────────────

export interface Diagnostic {
  /** `error` = won't render correctly (fix it); `warning` = renders, but off or
   *  fragile; `info` = an FYI an agent should weigh (e.g. a degraded component). */
  level: 'error' | 'warning' | 'info'
  path: string
  message: string
}

/** Levenshtein edit distance — for "did you mean?" on a misspelled component. */
function editDistance(a: string, b: string): number {
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost)
    }
    prev = cur
  }
  return prev[b.length] ?? 0
}

/** The closest registry name to `name` within a typo-level distance, else null. */
function closestComponent(name: string, registry: Registry): string | null {
  let best: string | null = null
  let bestD = Number.POSITIVE_INFINITY
  for (const k of Object.keys(registry)) {
    const d = editDistance(name.toLowerCase(), k.toLowerCase())
    if (d < bestD) {
      bestD = d
      best = k
    }
  }
  return best && bestD <= Math.max(2, Math.floor(name.length / 3)) ? best : null
}

/** Whether `v` is a well-formed TimeSpec. `timeSpecToSeconds` is lenient (garbage
 *  → 0), so the validator checks the shape strictly: a finite number, or a string
 *  that's `M:SS` / `<n>ms` / `<n>f` / `<n>s` / a bare number — each numeric part
 *  finite. (`isValidTimeSpec("soon")` is false.) */
function isValidTimeSpec(v: TimeSpec): boolean {
  if (typeof v === 'number') return Number.isFinite(v)
  const s = v.trim()
  if (s === '') return false
  const numOk = (x: string): boolean => x.trim() !== '' && Number.isFinite(Number(x))
  if (s.includes(':')) {
    const [m, sec] = s.split(':')
    return numOk(m ?? '') && numOk(sec ?? '')
  }
  if (s.endsWith('ms')) return numOk(s.slice(0, -2))
  if (s.endsWith('f')) return numOk(s.slice(0, -1))
  if (s.endsWith('s')) return numOk(s.slice(0, -1))
  return numOk(s)
}

/**
 * Check a payload before rendering — the tight feedback loop an agent (ONDA
 * Studio's MCP) self-corrects against. Flags structural issues, unknown
 * components (with a did-you-mean), unknown patterns/transitions, malformed
 * timing, and — from the fidelity contract — components that are GPU-only,
 * degraded, or imitate a browser feature, so the agent picks engine-native
 * components and avoids surprises. Returns `[]` when the composition is clean.
 */
export function validateComposition(
  payload: CompositionPayload,
  opts: BuildOptions = {},
): Diagnostic[] {
  const registry = opts.registry ?? defaultRegistry()
  const fidelity = Components.COMPONENT_FIDELITY as
    | Record<
        string,
        { fidelity: string; engineNative: boolean; needsFeature: string | null; backend: string }
      >
    | undefined
  const diags: Diagnostic[] = []
  if (!(payload.fps > 0)) diags.push({ level: 'error', path: 'fps', message: 'fps must be > 0' })
  if (!(payload.width > 0 && payload.height > 0))
    diags.push({ level: 'error', path: 'size', message: 'width/height must be > 0' })
  if (!payload.scenes?.length)
    diags.push({ level: 'error', path: 'scenes', message: 'composition has no scenes' })

  const fps = payload.fps > 0 ? payload.fps : 30
  const checkTime = (v: TimeSpec | undefined, path: string, required: boolean): void => {
    if (v === undefined) {
      if (required) diags.push({ level: 'error', path, message: 'missing required time' })
      return
    }
    if (!isValidTimeSpec(v)) {
      diags.push({
        level: 'error',
        path,
        message: `invalid time ${JSON.stringify(v)} — use seconds (e.g. 2) or a spec string ("2s", "500ms", "0:02", "90f")`,
      })
      return
    }
    const secs = typeof v === 'number' ? v : timeSpecToSeconds(v, fps)
    if (secs < 0)
      diags.push({ level: 'error', path, message: `time ${JSON.stringify(v)} is negative` })
  }

  const checkEntry = (
    e: { component: string; at?: TimeSpec; for?: TimeSpec; animate?: EntryAnimation[] },
    path: string,
    timed: boolean,
  ): void => {
    if (!registry[e.component]) {
      const guess = closestComponent(e.component, registry)
      diags.push({
        level: 'error',
        path: `${path}.component`,
        message: `unknown component "${e.component}"${guess ? ` — did you mean "${guess}"?` : ''}`,
      })
    } else {
      const f = fidelity?.[e.component]
      if (f?.fidelity === 'apes_remotion')
        diags.push({
          level: 'warning',
          path: `${path}.component`,
          message: `"${e.component}" imitates a browser-only effect the engine doesn't do natively — it renders a stylized approximation; avoid for hero moments.`,
        })
      else if (f?.fidelity === 'degraded')
        diags.push({
          level: 'info',
          path: `${path}.component`,
          message: `"${e.component}" renders an approximation until the engine gains "${f.needsFeature}".`,
        })
      if (f?.backend === 'gpu_only')
        diags.push({
          level: 'warning',
          path: `${path}.component`,
          message: `"${e.component}" needs the GPU (Vello) backend — it won't render correctly on the CPU reference (e.g. a CPU-verified or no-GPU export).`,
        })
    }
    // Entries are timed (at/for required); layer entries may omit them.
    checkTime(e.at, `${path}.at`, timed)
    checkTime(e.for, `${path}.for`, timed)
    ;(e.animate ?? []).forEach((a, i) => {
      if (!CHOREOGRAPHY[a.pattern])
        diags.push({
          level: 'warning',
          path: `${path}.animate[${i}]`,
          message: `unknown choreography pattern "${a.pattern}" (ignored)`,
        })
    })
  }

  payload.scenes?.forEach((scene, si) => {
    if (scene.transition && !TRANSITIONS[scene.transition.type])
      diags.push({
        level: 'warning',
        path: `scenes[${si}].transition`,
        message: `transition "${scene.transition.type}" not in the engine yet — falls back to cross-fade`,
      })
    if (!scene.tracks?.length)
      diags.push({ level: 'warning', path: `scenes[${si}].tracks`, message: 'scene has no tracks' })
    scene.tracks?.forEach((track, ti) =>
      track.entries.forEach((e, ei) =>
        checkEntry(e, `scenes[${si}].tracks[${ti}].entries[${ei}]`, true),
      ),
    )
  })
  payload.layers?.forEach((layer, li) =>
    layer.entries.forEach((e, ei) => checkEntry(e, `layers[${li}].entries[${ei}]`, false)),
  )
  return diags
}
