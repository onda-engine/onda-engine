//! Highlight — marker-style background reveal. Ported from ondajs.
//!
//! Two-phase emphasis: the text fades in (`entryFade` on the house spring),
//! then an accent bar wipes in BEHIND it by growing its width on the house
//! spring. The text draws on top of the bar so it stays legible throughout.
//!
//! Scene-graph notes vs the ondajs (CSS) original:
//! - CSS sized the bar to the text via `display: inline-block`. The scene graph
//!   has no JS-side text measurement, so the bar width is ESTIMATED from the
//!   glyph count (`fontSize * text.length * WIDTH_RATIO`) plus `paddingX`. Pass
//!   `width` to override the estimate when you know the exact text extent.
//! - `<Text>` places its TOP-LEFT at (x, y) with a line box of `fontSize * 1.2`
//!   (the engine's line height), so the bar is sized/positioned to that box.
//! - The whole component anchors at its local origin (top-left). Position it via
//!   `x`/`y`, or wrap it in an `<AbsoluteFill justify align>` to center it.

import {
  Group,
  Rect,
  Text,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import { entryFade } from '../choreography.js'
import { DURATION, SPRING_SMOOTH } from '../motion.js'
import { useTextMetrics } from '../text-metrics.js'
import { useTheme } from '../theme.js'

/** Engine line-box height as a multiple of font size (matches typography crate). */
const LINE_RATIO = 1.2

export interface HighlightProps {
  /** Text to highlight. */
  text?: string
  /** Frames before the text starts revealing. */
  delay?: number
  /** Text reveal duration in frames (default `DURATION.base` = 18). */
  duration?: number
  /** Frames to wait after the text appears before the accent bar wipes in. */
  lineDelay?: number
  /** Accent-bar wipe duration. Fast on purpose — emphatic (default `DURATION.fast`). */
  lineDuration?: number
  /** Text color (default: theme `text`). */
  color?: string
  /** Accent (highlight) bar color (default: theme `accent`). */
  accentColor?: string
  /** Font size in px (default 64). */
  fontSize?: number
  /** Loaded font family. */
  fontFamily?: string
  /** Font weight (display default 600). */
  fontWeight?: number
  /** Pixels past the text edges that the accent bar extends (default 8). */
  paddingX?: number
  /** Explicit text width in px. Overrides the glyph-count estimate when known. */
  width?: number
  /** Local-space placement of the component's top-left. */
  x?: number
  /** Local-space placement of the component's top-left. */
  y?: number
}

export function Highlight({
  text = 'highlight this',
  delay = 0,
  duration = DURATION.base,
  lineDelay = 8,
  lineDuration = DURATION.fast,
  color: colorProp,
  accentColor: accentColorProp,
  fontSize = 64,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
  paddingX = 8,
  width,
  x = 0,
  y = 0,
}: HighlightProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const accentColor = accentColorProp ?? theme.accent
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  // Phase 1: text fade — opacity 0 → 1 on the house spring.
  const { opacity } = entryFade({ frame, fps, delay, durationInFrames: duration })

  // Phase 2: accent bar wipes in after the text lands, offset by lineDelay.
  const barProgress = spring({
    frame: Math.max(0, frame - delay - lineDelay),
    fps,
    config: SPRING_SMOOTH,
    durationInFrames: lineDuration,
  })

  // Real shaped text width (overridable via `width`). The engine measures it
  // (proportional — exact); falls back to a glyph-count estimate until the wasm
  // engine warms in the browser, or if `width` is passed.
  const measured = useTextMetrics(text, fontSize, { fontFamily, fontWeight })
  const textWidth = width ?? measured.width
  const fullBarWidth = textWidth + paddingX * 2
  const barWidth = interpolate(barProgress, [0, 1], [0, fullBarWidth], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const lineHeight = fontSize * LINE_RATIO

  return (
    <Group x={x} y={y}>
      {/* Accent bar BEHIND the text. Starts paddingX left of the text, grows
          rightward by width. Covers the full line box vertically. */}
      <Rect x={-paddingX} y={0} width={barWidth} height={lineHeight} fill={accentColor} />
      {/* Text on top — fades in, always legible against the accent. */}
      <Group opacity={opacity}>
        <Text fontSize={fontSize} color={color} fontFamily={fontFamily} fontWeight={fontWeight}>
          {text}
        </Text>
      </Group>
    </Group>
  )
}
