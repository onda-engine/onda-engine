//! Frame context + hooks. The engine renders a composition once per frame, with
//! the current frame supplied via React context; components read it with
//! {@link useCurrentFrame} and compute props from it (Remotion's model).

import { createContext, useContext } from 'react'

/** Resolution and timing of the composition being rendered. */
export interface VideoConfig {
  width: number
  height: number
  fps: number
  durationInFrames: number
}

interface FrameState extends VideoConfig {
  frame: number
}

/** @internal Provided by the renderer for each frame. */
export const FrameContext = createContext<FrameState | null>(null)

function useFrameState(hook: string): FrameState {
  const state = useContext(FrameContext)
  if (state === null) {
    throw new Error(
      `${hook} must be called inside a <Composition> rendered by renderFrame/renderFrames`,
    )
  }
  return state
}

/** The frame currently being rendered (0-based). */
export function useCurrentFrame(): number {
  return useFrameState('useCurrentFrame').frame
}

/** The composition's resolution and timing. */
export function useVideoConfig(): VideoConfig {
  const { width, height, fps, durationInFrames } = useFrameState('useVideoConfig')
  return { width, height, fps, durationInFrames }
}
