//! Scrim — a flat, full-frame, semi-transparent color veil. Drop it OVER a busy
//! photo/video (and UNDER the text) to mute the image just enough that overlaid
//! type reads — "not too white, not too dark." A light scrim lifts a dark photo;
//! a dark scrim deepens a bright one. The point isn't to show the picture
//! perfectly — it's legibility.
import { interpolate, Rect, useCurrentFrame, useVideoConfig } from '@onda/react'

export interface ScrimProps {
  /** Veil color (hex). Default white — lifts a busy photo so dark text reads. */
  color?: string
  /** Veil strength 0..1 (default 0.3). */
  opacity?: number
  /** Frames before it appears. */
  delay?: number
  /** Fade the veil in over the first 8 frames (default true). */
  fadeIn?: boolean
}

export function Scrim({ color = '#ffffff', opacity = 0.3, delay = 0, fadeIn = true }: ScrimProps) {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const o = fadeIn
    ? interpolate(frame, [delay, delay + 8], [0, opacity], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : opacity
  return <Rect x={0} y={0} width={width} height={height} fill={color} opacity={o} />
}
