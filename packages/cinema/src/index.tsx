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
  Composition,
  Group,
  Rect,
  Sequence,
  Text,
  type TransitionPresentation,
  TransitionSeries,
  clockWipe,
  crossFade,
  depthPush,
  dipToColor,
  fade,
  flip,
  iris,
  linearTiming,
  none,
  push,
  slide,
  useCurrentFrame,
  useVideoConfig,
  wipe,
  zoom,
} from '@onda/react'
import { type ComponentType, type ReactElement, createElement } from 'react'
import { sceneDurationFrames, toFrames, totalFrames, transitionOverlapFrames } from './timing.js'
import type { Brand, CompositionPayload, EntryAnimation, Scene, Track } from './types.js'

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
const SELF_ANCHORING = new Set(['LowerThird', 'Callout'])

/** Centre→anchor pixel offset for an entry's `placement` prop (string slug or
 *  `{x,y}` fractions). Returns `[0,0]` for centre / unknown. */
function placementOffset(props: Record<string, unknown> | undefined, w: number, h: number): [number, number] {
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
 *  back to cross-fade. The blur/blend-based ones await the engine filter pass. */
const TRANSITIONS: Record<string, () => TransitionPresentation> = {
  'cross-fade': () => crossFade(),
  fade: () => fade(),
  slide: () => slide(),
  wipe: () => wipe(),
  iris: () => iris(),
  flip: () => flip(),
  'clock-wipe': () => clockWipe(),
  push: () => push(),
  zoom: () => zoom(),
  'depth-push': () => depthPush(),
  'dip-to-color': () => dipToColor(),
  none: () => none(),
}
const presentationFor = (type: string): TransitionPresentation => (TRANSITIONS[type] ?? crossFade)()

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
  durationInFrames: number
  registry: Registry
}

/** A registry component wrapped in its composed choreography Motion (opacity +
 *  translate on the outer group; scale about the canvas centre, matching CSS
 *  transform-origin). */
function AnimatedEntry({
  component,
  props,
  animate,
  durationInFrames,
  registry,
}: AnimatedProps): ReactElement {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const m = composeMotion(animate, frame, fps, durationInFrames)
  const Comp = registry[component]
  const child = Comp ? createElement(Comp, props ?? {}) : errorPlaceholder(component)
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
  const { width, height, fps, scenes, layers = [], brand } = payload
  const registry = opts.registry ?? defaultRegistry()
  const total = totalFrames(payload, fps)

  const seriesChildren: ReactElement[] = []
  scenes.forEach((scene, i) => {
    if (i > 0 && scene.transition) {
      seriesChildren.push(
        createElement(TransitionSeries.Transition, {
          key: `transition-${i}`,
          presentation: presentationFor(scene.transition.type),
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
        createElement(SceneTracks, { scene, registry }),
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

  return createElement(Composition, { width, height, fps, durationInFrames: total }, content)
}

// ── Validation ──────────────────────────────────────────────────────────────

export interface Diagnostic {
  level: 'error' | 'warning'
  path: string
  message: string
}

/** Check a payload before rendering — unknown components/patterns/transitions +
 *  structural issues. The tight feedback loop an agent self-corrects against. */
export function validateComposition(
  payload: CompositionPayload,
  opts: BuildOptions = {},
): Diagnostic[] {
  const registry = opts.registry ?? defaultRegistry()
  const diags: Diagnostic[] = []
  if (!(payload.fps > 0)) diags.push({ level: 'error', path: 'fps', message: 'fps must be > 0' })
  if (!(payload.width > 0 && payload.height > 0))
    diags.push({ level: 'error', path: 'size', message: 'width/height must be > 0' })
  if (!payload.scenes?.length)
    diags.push({ level: 'error', path: 'scenes', message: 'composition has no scenes' })

  const checkEntry = (e: { component: string; animate?: EntryAnimation[] }, path: string): void => {
    if (!registry[e.component])
      diags.push({
        level: 'error',
        path: `${path}.component`,
        message: `unknown component "${e.component}"`,
      })
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
    scene.tracks.forEach((track, ti) =>
      track.entries.forEach((e, ei) => checkEntry(e, `scenes[${si}].tracks[${ti}].entries[${ei}]`)),
    )
  })
  payload.layers?.forEach((layer, li) =>
    layer.entries.forEach((e, ei) => checkEntry(e, `layers[${li}].entries[${ei}]`)),
  )
  return diags
}
