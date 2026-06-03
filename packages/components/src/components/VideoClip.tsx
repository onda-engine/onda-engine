//! VideoClip — a trimmed video clip with the Onda fade envelope. Ported from ondajs.
//!
//! The engine has NO video decode pipeline, so this is a faithful *approximation*:
//! it renders a single POSTER frame as an `<Image>` and applies the same
//! fade-in/out envelope ondajs gives `<OffthreadVideo>`. Real frame-accurate
//! playback (`startAt`/`endAt` trim, `loop`, `muted`/`volume`) needs the engine's
//! video pipeline; until that exists, treat `src` as a still poster.
//!
//! Sizing: an `<Image>` draws from its decoded top-left at the node's local
//! origin, scaled only by the node transform — there is no `objectFit`. So `fit`
//! ('cover' / 'contain') is computed here from the poster's intrinsic size
//! (`sourceWidth`/`sourceHeight`, defaulting to the composition size so a
//! comp-resolution poster renders 1:1). The scaled poster is centered in the box
//! over a black backing `<Rect>`, with the whole thing clipped to the box so
//! 'cover' crops cleanly and 'contain' letterboxes against black. Optional
//! cinematic `letterbox` bars overlay top & bottom.
//!
//! Backend caveat: scale/rotation and image opacity render on the Vello/GPU
//! backend; the CPU reference rasterizer draws the poster unscaled at the origin.

import { Group, Image, Rect, clipRect, useCurrentFrame, useVideoConfig } from '@onda/react'
import { entryFade, exitFade } from '../choreography.js'
import { DURATION } from '../motion.js'
import { useTheme } from '../theme.js'

export interface VideoClipProps {
  /** URL or path to the POSTER image (the video pipeline is not yet implemented,
   *  so a still frame stands in for playback). Resolved at render time. */
  src: string
  /** Frames the clip waits before its fade-in begins (default 0). */
  delay?: number
  /** Frames the fade-in takes (default `DURATION.base` = 18). `0` = hard cut in. */
  fadeIn?: number
  /** Frames the fade-out takes (default `DURATION.base` = 18). `0` = hard cut out. */
  fadeOut?: number
  /** Visible hold of the clip in frames, used to time the fade-out (the fade-out
   *  lands on the last `fadeOut` frames). When omitted, the clip never fades out —
   *  mirrors ondajs skipping the fade-out when `endAt` is unset. */
  durationInFrames?: number
  /** How the poster fits its box. `'cover'` crops to fill (default); `'contain'`
   *  letterboxes against black. */
  fit?: 'cover' | 'contain'
  /** Box width in px the clip occupies (default = full composition width). */
  width?: number
  /** Box height in px the clip occupies (default = full composition height). */
  height?: number
  /** Top-left x of the box in px (default 0 — canvas-filling). */
  x?: number
  /** Top-left y of the box in px (default 0 — canvas-filling). */
  y?: number
  /** Rounded corner radius of the box in px (default: theme `radius`). */
  borderRadius?: number
  /** Draw cinematic black letterbox bars top & bottom, each this many px tall
   *  (default 0 = none). Drawn over the poster, inside the box. */
  letterbox?: number
  /** Backing color shown behind/around the poster (default: theme `background`). */
  backgroundColor?: string
}

export function VideoClip({
  src,
  delay = 0,
  fadeIn = DURATION.base,
  fadeOut = DURATION.base,
  durationInFrames,
  fit = 'cover',
  width,
  height,
  x = 0,
  y = 0,
  borderRadius: borderRadiusProp,
  letterbox = 0,
  backgroundColor: backgroundColorProp,
}: VideoClipProps) {
  const frame = useCurrentFrame()
  const { fps, width: compWidth, height: compHeight } = useVideoConfig()
  const theme = useTheme()
  const borderRadius = borderRadiusProp ?? theme.radius
  const backgroundColor = backgroundColorProp ?? theme.background

  // Box the clip fills — default is the whole composition (ondajs's fill default).
  const boxW = width ?? compWidth
  const boxH = height ?? compHeight

  // Fade envelope: fade-in via entryFade, fade-out via exitFade landing on the
  // last `fadeOut` frames of the visible hold. Skipping fade-out when the hold is
  // unknown matches ondajs (no `endAt` → no fade-out timing).
  const fadeInOpacity =
    fadeIn > 0
      ? entryFade({ frame, fps, delay, durationInFrames: fadeIn }).opacity
      : frame >= delay
        ? 1
        : 0
  let opacity = fadeInOpacity
  if (durationInFrames !== undefined && fadeOut > 0) {
    const fadeOutStart = delay + Math.max(0, durationInFrames - fadeOut)
    const fadeOutOpacity = exitFade({
      frame,
      delay: fadeOutStart,
      durationInFrames: fadeOut,
    }).opacity
    opacity = Math.min(opacity, fadeOutOpacity)
  }

  return (
    // Outer Group positions + fades the whole clip; clip masks to the box so
    // 'cover' crops and 'contain' letterboxes cleanly within rounded corners.
    <Group x={x} y={y} opacity={opacity} clip={clipRect(boxW, boxH, borderRadius)}>
      {/* Black backing so any uncovered area (contain) reads as letterbox. */}
      <Rect width={boxW} height={boxH} cornerRadius={borderRadius} fill={backgroundColor} />
      {/* The poster, fitted to the box by the renderer (cover crops, contain
          letterboxes against the backing). */}
      <Image src={src} width={boxW} height={boxH} fit={fit} />
      {/* Optional cinematic letterbox bars, top & bottom, inside the box. */}
      {letterbox > 0 ? (
        <Group>
          <Rect width={boxW} height={letterbox} fill="#000000" />
          <Rect width={boxW} height={letterbox} y={boxH - letterbox} fill="#000000" />
        </Group>
      ) : null}
    </Group>
  )
}
