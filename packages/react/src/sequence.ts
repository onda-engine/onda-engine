//! Time-shifting composition primitives — `<Sequence>`, `<Series>`, `<Loop>`.
//!
//! These manipulate the frame context: children inside a `<Sequence from={N}>`
//! see `useCurrentFrame()` shifted by `-N` and render only within their window.
//! This is Remotion's compositional grammar, the way you assemble a timeline.

import {
  Children,
  Fragment,
  type ReactElement,
  type ReactNode,
  createElement,
  isValidElement,
  useContext,
} from 'react'
import { FrameContext } from './frame.js'

export interface SequenceProps {
  /** Frame at which this sequence starts (children's frame 0). Default 0. */
  from?: number
  /** How many frames it lasts; unbounded if omitted. */
  durationInFrames?: number
  children?: ReactNode
}

/** Shift children in time: inside, the frame is `outerFrame - from`, and the
 *  children render only while `0 <= localFrame < durationInFrames`. */
export function Sequence({
  from = 0,
  durationInFrames,
  children,
}: SequenceProps): ReactElement | null {
  const ctx = useContext(FrameContext)
  if (!ctx) return null
  const local = ctx.frame - from
  const visible = local >= 0 && (durationInFrames === undefined || local < durationInFrames)
  if (!visible) return null
  return createElement(FrameContext.Provider, { value: { ...ctx, frame: local } }, children)
}

export interface LoopProps {
  /** Length of one loop iteration in frames. */
  durationInFrames: number
  children?: ReactNode
}

/** Repeat children forever: children see `frame % durationInFrames`. */
export function Loop({ durationInFrames, children }: LoopProps): ReactElement | null {
  const ctx = useContext(FrameContext)
  if (!ctx || durationInFrames <= 0) return null
  const local = ((ctx.frame % durationInFrames) + durationInFrames) % durationInFrames
  return createElement(FrameContext.Provider, { value: { ...ctx, frame: local } }, children)
}

export interface SeriesSequenceProps {
  durationInFrames: number
  children?: ReactNode
}

// Marker element; never rendered directly — `<Series>` reads its props.
function SeriesSequence(_props: SeriesSequenceProps): ReactElement | null {
  return null
}

interface SeriesProps {
  children?: ReactNode
}

/** Play `<Series.Sequence>` children back-to-back: each starts where the
 *  previous ended (cumulative offsets from their `durationInFrames`). */
function SeriesRoot({ children }: SeriesProps): ReactElement {
  let offset = 0
  const items = Children.map(children, (child) => {
    if (!isValidElement(child) || child.type !== SeriesSequence) {
      throw new Error('<Series> children must be <Series.Sequence>')
    }
    const props = child.props as SeriesSequenceProps
    const element = createElement(
      Sequence,
      { from: offset, durationInFrames: props.durationInFrames },
      props.children,
    )
    offset += props.durationInFrames
    return element
  })
  return createElement(Fragment, null, items)
}

/** `<Series>` with `<Series.Sequence durationInFrames={…}>` children. */
export const Series = Object.assign(SeriesRoot, { Sequence: SeriesSequence })
