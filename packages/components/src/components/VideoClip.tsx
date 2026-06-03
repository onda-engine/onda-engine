//! VideoClip — a trimmed video clip with the Onda fade envelope. Ported from ondajs.
//!
//! Real playback: a `<Video>` node draws the source frame at the current time
//! (decoded by the player in-browser via `<video>`/WebCodecs, or by `onda export`
//! via ffmpeg), wrapped in the same fade-in/out envelope ondajs gives
//! `<OffthreadVideo>`. `startAt` trims the head; `playbackRate` re-times it.
//!
//! Sizing: the frame is fitted into the box per `fit` ('cover' crops, 'contain'
//! letterboxes) by the renderer, centered over a black backing `<Rect>`, with the
//! whole thing clipped to the box (rounded corners supported). Optional cinematic
//! `letterbox` bars overlay top & bottom.
//!
//! Backend caveat: video decode + scale/opacity render on the Vello/GPU backend
//! (the player's default); the CPU reference rasterizer skips video frames.

import { Group, Rect, Video, clipRect, useCurrentFrame, useVideoConfig } from '@onda/react'
import { entryFade, exitFade } from '../choreography.js'
import { DURATION } from '../motion.js'
import { useTheme } from '../theme.js'

export interface VideoClipProps {
  /** URL or path to the video. The current frame is decoded per composition
   *  frame by the player (browser) or `onda export` (native ffmpeg). */
  src: string
  /** Seconds into the source shown at the clip's frame 0 (trim the head). Default 0. */
  startAt?: number
  /** Source seconds advanced per composition second (1 = realtime). Default 1. */
  playbackRate?: number
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
  startAt = 0,
  playbackRate = 1,
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
      {/* The current video frame, fitted to the box by the renderer (cover
          crops, contain letterboxes against the backing). */}
      <Video
        src={src}
        startFrom={startAt}
        playbackRate={playbackRate}
        width={boxW}
        height={boxH}
        fit={fit}
      />
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
