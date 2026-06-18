//! LogoReveal — a premium reveal for a RASTER (PNG/JPG) logo. The companion to
//! `DrawOn` / `LogoSting`, which need SVG paths and are useless with a client's
//! bitmap logo (the 95% case). The logo is drawn `fit="contain"` so it never
//! crops, CENTERED on the canvas, and animated in on the house spring.
//!
//! Three presets:
//! - `focus` (default) — a soft→sharp FOCUS PULL: the engine's Image `blur` sigma
//!   animates 14→0 while opacity 0→1 and a slight 0.96→1 scale settles. The blur
//!   is a first-class image pass (identical on every backend), so this is the
//!   premium, reliable default.
//! - `rise` — opacity 0→1 + a small upward translate.
//! - `scale` — opacity 0→1 + a 0.8→1 scale.
//!
//! Scale pivots on the canvas CENTER via the translate-scale-translate pattern
//! (engine scale pivots on a node's local origin), so the logo grows about its
//! middle. NO clip — the Image is fit to its own box and the whole reveal is one
//! unit, sidestepping the renderer's clip-occludes-later-siblings issue.

import { Group, Image, interpolate, spring, useCurrentFrame, useVideoConfig } from '@onda-engine/react'
import { DURATION, SPRING_SMOOTH } from '../motion.js'

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export type LogoRevealPreset = 'focus' | 'rise' | 'scale'

export interface LogoRevealProps {
  /** Logo image source (resolved at render time by `onda render`). */
  src?: string
  /** Logo box width in px (the image is `fit="contain"` inside it — never cropped). */
  width?: number
  /** Logo box height in px. */
  height?: number
  /** Frames before the reveal starts. */
  delay?: number
  /** Frames over which the reveal completes (the house-spring duration). */
  durationInFrames?: number
  /** Reveal style — `focus` (blur pull, default), `rise`, or `scale`. */
  preset?: LogoRevealPreset
  /** Starting blur sigma (px) for the `focus` pull. Default 14. */
  fromBlur?: number
}

export function LogoReveal({
  src = '',
  width = 520,
  height = 260,
  delay = 0,
  durationInFrames = DURATION.slow,
  preset = 'focus',
  fromBlur = 14,
}: LogoRevealProps) {
  const frame = useCurrentFrame()
  const { fps, width: W, height: H } = useVideoConfig()

  // House spring (0→1) — smooth, no overshoot.
  const enter = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: SPRING_SMOOTH,
    durationInFrames,
  })
  const opacity = interpolate(enter, [0, 1], [0, 1], CLAMP)

  // Per-preset motion.
  const scale =
    preset === 'scale'
      ? interpolate(enter, [0, 1], [0.8, 1], CLAMP)
      : preset === 'focus'
        ? interpolate(enter, [0, 1], [0.96, 1], CLAMP)
        : 1
  const riseY = preset === 'rise' ? interpolate(enter, [0, 1], [24, 0], CLAMP) : 0
  const blur = preset === 'focus' ? interpolate(enter, [0, 1], [fromBlur, 0], CLAMP) : 0

  // Center the logo box on the canvas; scale pivots about the center.
  const cx = W / 2
  const cy = H / 2
  const boxX = Math.round(cx - width / 2)
  const boxY = Math.round(cy - height / 2)

  return (
    <Group x={cx} y={cy + riseY} opacity={opacity}>
      <Group scaleX={scale} scaleY={scale}>
        <Group x={-cx} y={-cy}>
          <Image
            src={src}
            x={boxX}
            y={boxY}
            width={width}
            height={height}
            fit="contain"
            blur={blur}
          />
        </Group>
      </Group>
    </Group>
  )
}
