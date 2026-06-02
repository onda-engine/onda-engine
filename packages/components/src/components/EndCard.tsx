//! EndCard — closing outro/credits block. A hero CTA reveals (with an optional
//! accent underline drawing beneath it as it settles), then a faint, staggered
//! row of social handles / URLs fades in last so the eye finishes on the
//! contact strip. Ported from ondajs.
//!
//! Composition over invention: the CTA delegates to the `Underline` sibling
//! when `accent` is on (text fade + accent rule, two-phase) and to a bare
//! `FadeIn` + `Text` when it's off; the handles row reproduces the ondajs
//! `StaggerGroup` directly — each handle is a `FadeIn`-wrapped `Text` on the
//! canonical 4-frame stagger. No new motion is created here; the card's job is
//! sequencing, not animation.
//!
//! Layout: the whole card is centered and vertically stacked by the engine's
//! layout pass (taffy) via `<AbsoluteFill>` + `<Flex direction="column">`. Every
//! child is OPACITY-ONLY (`FadeIn`) or applies no root translate (`Underline`),
//! so nothing fights the layout pass (a motion translate on a direct Flex child
//! would be clobbered; a per-frame size change would reflow the column). The
//! handles sit in their own row `<Flex>`; each item is a `FadeIn`, so the row's
//! measured size is stable and never jiggles as the cascade runs.
//!
//! Approximation: the ondajs CTA reveals via a CSS blur-filter (BlurReveal) that
//! resolves blurred -> sharp during the fade. The engine has no per-node blur,
//! so the CTA reveals through the same opacity spring (entryFade, via FadeIn /
//! the Underline sibling) without the blur component — the closest faithful
//! approximation.

import { AbsoluteFill, Flex, Text } from '@onda/react'
import { DURATION, STAGGER, staggerFrames } from '../motion.js'
import { FadeIn } from './FadeIn.js'
import { Underline } from './Underline.js'

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
  /** CTA color (default the Onda text color `#f2f2f4`). */
  color?: string
  /** Handles color — defaults to the Onda faint `#56565f` so the row reads quiet. */
  handlesColor?: string
  /** Underline color — the earned rose (default `#d96b82`). */
  accentColor?: string
  /** Loaded display font for both CTA and handles (e.g. a `--font` passed to render). */
  fontFamily?: string
}

// Beat offsets — derived from delay so the whole card is one composed sequence.
// The CTA lands first; the underline draws as it settles (handled inside the
// `Underline` sibling via `lineDelay`); the handles row fades in last with a
// small beat of breathing room so the eye finishes on the contact strip.
const HANDLES_OFFSET = DURATION.base + 6 // handles begin ~6 frames after the CTA finishes its rise
const UNDERLINE_OFFSET = DURATION.base - 4 // underline starts drawing just as the CTA settles

export function EndCard({
  cta = 'Made with Onda',
  handles = ['@onda.video', 'onda.video/components'],
  delay = 0,
  accent = true,
  ctaFontSize = 96,
  ctaFontWeight = 600,
  handlesFontSize = 24,
  handlesFontWeight = 600,
  color = '#f2f2f4',
  handlesColor = '#56565f',
  accentColor = '#d96b82',
  fontFamily,
}: EndCardProps) {
  // Vertical gap between the CTA and the handles strip, scaled off the CTA size
  // so the rhythm holds at any headline size (~40px at the default 96px CTA).
  const stackGap = Math.round(ctaFontSize * 0.42)
  // Horizontal gap between handle items — the metadata strip reads as one row.
  const handlesGap = Math.round(handlesFontSize * 1.3)

  return (
    <AbsoluteFill justify="center" align="center">
      <Flex direction="column" align="center" gap={stackGap}>
        {/* CTA — when accent is on we delegate the headline to `Underline` so the
            accent rule stays visually attached to the CTA glyphs (two-phase:
            text fades, then the rule draws as it settles). When off, a bare
            FadeIn'd Text reveals the CTA without the earned-color moment. */}
        {accent ? (
          <Underline
            text={cta}
            delay={delay}
            duration={DURATION.base}
            lineDelay={UNDERLINE_OFFSET}
            lineDuration={DURATION.fast}
            color={color}
            accentColor={accentColor}
            fontSize={ctaFontSize}
            fontFamily={fontFamily}
            fontWeight={ctaFontWeight}
            lineThickness={3}
            lineOffset={6}
            align="center"
          />
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
