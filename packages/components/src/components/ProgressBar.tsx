//! ProgressBar — a horizontal bar that fills from 0 to `value`% on the house
//! spring. A muted rounded track <Rect> with an accent fill <Rect> on top whose
//! width grows with the spring. Optional `${value}%` label sits to the right.
//! Ported from ondajs.
//!
//! The track + fill + label are laid out by hand inside ONE `<Group>` (NOT a
//! `<Flex>`/`<AbsoluteFill>`): the fill's width animates every frame, and the
//! engine layout pass overwrites a direct child's x/y — so a layout container
//! cannot hold a hand-positioned animated subtree (and would also clobber any
//! offset translate on it). The assembly is centered by computing its top-left
//! origin directly from the composition size (same approach as `BarChart`).

import {
  Group,
  Rect,
  Text,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import { DURATION, SPRING_SMOOTH } from '../motion.js'

/** Estimated label width per glyph as a fraction of `fontSize`, for a
 *  proportional display font — used only to reserve space so the whole assembly
 *  (track + label) centers, approximating ondajs's `4ch` tabular reservation. */
const AVG_CHAR_W = 0.6

export interface ProgressBarProps {
  /** Target fill, 0–100. The bar grows from 0 to this value. */
  value?: number
  /** Frames before the animation starts. */
  delay?: number
  /** Frames to reach the full target value (default `DURATION.slow` = 24). */
  duration?: number
  /** Track width in px — the full 0%→100% travel. */
  width?: number
  /** Bar thickness in px. */
  height?: number
  /** Corner radius in px. Defaults to a full pill. */
  radius?: number
  /** Track color — the unfilled portion. */
  trackColor?: string
  /** Fill color — the earned accent. */
  accentColor?: string
  /** Whether to render the `${value}%` label beside the bar. */
  showValue?: boolean
  /** Label color. */
  color?: string
  /** Label font size in px. */
  fontSize?: number
  /** Label font family (must be loaded by the renderer). */
  fontFamily?: string
}

export function ProgressBar({
  value = 64,
  delay = 0,
  duration = DURATION.slow,
  width = 640,
  height = 12,
  radius = 999,
  trackColor = '#26262e',
  accentColor = '#d96b82',
  showValue = true,
  color = '#f2f2f4',
  fontSize = 28,
  fontFamily,
}: ProgressBarProps) {
  const frame = useCurrentFrame()
  const { fps, width: compWidth, height: compHeight } = useVideoConfig()

  const progress = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: SPRING_SMOOTH,
    durationInFrames: duration,
  })

  // Clamp the target so an out-of-range `value` never overflows the track.
  const targetPct = Math.max(0, Math.min(100, value))
  const fillPct = interpolate(progress, [0, 1], [0, targetPct], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const fillWidth = (width * fillPct) / 100
  // Engine shapes have no overflow-clip, so a full-pill radius on a thin sliver
  // of fill would bulge into a lens. Cap the fill's radius at half its own
  // width (and half its height) so it stays a clean rounded sliver as it grows.
  const trackRadius = Math.min(radius, height / 2)
  const fillRadius = Math.min(radius, height / 2, fillWidth / 2)

  // Gap between the track's right edge and the label.
  const labelGap = 24
  // Settled label text (does not count up — matches ondajs).
  const labelText = `${Math.round(targetPct)}%`
  // Estimated label width so the whole assembly centers (no engine text metric
  // at author time; this only positions the centered origin, not the glyphs).
  const labelWidth = showValue ? labelGap + labelText.length * fontSize * AVG_CHAR_W : 0

  // Center the fixed-size assembly by computing its top-left offset directly —
  // no layout container, so the per-frame fill-width growth never reflows and
  // no offset translate gets clobbered by the layout pass (see BarChart).
  const assemblyWidth = width + labelWidth
  // The label (font box height ≈ fontSize) can be taller than the track and is
  // vertically centered on it; the assembly's visual height is the taller one.
  const assemblyHeight = Math.max(height, fontSize)
  const originX = Math.round((compWidth - assemblyWidth) / 2)
  const originY = Math.round((compHeight - assemblyHeight) / 2)
  // Track's own top within the assembly (centered against the taller label box).
  const trackY = Math.round((assemblyHeight - height) / 2)

  return (
    <Group x={originX} y={originY}>
      <Rect
        x={0}
        y={trackY}
        width={width}
        height={height}
        cornerRadius={trackRadius}
        fill={trackColor}
      />
      {fillWidth > 0 ? (
        <Rect
          x={0}
          y={trackY}
          width={fillWidth}
          height={height}
          cornerRadius={fillRadius}
          fill={accentColor}
        />
      ) : null}
      {showValue ? (
        <Text
          x={width + labelGap}
          y={Math.round((assemblyHeight - fontSize) / 2)}
          fontSize={fontSize}
          color={color}
          fontFamily={fontFamily}
          fontWeight={500}
        >
          {labelText}
        </Text>
      ) : null}
    </Group>
  )
}
