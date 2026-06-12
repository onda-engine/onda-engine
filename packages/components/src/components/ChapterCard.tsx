//! ChapterCard — a numbered eyebrow ("01") fades in above a large chapter title
//! that rises into place; when `accent` is on, the number takes the rose and a
//! quiet underline draws beneath the title. Centered via `<AbsoluteFill>` +
//! `<Flex>` column so the engine's layout pass (taffy) handles stacking — no
//! manual x/y math. Ported from ondajs.
//!
//! Approximations: ondajs sequences the title with `BlurReveal` (a SPRING_SMOOTH
//! rise + CSS `blur()` falloff + fade). The engine has no blur filter, so the
//! title uses the `entryFadeRise` choreography — the identical spring rise + fade,
//! minus the blur ramp.
//!
//! The accent underline replicates ondajs's `Underline text=""` (rule-only) mode:
//! a rounded rule whose width grows 0 → full on the house spring. Its full width
//! is ESTIMATED from `chapter.length × titleFontSize × 0.52` (no author-time
//! engine text metrics), matching the sibling `Underline` port. The schema's CSS
//! letter-spacing / line-height props and the semantic size-role / placement
//! props are dropped (no engine equivalent): size roles collapse to explicit px
//! and placement collapses to the centered `AbsoluteFill`.
//!
//! Layout-safety: a plain `<Group>`'s measured size is the bounding box of its
//! children, so a per-frame motion TRANSLATE on a child of the Flex column would
//! grow that box and reflow/jiggle the whole column (see the `WordStagger` port
//! note). Both animated beats therefore live inside a FIXED-SIZE transparent
//! spacer Rect: the title rises within a reserved-height row, and the rule grows
//! within a reserved-width/height row. The spacer's constant box wins the Group
//! bounding-box measurement, so the column never reflows as either beat animates.

