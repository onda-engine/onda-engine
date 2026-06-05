//! Captions — sequential captions driven by a timed transcript.
//! Ported from ondajs (`captions`).
//!
//! Each entry is a caption (a word or short phrase) plus its `[startMs, endMs)`
//! window — the shape every speech-to-text / transcript tool already speaks. The
//! local frame (after `delay`) is converted to milliseconds via `fps`, so the
//! timeline is authored in real-world ms and stays correct at any framerate.
//!
//! Only the ACTIVE caption — the one whose `[startMs, endMs)` window contains the
//! current time — is on screen at any frame; captions replace one another in
//! place rather than the whole transcript piling up. The active caption sits in
//! the lower-third band by default (the broadcast subtitle position). Its words
//! don't pop in: they lift the house move — a small `translateY` + opacity fade
//! on `SPRING_SMOOTH`, cascaded word-by-word on the canonical `staggerFrames`
//! wave so the line reads as a settled reveal, not a flash. The word the eye is
//! landing on carries the one earned `accent`; words it has already passed settle
//! back to near-white `text` — the karaoke contrast every premium captioner uses.
//!
//! Scene-graph notes vs the ondajs (CSS) original:
//! - The centered origin is derived from the caption's MEASURED width (the
//!   engine shapes the text — proportional, exact; a glyph-count estimate is the
//!   fallback until the wasm engine warms in the browser). Each word is its own
//!   `<Text>`, laid out left-to-right by the cumulative measured advance of the
//!   words before it, so the line stays centered and the per-word colors/reveals
//!   never reflow it. Only one caption window shows at a time, so there is no row
//!   to stack.
//! - Per-word reveal offsets the `<Text>` by its own `translateY`; the whole line
//!   is centered inside a `<Group>` placed at the band anchor, so the lift grows
//!   the words in place instead of drifting the block toward a corner.
//! - `letterSpacing` / `lineHeight` are CSS-only knobs the scene `<Text>` does
//!   not expose; `letterSpacing` is folded into the measured width so centering
//!   stays exact; `lineHeight` is accepted for prop-shape parity with ondajs but
//!   not applied (see `approximations`). Line height comes from the engine's
//!   fixed text box instead.

import { Group, Text, interpolate, spring, useCurrentFrame, useVideoConfig } from '@onda/react'
import { DURATION, SPRING_SMOOTH, staggerFrames } from '../motion.js'
import { letterSpacingPx, measureText, useTextMetricsReady } from '../text-metrics.js'
import { useTheme } from '../theme.js'

/** One transcript entry: a word and its `[startMs, endMs)` activation window. */
export interface CaptionEntry {
  text: string
  startMs: number
  endMs: number
}

export interface CaptionsProps {
  /** The transcript timeline. Each entry is a word + its `[startMs, endMs)`
   *  window — the format every STT / transcript tool already speaks. */
  captions?: CaptionEntry[]
  /** Frames before the timeline starts (shifts every `startMs` by this). */
  delay?: number
  /** Settled word color — the near-white tone a word relaxes to once the eye has
   *  landed past it (the karaoke "already read" state) (default: theme `text`). */
  color?: string
  /** Active word color — the one earned accent, carried by the word the eye is
   *  currently landing on as the line cascades in (default: theme `accent`). */
  accentColor?: string
  /** Font size in px. */
  fontSize?: number
  /** Loaded font family (e.g. a `--font` passed to `onda render`) (default: theme `fontFamily`). */
  fontFamily?: string
  /** Font weight (display default 600). */
  fontWeight?: number
  /** CSS letter-spacing (e.g. `'-0.02em'` or `'2px'`). Applied to the caption
   *  text and folded into its measured width so centering stays exact. */
  letterSpacing?: string
  /** Unitless line height. Accepted for prop-shape parity with ondajs; the scene
   *  `<Text>` has a fixed text box, so it is NOT applied (see `approximations`). */
  lineHeight?: number
  /** Text alignment of the caption block within its line(s). */
  align?: 'left' | 'center' | 'right'
  /** Vertical placement band of the block. Captions sit in the lower third by
   *  default; `'center'`/`'top'`/`'upper-third'`/`'bottom'` reposition it. */
  placement?: 'center' | 'top' | 'bottom' | 'upper-third' | 'lower-third'
  /** Max line width as a 0–1 fraction of canvas width — the block wraps within
   *  this (default 0.8). */
  maxWidth?: number
}

const DEFAULT_CAPTIONS: CaptionEntry[] = [
  { text: 'Onda', startMs: 0, endMs: 1500 },
  { text: 'kinetic', startMs: 1500, endMs: 3000 },
  { text: 'captions', startMs: 3000, endMs: 4500 },
]

// Vertical placement → the caption baseline-band centre as a 0–1 fraction of
// canvas height. `lower-third` (the broadcast subtitle position, ~0.78) is the
// default; the others reposition the band toward an edge or centre.
const PLACEMENT_TO_BAND: Record<NonNullable<CaptionsProps['placement']>, number> = {
  top: 0.12,
  'upper-third': 0.22,
  center: 0.5,
  'lower-third': 0.78,
  bottom: 0.88,
}

