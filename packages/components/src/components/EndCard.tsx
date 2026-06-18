//! EndCard — closing outro/credits block. A hero CTA reveals (with an optional
//! accent underline drawing beneath it as it settles), then a faint, staggered
//! row of social handles / URLs fades in last so the eye finishes on the
//! contact strip. Ported from ondajs.
//!
//! Composition over invention: when `accent` is on the CTA reproduces the
//! `Underline` motion inline (text fade + accent rule, two-phase) so the rule
//! can be sized from the WHOLE title at the engine's per-glyph estimate (the
//! `Underline` sibling's tighter factor under-spans a long hero CTA); when off
//! it falls back to a bare blur-ramp `<Group>` + `Text`. The handles row reproduces the
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
//! Soft→sharp CTA: the ondajs CTA reveals via a blur-filter (BlurReveal) that
//! resolves blurred -> sharp during the fade. With the engine's render-to-texture
//! blur this is first-class — the CTA reveals through the opacity spring
//! (entryFade) AND a real `blur` ramp (CTA_FROM_BLUR -> 0) on the same progress,
//! so it resolves soft -> sharp exactly as the original. The blur lives on a
//! `<Group>` wrapping the CTA text (both the accent and bare branches), inside
//! the column's fixed-size rows so the layout pass is never disturbed.

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
} from '@onda-engine/react'
import { DURATION, SPRING_SMOOTH, STAGGER, staggerFrames } from '../motion.js'
import { type Placement, PlacementShift } from '../placement.js'
import { type TextStyleProps, applyTextCase } from '../text-style.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'
import { FadeIn } from './FadeIn.js'

export interface EndCardProps extends TextStyleProps {
  /** Hero CTA / headline line. */
  cta?: string
  /** Social handles or URLs displayed in a row beneath the CTA. */
  handles?: string[]
  /** Time before the CTA starts (frames, or '0.5s'/'500ms'/'12f'). The whole card is sequenced relative to this. */
  delay?: TimeInput
  /** Where the card sits: a region keyword (`'center'`, `'lower-third'`, ...) or
   *  normalized `{x,y}` (0-1, card center). The shared placement contract;
   *  default `'center'` (the historical self-centering). */
  placement?: Placement
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
  /** Handles color — defaults so the row reads quiet (default: theme `textMuted`). */
  handlesColor?: string
  /** Underline color — the earned rose (default: theme `accent`). */
  accentColor?: string
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
/** Rule geometry — mirrors the values previously passed to `Underline`. */
const LINE_THICKNESS = 3
const LINE_OFFSET = 6
/** Starting blur (px) for the CTA's soft→sharp focus-pull — the ondajs CTA's
 *  `blur(… → 0)`, ramped to 0 on the same entry spring as the opacity. */
const CTA_FROM_BLUR = 10

export function EndCard({
  cta = 'Made with Onda',
  handles = ['@onda.video', 'onda.video/components'],
  delay: delayIn = 0,
  placement,
  accent = true,
  ctaFontSize = 96,
  ctaFontWeight = 600,
  handlesFontSize = 24,
  handlesFontWeight = 600,
  color: colorProp,
  handlesColor: handlesColorProp,
  accentColor: accentColorProp,
  fontFamily: fontFamilyProp,
  letterSpacing,
  uppercase,
}: EndCardProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const handlesColor = handlesColorProp ?? theme.textMuted
  const accentColor = accentColorProp ?? theme.accent
  // The CTA is the headline → it follows the theme's display face
  // (`headingFamily ?? fontFamily`); the handles strip is metadata → it stays on
  // the body `fontFamily`. An explicit `fontFamily` prop overrides both.
  const ctaFontFamily = fontFamilyProp ?? theme.headingFamily ?? theme.fontFamily
  const handlesFontFamily = fontFamilyProp ?? theme.fontFamily
  const ctaText = applyTextCase(cta, { uppercase })

  // Vertical gap between the CTA and the handles strip, scaled off the CTA size
  // so the rhythm holds at any headline size (~40px at the default 96px CTA).
  const stackGap = Math.round(ctaFontSize * 0.42)
  // Horizontal gap between handle items — the metadata strip reads as one row.
  const handlesGap = Math.round(handlesFontSize * 1.3)

  // CTA reveal + accent rule (only built when `accent` is on). The CTA resolves
  // soft→sharp: one house entry spring drives BOTH the opacity fade and a real
  // `blur` ramp (CTA_FROM_BLUR → 0) so they read as a single focus-pull (the
  // ondajs BlurReveal). The rule then draws beneath it. The rule's FULL width is
  // estimated from the WHOLE `cta` at the engine's per-glyph factor so it spans
  // every word of the title (not just the first).
  const ctaProgress = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: SPRING_SMOOTH,
    durationInFrames: DURATION.base,
  })
  const ctaOpacity = interpolate(ctaProgress, [0, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const ctaBlur = interpolate(ctaProgress, [0, 1], [CTA_FROM_BLUR, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
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
  // The rule is a flex sibling stacked directly BELOW the CTA text, so the
  // column already accounts for the title's line box. `ruleY` is therefore just
  // the small underline gap UNDER the text — a previous version added a whole
  // line box here (`ctaFontSize * 1.2 + …`), double-counting it and dropping the
  // rule ~1.2×fontSize too far below the title.
  const ruleY = LINE_OFFSET + Math.round(ctaFontSize * 0.12)
  // The row only needs to span the gap + the rule itself; the fixed-WIDTH
  // transparent spacer below is what keeps the animated rule from reflowing.
  const ruleRowHeight = ruleY + LINE_THICKNESS

  return (
    // The flex column self-centers; PlacementShift moves the centered stack by
    // the center->placement delta (no-op for the default 'center').
    <PlacementShift placement={placement}>
      <AbsoluteFill justify="center" align="center">
        <Flex direction="column" align="center" gap={stackGap}>
          {/* CTA — the headline reveals soft→sharp (opacity + blur ramp). When
            accent is on, the accent rule then draws beneath it (two-phase, the
            `Underline` motion); the rule is laid out inline here so its FULL
            width tracks the WHOLE title (every word) at the engine's per-glyph
            estimate, and a fixed-height row (transparent spacer sized to the
            estimated title box) keeps the animated rule width from reflowing the
            centered column. When accent is off, the same blur-ramp CTA reveals
            without the rule. */}
          {accent ? (
            <Flex direction="column" align="center">
              {/* CTA text resolves soft→sharp: opacity + real blur ramp on one
                group (origin pinned, no translate, so the column never shifts). */}
              <Group opacity={ctaOpacity} blur={ctaBlur}>
                <Text
                  fontSize={ctaFontSize}
                  color={color}
                  fontFamily={ctaFontFamily}
                  fontWeight={ctaFontWeight}
                  letterSpacing={letterSpacing}
                >
                  {ctaText}
                </Text>
              </Group>
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
            // No accent rule, but the CTA still resolves soft→sharp: same
            // opacity + blur ramp on the house entry spring (no rule beneath).
            <Group opacity={ctaOpacity} blur={ctaBlur}>
              <Text
                fontSize={ctaFontSize}
                color={color}
                fontFamily={ctaFontFamily}
                fontWeight={ctaFontWeight}
                letterSpacing={letterSpacing}
              >
                {ctaText}
              </Text>
            </Group>
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
                    fontFamily={handlesFontFamily}
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
    </PlacementShift>
  )
}