import {
  AbsoluteFill,
  Flex,
  Group,
  Rect,
  Text,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import { useFittedFontSize } from '../bounds.js'
import { entryFadeRise } from '../choreography.js'
import { DURATION, SPRING_SMOOTH } from '../motion.js'
import { type Placement, PlacementShift } from '../placement.js'
import { useTheme } from '../theme.js'
import { FadeIn } from './FadeIn.js'

export interface ChapterCardProps {
  /** The chapter heading — the focal text on the card. */
  chapter: string
  /** Numbered index above the chapter. String so leading zeros (`"01"`) read as intended. */
  number?: string
  /** Frames before the number starts fading in. The whole card sequences off this. */
  delay?: number
  /** When `true`, the number takes `numberColor` (the rose) and an underline punctuates the title. */
  accent?: boolean
  /** Number color when `accent` is `true` (the Onda rose) (default: theme `accent`). */
  numberColor?: string
  /** Chapter title color (default: theme `text`). */
  color?: string
  /** Number color when `accent` is `false` — quiet metadata dim (default: theme `textMuted`). */
  subtitleColor?: string
  /** Number font size in px — smaller than the title, sitting above it. */
  numberFontSize?: number
  /** Number font weight. */
  numberFontWeight?: number
  /** Chapter title font size in px — the focal element. */
  titleFontSize?: number
  /** Opt-in auto-fit: `'frame'` scales the TITLE size DOWN (never up) so the
   *  title line cannot exceed the frame minus the safe margins. Default
   *  `'none'` (the historical behavior). */
  fit?: 'none' | 'frame'
  /** Explicit width cap in px for the title line; combines with `fit` (the
   *  smaller cap wins). */
  maxWidth?: number
  /** Title font weight. */
  titleFontWeight?: number
  /** Onda display font, applied to both number and title for tonal consistency (default: theme `headingFamily ?? fontFamily`). */
  fontFamily?: string
  /** Where the card sits: a region keyword (`'center'`, `'lower-third'`, ...) or
   *  normalized `{x,y}` (0-1, card center). The shared placement contract;
   *  default `'center'` (the historical self-centering). */
  placement?: Placement
}

// Beat offsets — all derived from `delay` so the card is one composed sequence.
// The number lands first as a quiet eyebrow; the title rises 10 frames later
// (the canonical Onda follow-up cadence); the underline punctuates it as it
// settles. Ported verbatim from the ondajs original.
const TITLE_OFFSET = 10
const UNDERLINE_OFFSET = TITLE_OFFSET + 24

/** Mean glyph advance as a fraction of font size — a rough display-sans
 *  heuristic, used only to size the accent rule (matches the `Underline` port). */
const CHAR_WIDTH_FACTOR = 0.52
/** Engine line-box height as a multiple of font size (matches the typography
 *  crate; the same ratio the `Underline`/`Highlight` ports use). Used only to
 *  reserve the title slot so the rise never reflows the column. */
const LINE_RATIO = 1.2
/** Title rise travel in px (the BlurReveal envelope). */
const TITLE_TRAVEL = 16

export function ChapterCard({
  chapter,
  number = '01',
  delay = 0,
  accent = true,
  numberColor: numberColorProp,
  color: colorProp,
  subtitleColor: subtitleColorProp,
  numberFontSize = 32,
  numberFontWeight = 600,
  titleFontSize: titleFontSizeProp = 96,
  fit,
  maxWidth,
  titleFontWeight = 600,
  fontFamily: fontFamilyProp,
  placement,
}: ChapterCardProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const theme = useTheme()
  const numberColor = numberColorProp ?? theme.accent
  const color = colorProp ?? theme.text
  const subtitleColor = subtitleColorProp ?? theme.textMuted
  const fontFamily = fontFamilyProp ?? theme.headingFamily ?? theme.fontFamily

  // Opt-in auto-fit on the chapter title (the focal line).
  const titleFontSize = useFittedFontSize(chapter, titleFontSizeProp, {
    fontFamily,
    fontWeight: titleFontWeight,
    fit,
    maxWidth,
  })

  // Title rise — the focal beat. `entryFadeRise` is the spring rise + fade that
  // stands in for the ondajs `BlurReveal` (sans the unsupported blur).
  const title = entryFadeRise({
    frame,
    fps,
    delay: delay + TITLE_OFFSET,
    durationInFrames: DURATION.base,
    travelPx: TITLE_TRAVEL,
  })

  // Estimated title box, used only to reserve fixed-size spacer rows so neither
  // animated beat reflows the Flex column.
  const titleBoxWidth = chapter.length * titleFontSize * CHAR_WIDTH_FACTOR
  const titleBoxHeight = titleFontSize * LINE_RATIO
  // Reserve enough height for the text PLUS its rise travel, so the title row's
  // box stays constant while the inner text translates from +TITLE_TRAVEL → 0.
  const titleRowHeight = titleBoxHeight + TITLE_TRAVEL

  // Accent rule — grows 0 → full on the house spring, after the title settles.
  const ruleProgress = spring({
    frame: Math.max(0, frame - delay - UNDERLINE_OFFSET),
    fps,
    config: SPRING_SMOOTH,
    durationInFrames: DURATION.fast,
  })
  const fullRuleWidth = chapter.length * titleFontSize * CHAR_WIDTH_FACTOR
  const ruleWidth = interpolate(ruleProgress, [0, 1], [0, fullRuleWidth], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const ruleThickness = 3
  // Rule corner radius defaults to the theme `radius` token (for future override
  // capability), capped at half the rule's own thickness/width so a thin sliver
  // stays a clean rounded rule rather than bulging into a lens.
  const ruleRadius = Math.min(theme.radius, ruleThickness / 2, ruleWidth / 2)
  // Reserve a fixed-height row for the rule so the Flex column never reflows as
  // the rule width animates. Width is centered within the row by absolute x.
  const ruleRowHeight = ruleThickness + 4

  const gap = Math.round(numberFontSize * 0.75)

  return (
    // The flex column self-centers; PlacementShift moves the centered stack by
    // the center->placement delta (no-op for the default 'center').
    <PlacementShift placement={placement}>
      <AbsoluteFill justify="center" align="center">
        <Flex direction="column" align="center" gap={gap}>
          {/* Numbered eyebrow — pure fade so the title owns the rise. Rose when
            accent is on; otherwise the dim metadata color. */}
          <FadeIn delay={delay} durationInFrames={DURATION.base}>
            <Text
              fontSize={numberFontSize}
              color={accent ? numberColor : subtitleColor}
              fontFamily={fontFamily}
              fontWeight={numberFontWeight}
            >
              {number}
            </Text>
          </FadeIn>

          {/* Chapter title — focal element. A fixed-size transparent spacer Rect
            reserves the row (text box + rise travel), so the rising text never
            grows the Group's bounding box and the column stays put. The text is
            laid out ABSOLUTELY inside the row (centered horizontally) and the
            inner Group carries the motion rise. */}
          <Group>
            <Rect width={titleBoxWidth} height={titleRowHeight} fill="#00000000" />
            <Group y={title.y} opacity={title.opacity}>
              <Text
                fontSize={titleFontSize}
                color={color}
                fontFamily={fontFamily}
                fontWeight={titleFontWeight}
              >
                {chapter}
              </Text>
            </Group>
          </Group>

          {/* Accent underline — only when accent is on, so the rose stays earned.
            Rule drawn absolutely inside a fixed-height row (centered) so its
            per-frame width never reflows the column. */}
          {accent ? (
            <Group>
              <Rect width={fullRuleWidth} height={ruleRowHeight} fill="#00000000" />
              {ruleWidth > 0 ? (
                <Rect
                  x={(fullRuleWidth - ruleWidth) / 2}
                  y={(ruleRowHeight - ruleThickness) / 2}
                  width={ruleWidth}
                  height={ruleThickness}
                  cornerRadius={ruleRadius}
                  fill={numberColor}
                />
              ) : null}
            </Group>
          ) : null}
        </Flex>
      </AbsoluteFill>
    </PlacementShift>
  )
}
