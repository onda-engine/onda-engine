//! PulsingIndicator — a live status dot with a calm expanding-ring pulse, plus an
//! optional label. Ported from ondajs.
//!
//! The pulse is keyed off `frame % period`, so it loops seamlessly and is a pure
//! function of frame (no timers): the halo ring scales 1 → 2.6 while fading
//! 0.5 → 0, over a solid core dot.
//!
//! Layout note: the ring is an `<Ellipse>` whose *scale* animates each frame.
//! Scene scale pivots on the node's local origin (0,0), so the ring must be
//! centered on that pivot — its top-left is offset by `-size/2` inside a
//! `<Group x={size/2} y={size/2}>` that marks the dot's center. Everything is
//! positioned with explicit x/y (not `<Flex>`) so the per-frame size change of
//! the ring can't make a layout container reflow/jiggle.

import { Ellipse, Group, Text, interpolate, useCurrentFrame } from '@onda/react'
import { useTheme } from '../theme.js'

export interface PulsingIndicatorProps {
  /** Dot + ring color (default: theme `accent`). */
  color?: string
  /** Dot diameter in px. */
  size?: number
  /** Optional label to the right of the dot. Empty hides it. */
  label?: string
  /** Label color (default: theme `textMuted`). */
  labelColor?: string
  /** Label font family (must be loaded by the renderer) (default: theme `fontFamily`). */
  fontFamily?: string
  /** Label font size in px. */
  fontSize?: number
  /** Frames per pulse cycle. */
  period?: number
  /** Placement of the indicator's top-left (the dot's bounding box). */
  x?: number
  y?: number
}

export function PulsingIndicator({
  color: colorProp,
  size = 20,
  label = 'LIVE',
  labelColor: labelColorProp,
  fontFamily: fontFamilyProp,
  fontSize = 28,
  period = 45,
  x = 0,
  y = 0,
}: PulsingIndicatorProps) {
  const frame = useCurrentFrame()
  const theme = useTheme()
  const color = colorProp ?? theme.accent
  const labelColor = labelColorProp ?? theme.textMuted
  const fontFamily = fontFamilyProp ?? theme.fontFamily
  const safePeriod = Math.max(1, period)
  // Normalized 0..1 phase within the cycle; the modulo keeps it seamless and
  // handles negative frames (e.g. inside a delayed Sequence).
  const t = (((frame % safePeriod) + safePeriod) % safePeriod) / safePeriod
  const ringScale = interpolate(t, [0, 1], [1, 2.6])
  const ringOpacity = interpolate(t, [0, 1], [0.5, 0])

  const radius = size / 2
  // Gap between the dot and the label, mirroring ondajs (size * 0.7).
  const labelGap = size * 0.7
  // ondajs uppercases the label via CSS `text-transform`; the engine has no
  // text-transform, so uppercase here.
  const labelText = label ? label.toUpperCase() : ''

  return (
    <Group x={x} y={y}>
      {/* Origin at the dot's center, so the ring scales about its middle. */}
      <Group x={radius} y={radius}>
        {/* Expanding halo ring — scales + fades, drawn under the core. */}
        <Ellipse
          x={-radius}
          y={-radius}
          width={size}
          height={size}
          fill={color}
          scaleX={ringScale}
          scaleY={ringScale}
          opacity={ringOpacity}
        />
        {/* Solid core dot. */}
        <Ellipse x={-radius} y={-radius} width={size} height={size} fill={color} />
      </Group>
      {labelText ? (
        // Vertically center the cap-height roughly on the dot: nudge the text
        // baseline so it reads centered next to the dot.
        <Text
          x={size + labelGap}
          y={radius - fontSize / 2}
          fontSize={fontSize}
          color={labelColor}
          fontFamily={fontFamily}
        >
          {labelText}
        </Text>
      ) : null}
    </Group>
  )
}
