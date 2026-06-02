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
//! the rule. The full rule width is ESTIMATED from `text.length`, `fontSize`,
//! and a per-glyph width factor — see `approximations`.

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

export interface UnderlineProps {
  /** Text to reveal. Pass `""` to draw the rule alone. */
  text?: string
  /** Frames before the text starts revealing. */
  delay?: number
  /** Text reveal duration in frames (default `DURATION.base` = 18). */
  duration?: number
  /** Frames to wait after the text lands before the rule starts drawing. */
  lineDelay?: number
  /** Rule draw duration. Fast on purpose — emphatic (default `DURATION.fast`). */
  lineDuration?: number
  /** Text color (default the Onda text color `#f2f2f4`). */
  color?: string
  /** Rule color — the earned rose (default `#d96b82`). */
  accentColor?: string
  /** Rule thickness in px. */
  lineThickness?: number
  /** Pixel gap between the text box and the rule. */
  lineOffset?: number
  /** Text size in px (default 64). */
  fontSize?: number
  /** Loaded font family (e.g. a `--font` passed to `onda render`). */
  fontFamily?: string
  /** Font weight (display default 600). */
  fontWeight?: number
  /** Horizontal alignment of the rule under the text. */
  align?: 'left' | 'center' | 'right'
}

/** Mean glyph advance as a fraction of the font size. A rough display-sans
 *  heuristic used only to size the rule (the engine measures the real text). */
const CHAR_WIDTH_FACTOR = 0.52
/** Engine line-box height as a multiple of font size (matches the typography
 *  crate; the same ratio `Highlight` uses to place its accent below the text). */
const LINE_RATIO = 1.2

export function Underline({
  text = 'underline this',
  delay = 0,
  duration = DURATION.base,
  lineDelay = 8,
  lineDuration = DURATION.fast,
  color = '#f2f2f4',
  accentColor = '#d96b82',
  lineThickness = 3,
  lineOffset = 6,
  fontSize = 64,
  fontFamily,
  fontWeight = 600,
  align = 'left',
}: UnderlineProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

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

  // Estimated full rule width = the estimated text box width. No author-time
  // engine text metrics exist, so derive it from glyph count × size.
  const fullWidth = text.length * fontSize * CHAR_WIDTH_FACTOR

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
  // chosen edge of the (estimated) text box.
  const lineX =
    align === 'center' ? (fullWidth - lineWidth) / 2 : align === 'right' ? fullWidth - lineWidth : 0

  return (
    <Group>
      <Text
        opacity={opacity}
        fontSize={fontSize}
        color={color}
        fontFamily={fontFamily}
        fontWeight={fontWeight}
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