export function Captions({
  captions = DEFAULT_CAPTIONS,
  delay = 0,
  color: colorProp,
  accentColor: accentColorProp,
  fontSize = 96,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
  letterSpacing,
  align = 'center',
  placement = 'lower-third',
  maxWidth = 0.8,
}: CaptionsProps) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const theme = useTheme()
  // The active word carries the one earned accent; words the eye has passed
  // settle back to near-white `text`.
  const accentColor = accentColorProp ?? theme.accent
  const restColor = colorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  // Convert the local frame (after `delay`) into milliseconds so the captions
  // array can be authored in real-world ms. Pure function of the current frame —
  // any frame renders correctly without prior state.
  const local = Math.max(0, frame - delay)
  const currentMs = (local / fps) * 1000

  // Only the ACTIVE caption shows — the one whose `[startMs, endMs)` window
  // contains the current time. Captions replace one another in place; nothing
  // renders in the gaps between windows. Pure function of the current frame.
  const active = captions.find((c) => currentMs >= c.startMs && currentMs < c.endMs)

  // Warm the metrics engine (browser) so the per-word `measureText` calls below
  // return real shaped advances; the hook must run every render. The fallback is
  // the glyph-count estimate until the wasm engine warms.
  useTextMetricsReady()

  if (!active) return null

  const lsPx = letterSpacingPx(letterSpacing, fontSize)
  const lineHeight = fontSize * 1.2

  // Split the active caption (a word or short phrase) into words so each can
  // cascade in on the house stagger. A single space rejoins them for layout.
  const words = active.text.split(/\s+/).filter(Boolean)
  const spaceW = measureText(' ', fontSize, { fontFamily, fontWeight, letterSpacing: lsPx }).width

  // Measure each word and lay them out left-to-right by the cumulative advance
  // of the words before it. `left` is the word's left edge from the line's own
  // left edge; `lineWidth` is the total shaped width used to center the line.
  let cursor = 0
  const laid = words.map((word) => {
    const w = measureText(word, fontSize, { fontFamily, fontWeight, letterSpacing: lsPx }).width
    const left = cursor
    cursor += w + spaceW
    return { word, left }
  })
  const lineWidth = Math.max(0, cursor - spaceW)

  // Frames since this caption window opened — the clock its words cascade against.
  const activationLocalFrame = local - (active.startMs / 1000) * fps

  // The word the eye is landing on right now: the highest index whose stagger
  // start has passed (so the freshest reveal). It carries the accent; the rest
  // settle to near-white. Clamps to the last word once the whole line is in.
  let currentWord = 0
  for (let i = 0; i < laid.length; i++) {
    if (activationLocalFrame >= staggerFrames(i)) currentWord = i
  }

  // Horizontal anchor for the line's CENTRE, kept inside the `maxWidth` safe band
  // so left/right placements never kiss the frame edge.
  const margin = Math.round((width * (1 - Math.max(0, Math.min(1, maxWidth)))) / 2)
  const cx =
    align === 'left'
      ? margin + lineWidth / 2
      : align === 'right'
        ? width - margin - lineWidth / 2
        : width / 2
  // Vertical anchor: the placement band centre (lower-third ≈ 0.78 by default).
  const cy = height * PLACEMENT_TO_BAND[placement]

  return (
    // The Group sits at the band anchor; the words are placed from the line's
    // own left edge (`-lineWidth/2`) so the centered line stays put while each
    // word lifts its own `translateY` into place.
    <Group x={cx} y={cy}>
      {laid.map(({ word, left }, i) => {
        // House reveal: a 0→1 SPRING_SMOOTH ramp, the i-th word delayed by the
        // canonical stagger wave. No pop-in — opacity fades and the word lifts a
        // small `translateY` (24→0px) as it settles.
        const reveal = spring({
          frame: activationLocalFrame - staggerFrames(i),
          fps,
          config: SPRING_SMOOTH,
          durationInFrames: DURATION.base,
        })
        const opacity = interpolate(reveal, [0, 1], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
        const ty = interpolate(reveal, [0, 1], [24, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
        // Karaoke accent: only the word the eye is currently landing on glows
        // accent; the rest settle to near-white (the last word stays accented
        // once the whole line has arrived).
        const isCurrent = i === currentWord
        return (
          <Text
            // biome-ignore lint/suspicious/noArrayIndexKey: words are positional within a fixed line
            key={i}
            x={left - lineWidth / 2}
            y={-lineHeight / 2 + ty}
            fontSize={fontSize}
            color={isCurrent ? accentColor : restColor}
            fontFamily={fontFamily}
            fontWeight={fontWeight}
            letterSpacing={lsPx}
            opacity={opacity}
          >
            {word}
          </Text>
        )
      })}
    </Group>
  )
}
