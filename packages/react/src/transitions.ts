//! Transitions between sequences — `<TransitionSeries>`.
//!
//! Like `<Series>`, but consecutive sequences can *overlap* by a transition's
//! duration, during which the outgoing scene animates out and the incoming one
//! animates in. Built entirely on the existing primitives: a transition is just
//! `opacity` (fade), `translate` (slide), or a `clip` mask (wipe) driven by the
//! transition's progress — no engine support needed.
//!
//! ```tsx
//! <TransitionSeries>
//!   <TransitionSeries.Sequence durationInFrames={60}><A /></TransitionSeries.Sequence>
//!   <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 20 })} />
//!   <TransitionSeries.Sequence durationInFrames={60}><B /></TransitionSeries.Sequence>
//! </TransitionSeries>
//! ```

import { Children, type ReactElement, type ReactNode, createElement, isValidElement } from 'react'
import { clipEllipse, clipPath, clipRect } from './clip.js'
import { Group, Rect } from './components.js'
import { useCurrentFrame, useVideoConfig } from './frame.js'
import { Sequence } from './sequence.js'
import { type SpringConfig, spring } from './spring.js'

// ---------------------------------------------------------------------------
// Timings — how a transition's progress evolves over its duration.
// ---------------------------------------------------------------------------

/** Maps a frame within a transition to progress `0..1` (may overshoot 1 for
 *  springs). `durationInFrames` is how long the transition (overlap) lasts. */
export interface TransitionTiming {
  durationInFrames: number
  getProgress(frame: number, fps: number): number
}

/** A linear transition over `durationInFrames`. */
export function linearTiming({ durationInFrames }: { durationInFrames: number }): TransitionTiming {
  return {
    durationInFrames,
    getProgress: (frame) =>
      durationInFrames <= 0 ? 1 : Math.min(1, Math.max(0, frame / durationInFrames)),
  }
}

/** A spring-driven transition (natural ease, optional overshoot). */
export function springTiming({
  durationInFrames = 30,
  config,
}: {
  durationInFrames?: number
  config?: SpringConfig
} = {}): TransitionTiming {
  return {
    durationInFrames,
    getProgress: (frame, fps) => Math.max(0, spring({ frame, fps, config })),
  }
}

// ---------------------------------------------------------------------------
// Presentations — how the entering/exiting scenes look at a given progress.
// ---------------------------------------------------------------------------

/** Which edge a slide/wipe moves from. */
export type SlideDirection = 'from-left' | 'from-right' | 'from-top' | 'from-bottom'

export interface PresentationState {
  /** Transition progress `0..1` (0 = fully out, 1 = fully in). */
  progress: number
  /** True for the incoming scene, false for the outgoing one. */
  entering: boolean
  width: number
  height: number
}

/** Wraps a scene to present it at a point in a transition. Identity at the
 *  resting state (entering progress 1 / exiting progress 0). */
export type TransitionPresentation = (children: ReactNode, state: PresentationState) => ReactElement

/** Cross-fade via opacity. */
export function fade(): TransitionPresentation {
  return (children, { progress, entering }) =>
    createElement(Group, { opacity: entering ? progress : 1 - progress }, children)
}

/** Slide the scenes across; `direction` is where the incoming scene comes from. */
export function slide({
  direction = 'from-right',
}: { direction?: SlideDirection } = {}): TransitionPresentation {
  return (children, { progress, entering, width, height }) => {
    const axisX = direction === 'from-left' || direction === 'from-right'
    const span = axisX ? width : height
    const sign = direction === 'from-right' || direction === 'from-bottom' ? 1 : -1
    // Entering: starts off-screen on `direction`'s edge, slides to 0.
    // Exiting: slides off the opposite edge in lock-step with the incoming one.
    const offset = entering ? (1 - progress) * span * sign : -progress * span * sign
    const props = axisX ? { x: offset } : { y: offset }
    return createElement(Group, props, children)
  }
}

