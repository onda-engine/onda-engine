//! PathMorph — the "magic move": one filled SVG shape continuously morphing into
//! another. Backed by `@onda/react`'s `morphPath` (flubber under the hood, which
//! solves point CORRESPONDENCE so the morph never tears). Feed two `d` strings in
//! the SAME coordinate space; it animates the in-between path over
//! `durationInFrames` after `delay`, and is positioned/scaled into the
//! composition by `x` / `y` (the morph's local origin) and `scale`.
//!
//! Backend caveat: like `<Path>`, this renders on the Vello/GPU backend; the CPU
//! reference degrades (no path fills).
import { Group, Path, interpolate, morphPath, useCurrentFrame } from '@onda/react'
import { DURATION } from '../motion.js'
import { useTheme } from '../theme.js'

export interface PathMorphProps {
  /** SVG path `d` to morph FROM (e.g. a logo emblem), in its own coordinate space. */
  from: string
  /** SVG path `d` to morph TO (e.g. a divider line), in the SAME coordinate space. */
  to: string
  /** Fill color (hex). Defaults to theme `text`. */
  color?: string
  /** Frames before the `from` shape appears. */
  delay?: number
  /** Frames to HOLD the `from` shape (recognizable) before the morph begins. */
  holdFrames?: number
  /** Frames the morph itself takes (default `DURATION.slow` = 24). */
  durationInFrames?: number
  /** Composition position of the morph's local origin. */
  x?: number
  y?: number
  /** Uniform scale of the path's coordinate space. */
  scale?: number
  /** Fade the shape in over the first 8 frames (default true). */
  fadeIn?: boolean
}

export function PathMorph({
  from,
  to,
  color,
  delay = 0,
  durationInFrames,
  x = 0,
  y = 0,
  scale = 1,
  fadeIn = true,
}: PathMorphProps) {
  const frame = useCurrentFrame()
  const theme = useTheme()
  const dur = durationInFrames ?? DURATION.slow
  const t = interpolate(frame, [delay, delay + dur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const d = morphPath(from, to, t)
  const opacity = fadeIn
    ? interpolate(frame, [delay, delay + 8], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 1
  return (
    <Group x={x} y={y} opacity={opacity}>
      <Group scaleX={scale} scaleY={scale}>
        <Path d={d} fill={color ?? theme.text} />
      </Group>
    </Group>
  )
}
