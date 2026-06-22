//! KineticDotTitle — an EDITABLE title line whose trailing circle resolves into the
//! period. The text is ONE editable string (real kerning, kerning-accurate layout via
//! the shared glyph-line primitive), and a circle animates from large down to a period
//! that lands EXACTLY at the measured end of the text — so the "circle becomes the full
//! stop" move works for ANY copy, not a hand-placed per-letter rig. The glyphs reveal
//! left-to-right as the circle shrinks.
//!
//! This is the editable counterpart to hand-authoring a title + a separately-keyframed
//! dot: change `text` and both the type and the period re-place themselves.

import {
  Ellipse,
  Group,
  Text,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from '@onda-engine/react'
import { LINE_RATIO, layoutGlyphLine, lineStartX, lineTopY } from '../glyph-line.js'
import { type Placement, usePlacement } from '../placement.js'
import { useTextMetricsReady } from '../text-metrics.js'
import { type TextStyleProps, applyTextCase } from '../text-style.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

export interface KineticDotTitleProps extends TextStyleProps {
  /** The title line (editable). The period at the end is the animated circle. */
  text?: string
  /** Font size in px (default 110). */
  fontSize?: number
  /** Period color — the circle that becomes the full stop. Default `theme.accent`. */
  dotColor?: string
  /** Period diameter as a fraction of fontSize (default 0.34). */
  dotScale?: number
  /** How big the circle STARTS, in multiples of the period diameter (default 6). */
  circleFrom?: number
  /** Frames for the circle to shrink to the period + the line to write (default '0.8s'). */
  shrinkDuration?: TimeInput
  /** Gap between the last glyph and the period, as a fraction of fontSize (default 0.16). */
  gap?: number
  /** Horizontal alignment of the text+period unit about its anchor (default 'center'). */
  align?: 'left' | 'center' | 'right'
  /** Where the unit sits (region keyword or normalized {x,y}). Default 'center'. */
  placement?: Placement
}

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const easeOut = (t: number) => 1 - (1 - t) ** 3

export function KineticDotTitle({
  text: textProp = 'EVERY IDEA',
  fontSize = 110,
  dotColor,
  dotScale = 0.34,
  circleFrom = 6,
  shrinkDuration = '0.8s',
  gap = 0.16,
  align = 'center',
  color,
  fontFamily,
  fontWeight = 700,
  italic = false,
  letterSpacing,
  uppercase,
  placement,
}: KineticDotTitleProps) {
  const text = applyTextCase(textProp, { uppercase })
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const theme = useTheme()
  const ink = color ?? theme.text
  const dotInk = dotColor ?? theme.accent
  const family = fontFamily ?? theme.headingFamily ?? theme.fontFamily
  useTextMetricsReady()
  const measure = { fontFamily: family, fontWeight }

  // Kerning-accurate layout of the editable string (shared glyph-line primitive).
  const laid = layoutGlyphLine(text, fontSize, measure)
  const placed = laid.rendered
  const textW = laid.width
  const dia = fontSize * dotScale
  const gapPx = fontSize * gap
  const unitW = textW + gapPx + dia

  // Center the TEXT+period unit about the placement anchor.
  const resolved = usePlacement(placement, { width: unitW, height: fontSize * LINE_RATIO })
  const anchorX = Math.round(resolved.x)
  const startX = lineStartX(align, anchorX, unitW) // left edge of the unit
  const baseY = lineTopY(resolved.y, fontSize) // top of the line box
  const dotCX = startX + textW + gapPx + dia / 2 // period sits just past the last glyph
  const dotCY = baseY + fontSize * 0.62 // …on the baseline

  const shrinkF = Math.max(1, framesOf(shrinkDuration, fps, 24))
  // circle: from circleFrom×period down to period, ease-out.
  const st = easeOut(interpolate(frame, [0, shrinkF], [0, 1], CLAMP))
  const dotDia = dia * (circleFrom - (circleFrom - 1) * st)
  // glyphs write left-to-right across ~70% of the shrink; each settles over 40% of it.
  const perGlyph = placed.length > 1 ? (shrinkF * 0.7) / placed.length : 0

  return (
    <Group>
      {placed.map(({ ch, x, renderIndex: i }) => {
        const t = easeOut(
          interpolate(frame, [i * perGlyph, i * perGlyph + shrinkF * 0.4], [0, 1], CLAMP),
        )
        return (
          <Text
            key={`${i}-${ch}`}
            x={startX + x}
            y={baseY + (1 - t) * 14}
            opacity={t}
            fontSize={fontSize}
            color={ink}
            fontFamily={family}
            fontWeight={fontWeight}
            italic={italic}
            letterSpacing={letterSpacing}
          >
            {ch}
          </Text>
        )
      })}
      <Ellipse
        x={dotCX - dotDia / 2}
        y={dotCY - dotDia / 2}
        width={dotDia}
        height={dotDia}
        fill={dotInk}
      />
    </Group>
  )
}