/** Wipe the incoming scene over the outgoing one with a growing clip mask. */
export function wipe({
  direction = 'from-left',
}: { direction?: SlideDirection } = {}): TransitionPresentation {
  return (children, { progress, entering, width, height }) => {
    // The incoming scene is masked (it reveals over the outgoing one). The
    // outgoing scene fades out faster than the wipe completes — so it doesn't
    // linger at full opacity beneath an incoming scene that has transparent
    // areas (otherwise the old scene bleeds through the new one's gaps). Gone
    // by ~60% of the wipe.
    if (!entering) {
      const fade = Math.max(0, 1 - progress / 0.6)
      return createElement(Group, { opacity: fade }, children)
    }
    const p = Math.min(1, Math.max(0, progress))
    switch (direction) {
      case 'from-left':
        return createElement(Group, { clip: clipRect(width * p, height) }, children)
      case 'from-top':
        return createElement(Group, { clip: clipRect(width, height * p) }, children)
      case 'from-right': {
        // Reveal the rightmost p·W: shift content left, clip at the origin, shift back.
        const w = width * p
        return createElement(
          Group,
          { x: width - w },
          createElement(Group, { x: -(width - w), clip: clipRect(w, height) }, children),
        )
      }
      case 'from-bottom': {
        const h = height * p
        return createElement(
          Group,
          { y: height - h },
          createElement(Group, { y: -(height - h), clip: clipRect(width, h) }, children),
        )
      }
    }
  }
}

/** A hard cut — the overlap timing with no visual effect. The incoming scene
 *  (drawn on top) simply replaces the outgoing one. */
export function none(): TransitionPresentation {
  return (children) => createElement(Group, {}, children)
}

/** Scale `children` by (sx, sy) about the pivot `(px, py)` — translate to the
 *  pivot, scale, then translate back (node scale pivots on the local origin). */
function scaleAbout(
  children: ReactNode,
  sx: number,
  sy: number,
  px: number,
  py: number,
): ReactElement {
  return createElement(
    Group,
    { x: px, y: py },
    createElement(
      Group,
      { scaleX: sx, scaleY: sy },
      createElement(Group, { x: -px, y: -py }, children),
    ),
  )
}

/** A 2D card flip: the outgoing scene collapses horizontally to the centre line
 *  by the midpoint, then the incoming scene expands out of it. */
export function flip(): TransitionPresentation {
  return (children, { progress, entering, width, height }) => {
    const sx = entering
      ? Math.max(0, progress * 2 - 1) // incoming expands over the back half
      : Math.max(0, 1 - progress * 2) // outgoing collapses over the front half
    return scaleAbout(children, sx, 1, width / 2, height / 2)
  }
}

const round = (n: number): number => Math.round(n * 1000) / 1000

/** Iris: a circular reveal of the incoming scene expanding from the centre. The
 *  outgoing scene stays full beneath it (the incoming draws on top). */
export function iris(): TransitionPresentation {
  return (children, { progress, entering, width, height }) => {
    if (!entering || progress >= 1) return createElement(Group, {}, children)
    if (progress <= 0) return createElement(Group, { opacity: 0 }, children)
    const cx = width / 2
    const cy = height / 2
    const r = progress * Math.hypot(cx, cy) // cover the corners at progress 1
    // Centre a 2r×2r ellipse clip on (cx,cy): translate the clipped group to the
    // clip box's origin, then untranslate the children back (cf. `wipe`).
    return createElement(
      Group,
      { x: cx - r, y: cy - r, clip: clipEllipse(2 * r, 2 * r) },
      createElement(Group, { x: -(cx - r), y: -(cy - r) }, children),
    )
  }
}

/** Clock wipe: an angular sweep revealing the incoming scene clockwise from 12
 *  o'clock. Outgoing stays full beneath (the incoming draws on top). The wedge is
 *  a polygon fan (M/L/Z only — no arc command) so it clips on any path renderer. */
export function clockWipe(): TransitionPresentation {
  return (children, { progress, entering, width, height }) => {
    if (!entering || progress >= 1) return createElement(Group, {}, children)
    if (progress <= 0) return createElement(Group, { opacity: 0 }, children)
    const cx = width / 2
    const cy = height / 2
    const r = Math.hypot(cx, cy) // reach the corners
    const theta = progress * Math.PI * 2 // clockwise from the top
    const steps = Math.max(2, Math.ceil((theta / (Math.PI * 2)) * 64))
    let d = `M ${round(cx)} ${round(cy)}`
    for (let i = 0; i <= steps; i++) {
      const a = (theta * i) / steps
      d += ` L ${round(cx + r * Math.sin(a))} ${round(cy - r * Math.cos(a))}`
    }
    d += ' Z'
    return createElement(Group, { clip: clipPath(d) }, children)
  }
}

