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
import { Group } from './components.js'
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
