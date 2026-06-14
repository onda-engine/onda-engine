//! Underline — text fades in, then a rounded accent rule draws beneath it,
//! its width growing 0 → full on the house spring. Two-phase reveal: text
//! first, accent second (offset by `lineDelay`). One of the catalog's rare
//! earned-color moments — reserved for emphasis. Ported from ondajs.
//!
//! Layout: ondajs renders a `position: relative` inline-block and sizes the
//! rule as a `%` of the DOM-measured text width. `@onda/react` has no
//! author-time text metrics, so the assembly is hand-laid inside a centered
//! `<Group>` (the ProgressBar pattern): the rule is positioned ABSOLUTELY at an
//! explicit `y` below the text and its width animates every frame. An animated
//! width inside a `<Flex>` would reflow/jiggle, so we avoid layout entirely for
//! the rule. The full rule width is MEASURED from the shaped text via
//! `useTextMetrics` (the engine's real metrics; estimate fallback until warm).

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
import { type TextStyleProps, applyTextCase } from '../text-style.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

export interface UnderlineProps extends TextStyleProps {
  /** Text to reveal. Pass `""` to draw the rule alone. */
  text?: string
  /** Frames before the text starts revealing. */
  delay?: TimeInput
  /** Text reveal duration in frames (default `DURATION.base` = 18). */
  duration?: TimeInput
  /** Frames to wait after the text lands before the rule starts drawing. */
  lineDelay?: TimeInput
  /** Rule draw duration. Fast on purpose — emphatic (default `DURATION.fast`). */
  lineDuration?: TimeInput
  /** Rule color (default: theme `accent`). */
  accentColor?: string
  /** Rule thickness in px. */
  lineThickness?: number
  /** Pixel gap between the text box and the rule. */
  lineOffset?: number
  /** Text size in px (default 64). */
  fontSize?: number
  /** Horizontal alignment of the rule under the text. */
  align?: 'left' | 'center' | 'right'
}

/** Engine line-box height as a multiple of font size (matches the typography
 *  crate; the same ratio `Highlight` uses to place its accent below the text). */
const LINE_RATIO = 1.2

export function Underline({
  text: textProp = 'underline this',
  delay: delayIn = 0,
  duration: durationIn = DURATION.base,
  lineDelay: lineDelayIn = 8,
  lineDuration: lineDurationIn = DURATION.fast,
  color: colorProp,
  accentColor: accentColorProp,
  lineThickness = 3,
  lineOffset = 6,
  fontSize = 64,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
  italic = false,
  letterSpacing,
  uppercase,
  align = 'left',
}: UnderlineProps) {
  const text = applyTextCase(textProp, { uppercase })
  const frame = useCurrentFrame()
  const { fps, width: canvasWidth, height: canvasHeight } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const duration = framesOf(durationIn, fps)
  const lineDelay = framesOf(lineDelayIn, fps)
  const lineDuration = framesOf(lineDurationIn, fps)
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const accentColor = accentColorProp ?? theme.accent
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  // Real shaped text width — the engine measures it (proportional, exact),
  // falling back to a glyph-count estimate until the wasm engine warms.
  const measured = useTextMetrics(text, fontSize, { fontFamily, fontWeight })

  // Phase 1: text fade — opacity 0 → 1 on the house spring (the `entryFade`
  // choreography, matching the ondajs original).
  const { opacity } = entryFade({ frame, fps, delay, durationInFrames: duration })

  // Phase 2: the rule draws after the text has landed, offset by `lineDelay`.
  const lineProgress = spring({
    frame: Math.max(0, frame - delay - lineDelay),
    fps,
    config: SPRING_SMOOTH,
    durationInFrames: lineDuration,
  })

  // Full rule width = the measured text box width.
  const fullWidth = measured.width

  const lineWidth = interpolate(lineProgress, [0, 1], [0, fullWidth], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  // The rule sits just below the text's line box (`fontSize * LINE_RATIO` tall,
  // the engine's line height) plus the gap — matching ondajs's `bottom` offset
  // relative to the text box, not the glyph baseline.
  const lineY = fontSize * LINE_RATIO + lineOffset
  // A full-pill radius on a thin sliver would bulge; cap at half its own size.
  const lineRadius = Math.min(lineThickness / 2, lineWidth / 2)
  // align: the rule grows from its left origin; shift it so it tracks the
  // chosen edge of the (measured) text box.
  const lineX =
    align === 'center' ? (fullWidth - lineWidth) / 2 : align === 'right' ? fullWidth - lineWidth : 0

  // Center the whole assembly. The rule's width animates every frame, so a
  // layout container would reflow/jiggle (ProgressBar pattern) — instead we
  // compute a static centered origin from the composition size and the block's
  // MEASURED extent: `fullWidth` wide; from the text's top to the rule's
  // bottom tall (`lineY + lineThickness`).
  const blockHeight = lineY + lineThickness
  const originX = (canvasWidth - fullWidth) / 2
  const originY = (canvasHeight - blockHeight) / 2

  return (
    <Group x={originX} y={originY}>
      <Text
        opacity={opacity}
        fontSize={fontSize}
        color={color}
        fontFamily={fontFamily}
        fontWeight={fontWeight}
        italic={italic}
        letterSpacing={letterSpacing}
      >
        {text}
      </Text>
      {lineWidth > 0 ? (
        <Rect
          x={lineX}
          y={lineY}
          width={lineWidth}
          height={lineThickness}
          cornerRadius={lineRadius}
          fill={accentColor}
        />
      ) : null}
    </Group>
  )
}