export type PushDirection = 'left' | 'right' | 'up' | 'down'

const PUSH_VECTOR: Record<PushDirection, { x: number; y: number }> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
}

/** Both scenes translate together in `direction`, like a camera pan. */
export function push({
  direction = 'left',
}: { direction?: PushDirection } = {}): TransitionPresentation {
  return (children, { progress, entering, width, height }) => {
    const { x, y } = PUSH_VECTOR[direction]
    const tx = (entering ? -x * (1 - progress) : x * progress) * width
    const ty = (entering ? -y * (1 - progress) : y * progress) * height
    return createElement(Group, { x: tx, y: ty }, children)
  }
}

/** Scale-and-fade punch. `direction` 'in' pushes toward the viewer, 'out' pulls back. */
export function zoom({
  direction = 'in',
  scaleAmount = 0.2,
}: { direction?: 'in' | 'out'; scaleAmount?: number } = {}): TransitionPresentation {
  return (children, { progress, entering, width, height }) => {
    const s = scaleAmount
    let scale: number
    if (direction === 'in') {
      scale = entering ? 1 + s / 2 - (s / 2) * progress : 1 + s * progress
    } else {
      scale = entering ? 1 - s / 2 + (s / 2) * progress : 1 - s * progress
    }
    const opacity = entering ? progress : 1 - progress
    return createElement(
      Group,
      { opacity },
      scaleAbout(children, scale, scale, width / 2, height / 2),
    )
  }
}

/** Push with parallax depth — a scale layered on the translate (a camera dolly). */
export function depthPush({
  direction = 'left',
  scaleAmount = 0.08,
}: { direction?: PushDirection; scaleAmount?: number } = {}): TransitionPresentation {
  return (children, { progress, entering, width, height }) => {
    const { x, y } = PUSH_VECTOR[direction]
    const tx = (entering ? -x * (1 - progress) : x * progress) * width
    const ty = (entering ? -y * (1 - progress) : y * progress) * height
    const scale = entering ? 1 + scaleAmount * (1 - progress) : 1 - scaleAmount * progress
    return createElement(
      Group,
      { x: tx, y: ty },
      scaleAbout(children, scale, scale, width / 2, height / 2),
    )
  }
}

/** Outgoing fades to `color`, incoming fades up from it (dip-to-black/white). */
export function dipToColor({ color = '#08080a' }: { color?: string } = {}): TransitionPresentation {
  return (children, { progress, entering, width, height }) => {
    const sceneOpacity = entering ? Math.max(0, progress * 2 - 1) : Math.max(0, 1 - progress * 2)
    const colorOpacity = entering
      ? Math.max(0, 1 - (progress - 0.5) * 2)
      : Math.min(1, progress * 2)
    return createElement(
      Group,
      null,
      createElement(Group, { opacity: sceneOpacity }, children),
      createElement(
        Group,
        { opacity: colorOpacity },
        createElement(Rect, { width, height, fill: color }),
      ),
    )
  }
}

// ---------------------------------------------------------------------------
// Effect transitions — approximated in the presentation layer (no engine blur).
// `blur`/`glassWipe` use a multi-tap smear (`blurStack`); the rest are
// transform/clip tricks. Crude vs a true Gaussian, but convincing at transition
// speed and zero engine cost.
// ---------------------------------------------------------------------------

// Ring of unit offsets; a tap is drawn at each, scaled by the blur radius, so the
// copies smear into a soft blur. (A true Gaussian would need an engine pass.)
const BLUR_RING: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.7, 0.7],
  [-0.7, 0.7],
  [0.7, -0.7],
  [-0.7, -0.7],
]

/** Draw `children` at each ring offset (scaled by `radius`) at equal opacity so
 *  the copies sum to a soft blur. `radius` ≤ ~0.5px → a single sharp draw. */
function blurStack(children: ReactNode, radius: number): ReactElement {
  if (radius <= 0.5) return createElement(Group, {}, children)
  const op = 1 / BLUR_RING.length
  return createElement(
    Group,
    {},
    ...BLUR_RING.map(([dx, dy], i) =>
      createElement(Group, { key: i, x: dx * radius, y: dy * radius, opacity: op }, children),
    ),
  )
}

/** Blur cross: each scene blurs toward the midpoint and sharpens at rest, with an
 *  opacity cross. (Multi-tap approximation — see {@link blurStack}.) */
