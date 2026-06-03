//! WordStagger — split a phrase into words and reveal them left-to-right with a
//! per-word stagger. Ported from ondajs.
//!
//! Words are laid out by the engine's layout pass (taffy) via a wrapping
//! `<Flex direction="row" wrap>` with a fixed `width`, so long phrases wrap onto
//! multiple lines. Each word is wrapped in `FadeIn` — OPACITY-ONLY on purpose:
//! a per-word translate would be clobbered by the layout pass and, worse, a
//! per-frame translate would grow each word's bbox and make the whole line
//! reflow/jiggle as the cascade runs. ondajs uses `entryFadeRise` (a small rise)
//! because it animates CSS `transform` on inline-blocks that don't reflow the
//! flow; here a pure fade is the faithful, layout-safe equivalent. See
//! `approximations` in the port notes.

import { AbsoluteFill, Flex, Text } from '@onda/react'
import { staggerFrames } from '../motion.js'
import { useTheme } from '../theme.js'
import { FadeIn } from './FadeIn.js'

export interface WordStaggerProps {
  /** The phrase. Split on whitespace into one reveal per word. */
  text?: string
  /** Font size in px (default 64). */
  fontSize?: number
  /** Text color (default: theme `text`). */
  color?: string
  /** Container width in px — the line wraps within this (default 1080). */
  width?: number
  /** Loaded font family (e.g. a `--font` passed to `onda render`) (default: theme `fontFamily`). */
  fontFamily?: string
  /** Font weight (display default 600). */
  fontWeight?: number
  /** Horizontal alignment of words within each line (default `'start'`). */
  justify?: 'start' | 'center' | 'end'
  /** Frames before the FIRST word starts (default 0). */
  delay?: number
  /** Frames between consecutive words (default `STAGGER` = 4). */
  stagger?: number
}

export function WordStagger({
  text = 'motion that moves you',
  fontSize = 64,
  color: colorProp,
  width = 1080,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
  justify = 'start',
  delay = 0,
  stagger,
}: WordStaggerProps) {
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  // Split on any run of whitespace; drop empties so leading/trailing spaces in
  // the prop don't create ghost words that delay the cascade.
  const words = text.split(/\s+/).filter(Boolean)

  return (
    <AbsoluteFill justify="center" align="center">
      <Flex direction="row" wrap justify={justify} gap={Math.round(fontSize * 0.3)} width={width}>
        {words.map((word, i) => (
          <FadeIn key={`${i}-${word}`} delay={delay + staggerFrames(i, stagger)}>
            <Text fontSize={fontSize} color={color} fontFamily={fontFamily} fontWeight={fontWeight}>
              {word}
            </Text>
          </FadeIn>
        ))}
      </Flex>
    </AbsoluteFill>
  )
}
