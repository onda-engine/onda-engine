//! KenBurns — a slow cinematic zoom + pan over a photo (the iconic documentary
//! motion). Ported from ondajs.
//!
//! Intentionally **linear** (no spring, no easing) for a constant slow-cinematic
//! drift. Springs/eases at this multi-second scale read as "the camera is
//! accelerating" — wrong for Ken Burns, which is steady throughout. So this is
//! one of the few components that interpolates frame→progress directly rather
//! than reaching for the choreography vocabulary.
//!
//! Engine model vs ondajs CSS. ondajs renders an `<Img>` with `objectFit: cover`,
//! then `transform: scale(s)` about a `transformOrigin`. The engine's `<Image>`
//! now takes a `width`/`height` box and `fit="cover"`, so the renderer (which
//! measures the decoded image) makes the photo fill the composition for ANY
//! source aspect — no more guessing the image size. We layer the Ken Burns zoom
//! on top, scaling about the pan origin (a fraction of the viewport). Engine
//! scale pivots on a node's LOCAL origin (0,0), so the pivot is applied via
//! translate-in / scale / translate-back. The outer `<Group clip>` masks the
//! zoomed image to the composition (ondajs's `overflow: hidden`).
//!
//! Approximation: ondajs supports a `placement` box to sit the effect in a
//! sub-region; the engine has no equivalent layout primitive here, so this port
//! always fills the full composition (the ondajs default, `placement` omitted).

import { Group, Image, interpolate, useCurrentFrame, useVideoConfig } from '@onda/react'
import { type TimeInput, framesOf } from '../time.js'

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export interface KenBurnsProps {
  /** Image source (resolved at render time by `onda render`). */
  src: string
  /** Frames before the drift starts. */
  delay?: TimeInput
  /** Frames over which the zoom + pan completes. 150f ≈ 5s @ 30fps. */
  duration?: TimeInput
  /** Starting scale (atop the cover fit). Default 1.0. */
  fromScale?: number
  /** Ending scale — keep the delta restrained (1.0 → 1.1). Default 1.1. */
  toScale?: number
  /** Starting pan origin X. `0` = left, `1` = right. Default 0.5 (center). */
  fromX?: number
  /** Starting pan origin Y. `0` = top, `1` = bottom. Default 0.5 (center). */
  fromY?: number
  /** Ending pan origin X. Default 0.5. */
  toX?: number
  /** Ending pan origin Y. Default 0.5. */
  toY?: number
}

export function KenBurns({
  src,
  delay: delayIn = 0,
  duration: durationIn = 150,
  fromScale = 1.0,
  toScale = 1.1,
  fromX = 0.5,
  fromY = 0.5,
  toX = 0.5,
  toY = 0.5,
}: KenBurnsProps) {
  const frame = useCurrentFrame()
  const { width: compWidth, height: compHeight, fps } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const duration = framesOf(durationIn, fps)

  // Linear progress 0 → 1 across [delay, delay + duration]. No spring, no easing
  // (see header) — the steady drift is the whole point. Guard duration ≥ 1.
  const span = duration > 0 ? duration : 1
  const progress = interpolate(frame - delay, [0, span], [0, 1], CLAMP)

  // Ken Burns zoom and the panning origin, all linear.
  const zoom = interpolate(progress, [0, 1], [fromScale, toScale], CLAMP)
  const originX = interpolate(progress, [0, 1], [fromX, toX], CLAMP)
  const originY = interpolate(progress, [0, 1], [fromY, toY], CLAMP)

  // Zoom pivot: the pan origin as a point in the viewport. Scaling about it keeps
  // that point fixed as the image zooms, so animating the origin pans the frame.
  const pivotX = originX * compWidth
  const pivotY = originY * compHeight

  // NB: KenBurns ALWAYS fills the full composition, so the over-scanned zoom is
  // already masked by the canvas — no wrapping `<Group clip>` is needed. (That
  // clip also tripped a renderer bug where a clip layer occludes LATER siblings,
  // so text/graphics placed over a KenBurns in the same scene vanished.)
  return (
    <Group x={pivotX} y={pivotY}>
      <Group scaleX={zoom} scaleY={zoom}>
        <Group x={-pivotX} y={-pivotY}>
          {/* The renderer covers the photo to the composition box for any source
              aspect (measures the decoded image — no intrinsic size needed). */}
          <Image src={src} width={compWidth} height={compHeight} fit="cover" />
        </Group>
      </Group>
    </Group>
  )
}