export function blur({ maxBlur = 24 }: { maxBlur?: number } = {}): TransitionPresentation {
  return (children, { progress, entering }) => {
    const sharp = entering ? progress : 1 - progress // 1 at rest
    return createElement(
      Group,
      { opacity: entering ? progress : 1 - progress },
      blurStack(children, (1 - sharp) * maxBlur),
    )
  }
}

/** Motion-blur smear: render copies offset ALONG (dx,dy) — a directional swish,
 *  unlike {@link blurStack}'s isotropic ring. Used by {@link whipPan}. */
function directionalSmear(
  children: ReactNode,
  dx: number,
  dy: number,
  radius: number,
): ReactElement {
  if (radius <= 0.5) return createElement(Group, {}, children)
  const N = 6
  const op = 1 / N
  return createElement(
    Group,
    {},
    ...Array.from({ length: N }, (_, i) => {
      const t = (i / (N - 1) - 0.5) * 2 // -1..1 along the axis
      return createElement(
        Group,
        { key: i, x: dx * t * radius, y: dy * t * radius, opacity: op },
        children,
      )
    }),
  )
}

/** Zoom-blur / "smooth zoom" — the punch-in (or -out) with a motion-blur smear
 *  heaviest mid-transition, snapping sharp at rest, with an opacity cross. The
 *  most-used viral/social transition. `direction` 'in' rushes toward the viewer,
 *  'out' pulls back. */
export function zoomBlur({
  direction = 'in',
  scaleAmount = 0.35,
  maxBlur = 28,
}: {
  direction?: 'in' | 'out'
  scaleAmount?: number
  maxBlur?: number
} = {}): TransitionPresentation {
  return (children, { progress, entering, width, height }) => {
    const s = scaleAmount
    const dirSign = direction === 'in' ? 1 : -1
    // Entering settles to 1 from an over/under-scale; exiting departs from 1.
    const scale = entering ? 1 + dirSign * s * (1 - progress) : 1 + dirSign * s * progress
    const sharp = entering ? progress : 1 - progress // 1 at rest
    const opacity = entering ? progress : 1 - progress
    return createElement(
      Group,
      { opacity },
      scaleAbout(blurStack(children, (1 - sharp) * maxBlur), scale, scale, width / 2, height / 2),
    )
  }
}

/** Whip-pan — a fast directional swish with a motion-blur smear ALONG the pan
 *  axis (the high-energy "camera whip" cut, best paired with a whoosh SFX).
 *  `direction` is where the camera swings toward (left/right/up/down). */
export function whipPan({
  direction = 'left',
  maxBlur = 40,
}: { direction?: PushDirection; maxBlur?: number } = {}): TransitionPresentation {
  return (children, { progress, entering, width, height }) => {
    const { x, y } = PUSH_VECTOR[direction]
    const tx = (entering ? -x * (1 - progress) : x * progress) * width
    const ty = (entering ? -y * (1 - progress) : y * progress) * height
    const sharp = entering ? progress : 1 - progress
    return createElement(
      Group,
      { x: tx, y: ty },
      directionalSmear(children, x, y, (1 - sharp) * maxBlur),
    )
  }
}

/** Chromatic split: the scene tears into horizontally offset ghosts that spread
 *  at the midpoint and converge at rest (an RGB-fringe feel — the engine has no
 *  per-channel tint, so the copies are uncoloured). */
export function chromaticAberration({
  maxShift = 22,
}: { maxShift?: number } = {}): TransitionPresentation {
  return (children, { progress, entering }) => {
    const sharp = entering ? progress : 1 - progress
    const d = (1 - sharp) * maxShift
    const opacity = entering ? progress : 1 - progress
    if (d <= 0.5) return createElement(Group, { opacity }, children)
    return createElement(
      Group,
      { opacity },
      createElement(Group, { x: -d, opacity: 0.5 }, children),
      createElement(Group, { x: d, opacity: 0.5 }, children),
      createElement(Group, {}, children),
    )
  }
}

/** Device pullback: the outgoing scene shrinks back (and lifts) as if pulled into
 *  the distance, uncovering the incoming scene that settles forward into place. */
