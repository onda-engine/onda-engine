//! `@onda/cinema` — turn a timeline composition payload into an `@onda/react`
//! scene. This is the spec→engine renderer ONDA Studio uses in place of its
//! Remotion `composition-renderer`: scenes play through a `<TransitionSeries>`,
//! tracks layer as `<AbsoluteFill>`s, and each entry is a registry component
//! wrapped in its choreography — applied as numeric `Motion` on a `<Group>`
//! (the engine transform), not CSS.

import * as Components from '@onda/components'
import type { KeyframeTracks, Motion, Theme } from '@onda/components'
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
  filmBurn,
  flip,
  glassWipe,
  gridPixelate,
  iris,
  linearTiming,
  lumaWipe,
  morph,
  none,
  push,
  slide,
  typeMask,
  useCurrentFrame,
  useVideoConfig,
  whipPan,
  wipe,
  zoom,
  zoomBlur,
} from '@onda/react'
import { type ComponentType, type ReactElement, createElement } from 'react'
import { PROP_ALIASES, SELF_ANCHORING, adaptProps, placementOffset } from './props.js'
import {
  sceneDurationFrames,
  scenePlacements,
  timeSpecToSeconds,
  toFrames,
  totalFrames,
  transitionOverlapFrames,
} from './timing.js'
import type {
  Brand,
  CameraMove,
  CompositionPayload,
  Entry,
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
export {
  type ScenePlacement,
  scenePlacements,
  timeSpecToSeconds,
  toFrames,
  totalFrames,
} from './timing.js'
// The inspector — quality metrics (`inspect`) over the same payload.
export * from './inspect/index.js'

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
  // Direct-manipulation keyframe animation (the Studio editor). Shares the sampler
  // with the Keyframes component + Studio preview, so interpolation is identical.
  // Position is an OFFSET from placement (additive); opacity/scale absolute;
  // rotation in degrees.
  keyframes: (frame, _fps, p) => {
    const k = Components.sampleKeyframes(p as KeyframeTracks, frame)
    return { opacity: k.opacity, x: k.x, y: k.y, scaleX: k.scale, scaleY: k.scale, rotation: k.rotation }
  },
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
      rotation: (m.rotation ?? 0) + (r.rotation ?? 0),
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
  'zoom-blur': (o) => zoomBlur(o as never),
  'whip-pan': (o) => whipPan(o as never),
  'film-burn': (o) => filmBurn(o as never),
  'luma-wipe': () => lumaWipe(),
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
        { scaleX: m.scaleX, scaleY: m.scaleY, rotation: m.rotation },
        createElement(Group, { x: -cx, y: -cy }, child),
      ),
    ),
  )
}

/** During a magic-move overlap the matched element is drawn ONCE by the morph
 *  layer (above the spine). This window — in the entry's OWN sequence-local frame
 *  space — suppresses the underlying instance so it doesn't double. */
interface MorphSuppress {
  /** First local frame (inclusive) to hide the entry. */
  from: number
  /** Last local frame (exclusive) to hide the entry. */
  to: number
}

/** Hide `children` while the (sequence-local) frame is inside `[s.from, s.to)`
 *  — the morph layer is drawing this element instead. */
function MorphSuppressGate({
  suppress,
  children,
}: { suppress: MorphSuppress; children: ReactElement }): ReactElement | null {
  const frame = useCurrentFrame()
  if (frame >= suppress.from && frame < suppress.to) return null
  return children
}

