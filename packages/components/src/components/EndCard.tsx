//! EndCard — closing outro/credits block. A hero CTA reveals (with an optional
//! accent underline drawing beneath it as it settles), then a faint, staggered
//! row of social handles / URLs fades in last so the eye finishes on the
//! contact strip. Ported from ondajs.
//!
//! Composition over invention: when `accent` is on the CTA reproduces the
//! `Underline` motion inline (text fade + accent rule, two-phase) so the rule
//! can be sized from the WHOLE title at the engine's per-glyph estimate (the
//! `Underline` sibling's tighter factor under-spans a long hero CTA); when off
//! it falls back to a bare `FadeIn` + `Text`. The handles row reproduces the
//! ondajs `StaggerGroup` directly — each handle is a `FadeIn`-wrapped `Text` on
//! the canonical 4-frame stagger. No new motion is invented here; the card's
//! job is sequencing, not animation.
//!
//! Layout: the whole card is centered and vertically stacked by the engine's
//! layout pass (taffy) via `<AbsoluteFill>` + `<Flex direction="column">`. Every
//! child is OPACITY-ONLY (`FadeIn` / the CTA text fade) or animates inside a
//! fixed-size reserved row (the accent rule), so nothing fights the layout pass
//! (a motion translate on a direct Flex child would be clobbered; a per-frame
//! size change would reflow the column). The
//! handles sit in their own row `<Flex>`; each item is a `FadeIn`, so the row's
//! measured size is stable and never jiggles as the cascade runs.
//!
//! Approximation: the ondajs CTA reveals via a CSS blur-filter (BlurReveal) that
//! resolves blurred -> sharp during the fade. The engine has no per-node blur,
//! so the CTA reveals through the same opacity spring (entryFade) without the
//! blur component — the closest faithful approximation.

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
import { entryFade } from '../choreography.js'
import { DURATION, SPRING_SMOOTH, STAGGER, staggerFrames } from '../motion.js'
import { useTheme } from '../theme.js'
import { FadeIn } from './FadeIn.js'

export interface EndCardProps {
  /** Hero CTA / headline line. */
  cta?: string
  /** Social handles or URLs displayed in a row beneath the CTA. */
  handles?: string[]
  /** Frames before the CTA starts. The whole card is sequenced relative to this. */
  delay?: number
  /** Show the accent underline beneath the CTA (default `true`). */
  accent?: boolean
  /** CTA font size in px (default 96). */
  ctaFontSize?: number
  /** Font weight for the CTA (default 600). */
  ctaFontWeight?: number
  /** Handles row font size in px (default 24). */
  handlesFontSize?: number
  /** Font weight for the handles row (default 600). */
  handlesFontWeight?: number
  /** CTA color (default: theme `text`). */
  color?: string
  /** Handles color — defaults so the row reads quiet (default: theme `textMuted`). */
  handlesColor?: string
  /** Underline color — the earned rose (default: theme `accent`). */
  accentColor?: string
  /** Loaded display font for both CTA and handles (e.g. a `--font` passed to render) (default: theme `fontFamily`). */
  fontFamily?: string
}

// Beat offsets — derived from delay so the whole card is one composed sequence.
// The CTA lands first; the underline draws as it settles (handled inside the
// `Underline` sibling via `lineDelay`); the handles row fades in last with a
// small beat of breathing room so the eye finishes on the contact strip.
const HANDLES_OFFSET = DURATION.base + 6 // handles begin ~6 frames after the CTA finishes its rise
const UNDERLINE_OFFSET = DURATION.base - 4 // underline starts drawing just as the CTA settles

/** Mean glyph advance as a fraction of the font size — the engine's documented
 *  estimate (`text.length * fontSize * ~0.6`). The CTA delegated to the
 *  `Underline` sibling, but that sibling sizes its rule with a tighter 0.52
 *  factor tuned for shorter labels, which leaves a long hero CTA like the
 *  default "Made with Onda" under-spanned (the rule stops before the last
 *  word). The hero rule is laid inline here so it spans the FULL title at the
 *  engine's own per-glyph estimate. */
const CHAR_WIDTH_FACTOR = 0.6
/** Engine line-box height as a multiple of font size (matches `Underline`). */
const LINE_RATIO = 1.2
/** Rule geometry — mirrors the values previously passed to `Underline`. */
const LINE_THICKNESS = 3
const LINE_OFFSET = 6