export function devicePullback(): TransitionPresentation {
  return (children, { progress, entering, width, height }) => {
    if (entering) {
      const scale = 1.12 - 0.12 * progress
      return createElement(
        Group,
        { opacity: progress },
        scaleAbout(children, scale, scale, width / 2, height / 2),
      )
    }
    const scale = 1 - 0.45 * progress
    return createElement(
      Group,
      { opacity: 1 - progress, y: -progress * height * 0.06 },
      scaleAbout(children, scale, scale, width / 2, height / 2),
    )
  }
}

/** Expand morph: the incoming scene bursts open from the centre while the
 *  outgoing one balloons out and dissolves — a quick morph-expand. */
export function expandMorph(): TransitionPresentation {
  return (children, { progress, entering, width, height }) => {
    if (entering) {
      const scale = 0.3 + 0.7 * progress
      return createElement(
        Group,
        { opacity: Math.min(1, progress * 1.5) },
        scaleAbout(children, scale, scale, width / 2, height / 2),
      )
    }
    const scale = 1 + 0.5 * progress
    return createElement(
      Group,
      { opacity: 1 - progress },
      scaleAbout(children, scale, scale, width / 2, height / 2),
    )
  }
}

/** Morph: a soft scale-and-fade blend — the scenes ease through each other with a
 *  gentle breathing scale. */
export function morph(): TransitionPresentation {
  return (children, { progress, entering, width, height }) => {
    const scale = entering ? 0.94 + 0.06 * progress : 1 + 0.06 * progress
    return createElement(
      Group,
      { opacity: entering ? progress : 1 - progress },
      scaleAbout(children, scale, scale, width / 2, height / 2),
    )
  }
}

/** Glass wipe: the incoming scene reveals behind a sweeping edge and blurs sharp
 *  as the "frosted panel" passes (blur is the {@link blurStack} approximation). */
export function glassWipe({
  direction = 'from-left',
}: { direction?: SlideDirection } = {}): TransitionPresentation {
  return (children, { progress, entering, width, height }) => {
    if (!entering)
      return createElement(Group, { opacity: Math.max(0, 1 - progress / 0.7) }, children)
    const p = Math.min(1, Math.max(0, progress))
    const frosted = blurStack(children, (1 - p) * 18)
    switch (direction) {
      case 'from-top':
        return createElement(Group, { clip: clipRect(width, height * p) }, frosted)
      case 'from-right': {
        const w = width * p
        return createElement(
          Group,
          { x: width - w },
          createElement(Group, { x: -(width - w), clip: clipRect(w, height) }, frosted),
        )
      }
      case 'from-bottom': {
        const h = height * p
        return createElement(
          Group,
          { y: height - h },
          createElement(Group, { y: -(height - h), clip: clipRect(width, h) }, frosted),
        )
      }
      default:
        return createElement(Group, { clip: clipRect(width * p, height) }, frosted)
    }
  }
}

// Deterministic per-cell phase for the grid scatter (a hashed fract, stable
// across renders — no Math.random, so the reveal is identical every frame).
function cellPhase(i: number, j: number): number {
  const n = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453
  return n - Math.floor(n)
}

/** Grid pixelate: the incoming scene fills in as a grid of blocks, each popping
 *  on in a deterministic scatter (a blocky reveal — true pixelation needs an
 *  engine sampling pass). */
export function gridPixelate({
  cols = 16,
  rows = 9,
}: { cols?: number; rows?: number } = {}): TransitionPresentation {
  return (children, { progress, entering, width, height }) => {
    if (!entering)
      return createElement(Group, { opacity: Math.max(0, 1 - progress / 0.7) }, children)
    if (progress >= 1) return createElement(Group, {}, children)
    if (progress <= 0) return createElement(Group, { opacity: 0 }, children)
    const cw = width / cols
    const ch = height / rows
    let d = ''
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if (cellPhase(i, j) < progress) {
          const x = round(i * cw)
          const y = round(j * ch)
          d += `M ${x} ${y} L ${round(x + cw)} ${y} L ${round(x + cw)} ${round(y + ch)} L ${x} ${round(y + ch)} Z `
        }
      }
    }
    if (d === '') return createElement(Group, { opacity: 0 }, children)
    return createElement(Group, { clip: clipPath(d) }, children)
  }
}

/** Type mask: the incoming scene reveals through a row of vertical bars that
 *  widen into place — a typographic blinds reveal. */