function EntrySlot({
  entry,
  registry,
  suppress,
}: {
  entry: Track['entries'][number]
  registry: Registry
  /** Hide this entry during a magic-move overlap (window in entry-local frames). */
  suppress?: MorphSuppress
}): ReactElement {
  const { fps } = useVideoConfig()
  const animated = createElement(AnimatedEntry, {
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
  })
  return createElement(
    Sequence,
    { from: toFrames(entry.at, fps), durationInFrames: toFrames(entry.for, fps) },
    // biome-ignore lint/correctness/noChildrenProp: raw createElement props object, not JSX
    suppress ? createElement(MorphSuppressGate, { suppress, children: animated }) : animated,
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

function SceneTracks({
  scene,
  registry,
  suppress,
}: {
  scene: Scene
  registry: Registry
  /** entry → its magic-move suppression window (entry-local frames). */
  suppress?: Map<Entry, MorphSuppress>
}): ReactElement {
  return createElement(
    Group,
    null,
    ...scene.tracks.map((track, ti) =>
      createElement(
        Group,
        { key: track.id ?? `track-${ti}` },
        ...track.entries.map((entry, ei) =>
          createElement(EntrySlot, {
            key: entry.id ?? `entry-${ei}`,
            entry,
            registry,
            suppress: suppress?.get(entry),
          }),
        ),
      ),
    ),
  )
}

// ── Magic move (matched-element continuity across a cut) ──────────────────────
//
// When an entry in scene A and an entry in scene B share a `morphKey`, the element
// should MORPH its position/scale across the cut (one continuous move) rather than
// hard-cut/cross-fade — Keynote Magic Move / a matched cut. A TransitionPresentation
// only sees the WHOLE scene flat, so it can't tween a single element. Instead, during
// the transition OVERLAP we draw ONE interpolating instance (built from B's entry)
// ABOVE the spine, and suppress the duplicate in A's tail + B's head so it never
// doubles. v1 morphs translate + scale (resolved the SAME way the renderer places an
// entry: placementOffset + canvas centre); opacity holds.

/** An entry's resolved screen TRANSFORM at rest — the pixel translate the renderer
 *  applies for its `placement` (matching `AnimatedEntry`'s `placementOffset`) plus a
 *  uniform scale. Animation Motion is intentionally NOT baked in: the morph reads
 *  the element's settled placement, which is the dominant magic-move signal. */
interface MorphTransform {
  x: number
  y: number
  scale: number
}

function entryTransform(entry: Entry, w: number, h: number): MorphTransform {
  const [px, py] = SELF_ANCHORING.has(entry.component) ? [0, 0] : placementOffset(entry.props, w, h)
  const s = entry.props?.scale
  return { x: px, y: py, scale: typeof s === 'number' && Number.isFinite(s) ? s : 1 }
}

/** A matched magic-move pair: the destination entry (drawn morphing) and the
 *  endpoints + absolute overlap window it tweens across. */
interface MorphPair {
  /** Built from B (the destination) — same component + props. */
  to: Entry
  from: MorphTransform
  toT: MorphTransform
  /** Absolute frame the overlap (and the morph) starts. */
  overlapStart: number
  /** Overlap length in frames. */
  overlapFrames: number
}

/** Find which `morphKey`s an entry holds AT a scene boundary, with the entry. A
 *  morph only fires for an entry that's actually on-screen at the cut: in scene A
 *  the entry must still be live in A's last `overlap` frames; in scene B it must be
 *  live in B's first `overlap` frames. */
function morphEntriesAtTail(
  scene: Scene,
  fps: number,
  sceneDur: number,
  overlap: number,
): Map<string, Entry> {
  const m = new Map<string, Entry>()
  const cutStart = sceneDur - overlap
  for (const track of scene.tracks) {
    for (const e of track.entries) {
      if (!e.morphKey) continue
      const start = toFrames(e.at, fps)
      const end = start + toFrames(e.for, fps)
      // Live during the tail overlap window [cutStart, sceneDur).
      if (start < sceneDur && end > cutStart) m.set(e.morphKey, e)
    }
  }
  return m
}

function morphEntriesAtHead(scene: Scene, fps: number, overlap: number): Map<string, Entry> {
  const m = new Map<string, Entry>()
  for (const track of scene.tracks) {
    for (const e of track.entries) {
      if (!e.morphKey) continue
      const start = toFrames(e.at, fps)
      const end = start + toFrames(e.for, fps)
      // Live during the head overlap window [0, overlap).
      if (start < overlap && end > 0) m.set(e.morphKey, e)
    }
  }
  return m
}

/** A morphing element above the spine: B's element wrapped in a Group that tweens
 *  translate + scale from A's placement to B's over the overlap (smoothstep). */
function MorphLayer({ pair, registry }: { pair: MorphPair; registry: Registry }): ReactElement {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const n = pair.overlapFrames
  const p = n > 1 ? Math.min(1, Math.max(0, frame / (n - 1))) : 1
  const e = p * p * (3 - 2 * p) // smoothstep ease-in-out
  const lerp = (a: number, b: number): number => a + (b - a) * e
  const x = lerp(pair.from.x, pair.toT.x)
  const y = lerp(pair.from.y, pair.toT.y)
  const scale = lerp(pair.from.scale, pair.toT.scale)

  const Comp = registry[pair.to.component]
  const base = Comp
    ? createElement(Comp, adaptProps(pair.to.component, pair.to.props, width, height))
    : errorPlaceholder(pair.to.component)
  const cx = width / 2
  const cy = height / 2
  // Translate to the morphed placement, then scale about the canvas centre
  // (matching AnimatedEntry's scale-about-centre pivot).
  return createElement(
    Group,
    { x, y },
    createElement(
      Group,
      { x: cx, y: cy },
      createElement(
        Group,
        { scaleX: scale, scaleY: scale },
        createElement(Group, { x: -cx, y: -cy }, base),
      ),
    ),
  )
}

/** Plan the magic-move layers for a composition: for each adjacent A→B pair sharing
 *  a `morphKey`, an absolute-timed morph layer + the per-entry suppression windows
 *  (so the underlying duplicate hides during the overlap). `sceneStart` and
 *  `sceneDur` are the per-scene absolute start / duration in frames. */
interface MorphPlan {
  /** Absolute-timed morph layers to render above the spine. */
  pairs: MorphPair[]
  /** scene index → (entry → suppression window in that entry's LOCAL frames). */
  suppress: Map<number, Map<Entry, MorphSuppress>>
}

function planMorphs(
  scenes: Scene[],
  fps: number,
  w: number,
  h: number,
  sceneStart: number[],
  sceneDur: number[],
): MorphPlan {
  const pairs: MorphPair[] = []
  const suppress = new Map<number, Map<Entry, MorphSuppress>>()
  const addSuppress = (sceneIdx: number, entry: Entry, win: MorphSuppress): void => {
    let m = suppress.get(sceneIdx)
    if (!m) {
      m = new Map<Entry, MorphSuppress>()
      suppress.set(sceneIdx, m)
    }
    m.set(entry, win)
  }

  for (let i = 1; i < scenes.length; i++) {
    const prev = scenes[i - 1]
    const cur = scenes[i]
    if (!prev || !cur || !cur.transition) continue
    const overlap = transitionOverlapFrames(prev, cur, fps)
    if (overlap <= 0) continue
    const prevDur = sceneDur[i - 1] ?? 0
    const aMap = morphEntriesAtTail(prev, fps, prevDur, overlap)
    if (aMap.size === 0) continue
    const bMap = morphEntriesAtHead(cur, fps, overlap)
    if (bMap.size === 0) continue
    const overlapStart = sceneStart[i] ?? 0 // scene B starts where the overlap begins

    for (const [key, aEntry] of aMap) {
      const bEntry = bMap.get(key)
      if (!bEntry) continue
      pairs.push({
        to: bEntry,
        from: entryTransform(aEntry, w, h),
        toT: entryTransform(bEntry, w, h),
        overlapStart,
        overlapFrames: overlap,
      })
      // Suppress A's tail (last `overlap` local frames) and B's head (first
      // `overlap` local frames) so only the morphing instance shows.
      addSuppress(i - 1, aEntry, { from: prevDur - overlap, to: prevDur })
      addSuppress(i, bEntry, { from: 0, to: overlap })
    }
  }
  return { pairs, suppress }
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

  // Per-scene absolute start frame + duration — the same placement
  // <TransitionSeries> computes (a scene starts where the previous one ends MINUS
  // its incoming transition overlap). The magic-move planner needs these to time
  // the morph layer to the cut window. `scenePlacements` is the shared resolver
  // (the inspector reads the identical timeline).
  const placements = scenePlacements(scenes, fps)
  const sceneDur = placements.map((p) => p.durationInFrames)
  const sceneStart = placements.map((p) => p.start)
  const morphPlan = planMorphs(scenes, fps, width, height, sceneStart, sceneDur)

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
    const sceneSuppress = morphPlan.suppress.get(i)
    seriesChildren.push(
      createElement(
        TransitionSeries.Sequence,
        { key: scene.id, durationInFrames: sceneDur[i] ?? sceneDurationFrames(scene, fps) },
        scene.camera
          ? createElement(AnimatedCamera, {
              move: scene.camera,
              durationInFrames: sceneDur[i] ?? sceneDurationFrames(scene, fps),
              // biome-ignore lint/correctness/noChildrenProp: raw createElement props object, not JSX
              children: createElement(SceneTracks, { scene, registry, suppress: sceneSuppress }),
            })
          : createElement(SceneTracks, { scene, registry, suppress: sceneSuppress }),
      ),
    )
  })

  // Magic-move layers: one interpolating instance per matched A→B pair, absolute-
  // timed to the transition overlap and drawn ABOVE the spine.
  const morphLayers: ReactElement[] = morphPlan.pairs.map((pair, i) =>
    createElement(
      Sequence,
      {
        key: `morph-${i}`,
        from: pair.overlapStart,
        durationInFrames: pair.overlapFrames,
      },
      createElement(MorphLayer, { pair, registry }),
    ),
  )

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
    // Magic-move morph layers ride ABOVE the spine (drawn during the cut overlap).
    ...morphLayers,
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

// Entry props the BRIDGE itself consumes (every component), beyond what a
// component's own schema declares: `placement` is read by `placementOffset`,
// `scale` by the magic-move `entryTransform`.
const BRIDGE_PROPS = ['placement', 'scale']

/** The prop names known for `component` — its manifest props + Zod-schema keys
 *  + the bridge's Studio-name aliases + the bridge-consumed props — or `null`
 *  when the component isn't catalogued (then no unknown-prop check runs). */
function knownPropsFor(component: string): Set<string> | null {
  const m = Components.manifestEntry(component)
  if (!m) return null
  const known = new Set<string>(m.props.map((p) => p.name))
  // The Zod object's shape, in case the schema carries keys the PropMeta lags.
  const shape = (m.schema as unknown as { shape?: Record<string, unknown> }).shape
  if (shape && typeof shape === 'object') for (const k of Object.keys(shape)) known.add(k)
  for (const src of Object.keys(PROP_ALIASES[component] ?? {})) known.add(src)
  for (const k of BRIDGE_PROPS) known.add(k)
  return known
}

/**
 * Check a payload before rendering — the tight feedback loop an agent (ONDA
 * Studio's MCP) self-corrects against. Flags structural issues, unknown
 * components (with a did-you-mean), unknown patterns/transitions, malformed
 * timing, and — from the fidelity contract — components that are GPU-only,
 * degraded, or imitate a browser feature, so the agent picks engine-native
 * components and avoids surprises. Returns `[]` when the composition is clean.
 *
 * Unknown-props policy: WARN, don't strip. An unknown prop on a known
 * component yields a `warning` diagnostic and the prop is PRESERVED through
 * `buildComposition` (the component ignores what it doesn't know) — never
 * silently dropped. Unknown COMPONENTS stay errors (with a did-you-mean).
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
    e: {
      component: string
      at?: TimeSpec
      for?: TimeSpec
      animate?: EntryAnimation[]
      role?: string
      props?: Record<string, unknown>
    },
    path: string,
    timed: boolean,
  ): void => {
    if (e.role !== undefined && e.role !== 'focal' && e.role !== 'support' && e.role !== 'ambient')
      diags.push({
        level: 'error',
        path: `${path}.role`,
        message: `invalid role ${JSON.stringify(e.role)} — use 'focal' | 'support' | 'ambient' (absent = 'support')`,
      })
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
      // Unknown props: warn, don't strip — the prop rides through to the
      // component (which ignores what it doesn't know), and the agent learns
      // the name it probably misspelled.
      const known = knownPropsFor(e.component)
      if (known && e.props) {
        for (const k of Object.keys(e.props)) {
          if (!known.has(k))
            diags.push({
              level: 'warning',
              path: `${path}.props.${k}`,
              message: `unknown prop "${k}" on ${e.component} — passed through (the component ignores props it doesn't declare)`,
            })
        }
      }
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