export function EndCard({
  cta = 'Made with Onda',
  handles = ['@onda.video', 'onda.video/components'],
  delay = 0,
  accent = true,
  ctaFontSize = 96,
  ctaFontWeight = 600,
  handlesFontSize = 24,
  handlesFontWeight = 600,
  color: colorProp,
  handlesColor: handlesColorProp,
  accentColor: accentColorProp,
  fontFamily: fontFamilyProp,
}: EndCardProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const handlesColor = handlesColorProp ?? theme.textMuted
  const accentColor = accentColorProp ?? theme.accent
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  // Vertical gap between the CTA and the handles strip, scaled off the CTA size
  // so the rhythm holds at any headline size (~40px at the default 96px CTA).
  const stackGap = Math.round(ctaFontSize * 0.42)
  // Horizontal gap between handle items — the metadata strip reads as one row.
  const handlesGap = Math.round(handlesFontSize * 1.3)

  // CTA reveal + accent rule (only built when `accent` is on). Two-phase: the
  // text fades on the house entry spring, then the rule draws beneath it. The
  // rule's FULL width is estimated from the WHOLE `cta` at the engine's
  // per-glyph factor so it spans every word of the title (not just the first).
  const { opacity: ctaOpacity } = entryFade({
    frame,
    fps,
    delay,
    durationInFrames: DURATION.base,
  })
  const fullRuleWidth = Math.max(0, cta.length) * ctaFontSize * CHAR_WIDTH_FACTOR
  const ruleProgress = spring({
    frame: Math.max(0, frame - delay - UNDERLINE_OFFSET),
    fps,
    config: SPRING_SMOOTH,
    durationInFrames: DURATION.fast,
  })
  const ruleWidth = interpolate(ruleProgress, [0, 1], [0, fullRuleWidth], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  // A full-pill radius on a thin sliver would bulge; cap at half its own size.
  const ruleRadius = Math.min(LINE_THICKNESS / 2, ruleWidth / 2)
  // The rule sits just below the text's line box (`ctaFontSize * LINE_RATIO`)
  // plus the gap — matching the offset previously delegated to `Underline`.
  const ruleY = ctaFontSize * LINE_RATIO + LINE_OFFSET
  // Reserve a fixed-height row spanning the estimated text box + rule so the
  // animated rule width never reflows the centered column.
  const ruleRowHeight = ruleY + LINE_THICKNESS

  return (
    <AbsoluteFill justify="center" align="center">
      <Flex direction="column" align="center" gap={stackGap}>
        {/* CTA — when accent is on, the headline reveals (text fade) and the
            accent rule draws beneath it (two-phase, the `Underline` motion). The
            rule is laid out inline here so its FULL width tracks the WHOLE title
            (every word) at the engine's per-glyph estimate; a fixed-height row
            (transparent spacer sized to the estimated title box) keeps the
            animated rule width from reflowing the centered column. When accent
            is off, a bare FadeIn'd Text reveals the CTA without the rule. */}
        {accent ? (
          <Flex direction="column" align="center">
            <Text
              opacity={ctaOpacity}
              fontSize={ctaFontSize}
              color={color}
              fontFamily={fontFamily}
              fontWeight={ctaFontWeight}
            >
              {cta}
            </Text>
            <Group>
              <Rect width={fullRuleWidth} height={ruleRowHeight} fill="#00000000" />
              {ruleWidth > 0 ? (
                <Rect
                  x={(fullRuleWidth - ruleWidth) / 2}
                  y={ruleY}
                  width={ruleWidth}
                  height={LINE_THICKNESS}
                  cornerRadius={ruleRadius}
                  fill={accentColor}
                />
              ) : null}
            </Group>
          </Flex>
        ) : (
          <FadeIn delay={delay} durationInFrames={DURATION.base}>
            <Text
              fontSize={ctaFontSize}
              color={color}
              fontFamily={fontFamily}
              fontWeight={ctaFontWeight}
            >
              {cta}
            </Text>
          </FadeIn>
        )}

        {/* Handles row — staggered, faint, the closing beat. Rendered as a
            horizontal strip so URLs / handles read as a single line of metadata,
            not a stack. Each handle is one beat on the canonical 4-frame stagger
            (reproducing ondajs's StaggerGroup). Opacity-only, so the row's
            measured size is stable and the cascade never reflows it. */}
        {handles.length > 0 ? (
          <Flex direction="row" align="center" gap={handlesGap}>
            {handles.map((handle, i) => (
              <FadeIn
                key={`${i}-${handle}`}
                delay={delay + HANDLES_OFFSET + staggerFrames(i, STAGGER)}
                durationInFrames={DURATION.base}
              >
                <Text
                  fontSize={handlesFontSize}
                  color={handlesColor}
                  fontFamily={fontFamily}
                  fontWeight={handlesFontWeight}
                >
                  {handle}
                </Text>
              </FadeIn>
            ))}
          </Flex>
        ) : null}
      </Flex>
    </AbsoluteFill>
  )
}