export function typeMask({ bars = 12 }: { bars?: number } = {}): TransitionPresentation {
  return (children, { progress, entering, width, height }) => {
    if (!entering)
      return createElement(Group, { opacity: Math.max(0, 1 - progress / 0.7) }, children)
    if (progress >= 1) return createElement(Group, {}, children)
    if (progress <= 0) return createElement(Group, { opacity: 0 }, children)
    const slot = width / bars
    const w = round(slot * Math.min(1, progress))
    let d = ''
    for (let i = 0; i < bars; i++) {
      const x = round(i * slot)
      d += `M ${x} 0 L ${round(x + w)} 0 L ${round(x + w)} ${round(height)} L ${x} ${round(height)} Z `
    }
    return createElement(Group, { clip: clipPath(d) }, children)
  }
}

/** Alias of {@link fade} — Studio's "cross-fade" slug. */
export const crossFade = fade

// ---------------------------------------------------------------------------
// <TransitionSeries>
// ---------------------------------------------------------------------------

export interface TransitionSeriesSequenceProps {
  durationInFrames: number
  children?: ReactNode
}

export interface TransitionSeriesTransitionProps {
  presentation: TransitionPresentation
  timing: TransitionTiming
}

// Marker components; never rendered directly — <TransitionSeries> reads props.
function TransitionSequence(_props: TransitionSeriesSequenceProps): ReactElement | null {
  return null
}
function TransitionTransition(_props: TransitionSeriesTransitionProps): ReactElement | null {
  return null
}

/** Renders one sequence's content with its entering/exiting presentations
 *  applied, reading the (sequence-local) frame to compute progress. */
function TransitionItem({
  duration,
  enter,
  exit,
  children,
}: {
  duration: number
  enter?: { presentation: TransitionPresentation; timing: TransitionTiming }
  exit?: { presentation: TransitionPresentation; timing: TransitionTiming }
  children: ReactNode
}): ReactElement {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()

  let content: ReactNode = children
  if (exit) {
    const t = exit.timing.durationInFrames
    const start = duration - t
    const progress = frame >= start ? exit.timing.getProgress(frame - start, fps) : 0
    content = exit.presentation(content, { progress, entering: false, width, height })
  }
  if (enter) {
    const t = enter.timing.durationInFrames
    const progress = frame < t ? enter.timing.getProgress(frame, fps) : 1
    content = enter.presentation(content, { progress, entering: true, width, height })
  }
  return createElement(Group, null, content)
}

function TransitionSeriesRoot({ children }: { children?: ReactNode }): ReactElement {
  // Flatten children into an alternating [seq, (transition, seq)*] list.
  const items = Children.toArray(children).filter(isValidElement)
  const sequences: TransitionSeriesSequenceProps[] = []
  const transitions: (TransitionSeriesTransitionProps | null)[] = [] // transition AFTER sequence i

  for (const el of items) {
    if (el.type === TransitionSequence) {
      sequences.push(el.props as TransitionSeriesSequenceProps)
      transitions.push(null)
    } else if (el.type === TransitionTransition) {
      if (sequences.length === 0 || transitions[transitions.length - 1] != null) {
        throw new Error('<TransitionSeries.Transition> must sit between two sequences')
      }
      transitions[transitions.length - 1] = el.props as TransitionSeriesTransitionProps
    } else {
      throw new Error(
        '<TransitionSeries> children must be <TransitionSeries.Sequence> or .Transition',
      )
    }
  }

  // Place each sequence; a transition before a sequence overlaps it by its duration.
  let offset = 0
  const rendered: ReactElement[] = []
  for (const [i, seq] of sequences.entries()) {
    const before = i > 0 ? (transitions[i - 1] ?? null) : null
    const after = transitions[i] ?? null
    const enter = before ? { presentation: before.presentation, timing: before.timing } : undefined
    const exit = after ? { presentation: after.presentation, timing: after.timing } : undefined

    rendered.push(
      createElement(
        Sequence,
        { key: i, from: offset, durationInFrames: seq.durationInFrames },
        createElement(TransitionItem, {
          duration: seq.durationInFrames,
          enter,
          exit,
          children: seq.children,
        }),
      ),
    )

    offset += seq.durationInFrames - (after ? after.timing.durationInFrames : 0)
  }

  return createElement(Group, null, ...rendered)
}

/** Play sequences back-to-back with overlapping transitions between them. */
export const TransitionSeries = Object.assign(TransitionSeriesRoot, {
  Sequence: TransitionSequence,
  Transition: TransitionTransition,
})
