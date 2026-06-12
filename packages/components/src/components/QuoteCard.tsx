//! QuoteCard — a centered pull-quote: a large word-staggered quote, an accent
//! divider that draws in from the left, and an attribution (author + role) that
//! fades in last. A slow, readable stagger — the quote reads, it doesn't
//! cascade. Ported from ondajs.
//!
//! Layout: an `<AbsoluteFill justify align center>` centers a
//! `<Flex direction="column" align="center">` that stacks the three beats with a
//! fixed gap, so the engine's layout pass (taffy) handles centering and vertical
//! stacking — no manual y math (which the wrapped quote would make
//! un-computable at author time anyway).
//!
//! Sequencing (verbatim from ondajs — no two things move together):
//!   t=delay                              quote words begin staggering in
//!   t=delay + quoteRevealEnd + 8         divider draws in (only if `accent`)
//!   t=dividerDelay + DURATION.base + 4   author + role fade in together
//! `quoteRevealEnd = (wordCount - 1) * QUOTE_STAGGER + DURATION.base`.
//!
//! Divider draw-on: ondajs composes `MaskReveal` (a clip-path retreat over a
//! unicode block) to "draw" the rule from the left. Here the rule is a
//! fixed-size `<Rect>` revealed by an animated `clipRect(width * progress, …)`
//! on its wrapping `<Group>` — same left-to-right reveal, and layout-safe: the
//! clip does not change the node's measured bbox, so the column never reflows
//! (an animated Rect `width` as a Flex child would jiggle).

import {
  AbsoluteFill,
  Flex,
  Group,
  Rect,
  Text,
  clipRect,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import { DURATION, SPRING_SMOOTH, STAGGER } from '../motion.js'
import { type Placement, PlacementShift } from '../placement.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'
import { FadeIn } from './FadeIn.js'
import { WordStagger } from './WordStagger.js'

/** Slower stagger between quote words than the canonical `STAGGER` (4f) — a
 *  quote needs to read, not cascade. 6f @ 30fps ≈ 0.20s: quiet, readable. This
 *  longer beat is the entire reason this scene-block exists over a bare
 *  `WordStagger`. */
const QUOTE_STAGGER = STAGGER + 2

/** Divider geometry — a thin horizontal accent rule, never a full underline. */
const DIVIDER_WIDTH = 48
const DIVIDER_HEIGHT = 2

export interface QuoteCardProps {
  /** The pull-quote body. Revealed word-by-word on a slower-than-canonical
   *  stagger. */
  quote?: string
  /** Attribution name. */
  author?: string
  /** Attribution role / title. */
  role?: string
  /** Frames before the quote starts. */
  delay?: TimeInput
  /** Show the accent divider between quote and attribution. */
  accent?: boolean
  /** Quote font size in px. */
  quoteFontSize?: number
  /** Quote font weight (display default 600). */
  quoteFontWeight?: number
  /** Author / role font size in px. */
  authorFontSize?: number
  /** Author / role font weight. */
  authorFontWeight?: number
  /** Quote color (default: theme `text`). */
  color?: string
  /** Author / role color (default: theme `textMuted`). */
  authorColor?: string
  /** Divider color (default: theme `accent`). */
  accentColor?: string
  /** Loaded font family for every line (e.g. a `--font` passed to `onda render`) (default: theme `fontFamily`). */
  fontFamily?: string
  /** Wrap width for the quote in px. Defaults to ~44% of the composition width
   *  (the ondajs `40vw` pull-quote feel), so long quotes wrap onto multiple
   *  lines. */
  quoteWidth?: number
  /** Where the card sits: a region keyword (`'center'`, `'lower-third'`, ...) or
   *  normalized `{x,y}` (0-1, card center). The shared placement contract;
   *  default `'center'` (the historical self-centering). */
  placement?: Placement
}

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export function QuoteCard({
  quote = 'Motion is the difference between art and craft.',
  author = 'Saul Bass',
  role = 'Graphic Designer',
  delay: delayIn = 0,
  accent = true,
  quoteFontSize = 56,
  quoteFontWeight = 600,
  authorFontSize = 22,
  authorFontWeight = 500,
  color: colorProp,
  authorColor: authorColorProp,
  accentColor: accentColorProp,
  fontFamily: fontFamilyProp,
  quoteWidth,
  placement,
}: QuoteCardProps) {
  const frame = useCurrentFrame()
  const { fps, width } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const authorColor = authorColorProp ?? theme.textMuted
  const accentColor = accentColorProp ?? theme.accent
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  // ~40vw pull-quote feel when no explicit width is given.
  const resolvedQuoteWidth = quoteWidth ?? Math.round(width * 0.44)

  // The word count drives how long the quote takes to finish revealing — the
  // last word lands at (wordCount - 1) * QUOTE_STAGGER + DURATION.base.
  const words = quote.split(/\s+/).filter(Boolean)
  const wordCount = Math.max(1, words.length)
  const quoteRevealEnd = (wordCount - 1) * QUOTE_STAGGER + DURATION.base

  // A small breathing beat after the quote settles before the divider draws.
  const dividerDelay = delay + quoteRevealEnd + 8
  const dividerDuration = DURATION.base

  // Author + role fade in together after the divider lands.
  const attributionDelay = dividerDelay + dividerDuration + 4

  // Divider draw-on — width grows 0 → full from the left on the house spring,
  // expressed as a clip so the Rect's measured bbox (and the column layout)
  // never changes.
  const dividerProgress = spring({
    frame: Math.max(0, frame - dividerDelay),
    fps,
    config: SPRING_SMOOTH,
    durationInFrames: dividerDuration,
  })
  const dividerRevealed = interpolate(dividerProgress, [0, 1], [0, DIVIDER_WIDTH], CLAMP)

  return (
    // The flex column self-centers; PlacementShift moves the centered stack by
    // the center->placement delta (no-op for the default 'center').
    <PlacementShift placement={placement}>
      <AbsoluteFill justify="center" align="center">
        <Flex direction="column" align="center" gap={32}>
          {/* Quote — words stagger in slowly so the line reads. WordStagger's
            wrapping Flex wraps long quotes within `quoteWidth`. */}
          <WordStagger
            text={quote}
            delay={delay}
            stagger={QUOTE_STAGGER}
            justify="center"
            color={color}
            fontSize={quoteFontSize}
            fontFamily={fontFamily}
            fontWeight={quoteFontWeight}
            width={resolvedQuoteWidth}
          />

          {/* Divider — accent rule that draws in from the left. Skipped entirely
            when `accent` is false; the column gap still keeps the layout
            breathing. The full-size Rect reserves the slot; the clip reveals
            it. */}
          {accent ? (
            <Group clip={clipRect(dividerRevealed, DIVIDER_HEIGHT)}>
              <Rect width={DIVIDER_WIDTH} height={DIVIDER_HEIGHT} fill={accentColor} />
            </Group>
          ) : null}

          {/* Attribution — author + role fade in together after the divider; the
            role sits dim beneath the author in the same centered column. */}
          <Flex direction="column" align="center" gap={4}>
            <FadeIn delay={attributionDelay}>
              <Text
                fontSize={authorFontSize}
                color={color}
                fontFamily={fontFamily}
                fontWeight={authorFontWeight}
              >
                {author}
              </Text>
            </FadeIn>
            <FadeIn delay={attributionDelay}>
              <Text
                fontSize={authorFontSize}
                color={authorColor}
                fontFamily={fontFamily}
                fontWeight={authorFontWeight}
              >
                {role}
              </Text>
            </FadeIn>
          </Flex>
        </Flex>
      </AbsoluteFill>
    </PlacementShift>
  )
}
