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

import {
  Group,
  Rect,
  Text,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import { DURATION, SPRING_SMOOTH, staggerFrames } from '../motion.js'
import { letterSpacingPx, measureText, useTextMetricsReady } from '../text-metrics.js'
import { type TextStyleProps, applyTextCase } from '../text-style.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

/** One word inside a phrase, with its own spoken `[startMs, endMs)` window. */
export interface CaptionWord {
  text: string
  startMs: number
  endMs: number
}

/** One transcript entry: a word and its `[startMs, endMs)` activation window. */
export interface CaptionEntry {
  text: string
  startMs: number
  endMs: number
  /** Optional per-word timing. When present, the WHOLE phrase shows at once and
   *  each word lights up the instant it is spoken (`currentMs` inside that word's
   *  `[startMs, endMs)`) — true word-synced karaoke — instead of the default
   *  cascade-timed reveal where words fade in on a fixed stagger and the accent
   *  follows that wave. The shape `onda transcribe` emits per segment. */
  words?: CaptionWord[]
}

export interface CaptionsProps extends TextStyleProps {
  /** The transcript timeline. Each entry is a word + its `[startMs, endMs)`
   *  window — the format every STT / transcript tool already speaks. */
  captions?: CaptionEntry[]
  /** Frames before the timeline starts (shifts every `startMs` by this). */
  delay?: TimeInput
  /** Active word color — the one earned accent, carried by the word the eye is
   *  currently landing on as the line cascades in (default: theme `accent`). */
  accentColor?: string
  /** Font size in px. */
  fontSize?: number
  /** Unitless line height. Accepted for prop-shape parity with ondajs; the scene
   *  `<Text>` has a fixed text box, so it is NOT applied (see `approximations`). */
  lineHeight?: number
  /** Text alignment of the caption block within its line(s). */
  align?: 'left' | 'center' | 'right'
  /** Vertical placement band of the block. Captions sit in the lower third by
   *  default; `'center'`/`'top'`/`'upper-third'`/`'bottom'` reposition it (the
   *  historical band values). A normalized `{x,y}` point (0-1, line center) is
   *  also accepted per the shared placement contract. */
  placement?:
    | 'center'
    | 'top'
    | 'bottom'
    | 'upper-third'
    | 'lower-third'
    | { x?: number; y?: number }
  /** Max line width as a 0–1 fraction of canvas width — the block wraps to more
   *  lines within this (default 0.8) instead of overflowing the frame. */
  maxWidth?: number
  /** Legibility backing so captions read over any footage (Text has no native
   *  stroke). `'shadow'` (default) drops a soft dark copy behind each word;
   *  `'outline'` rings each word in dark — the classic black-border caption that
   *  reads over ANYTHING; `'box'` lays a rounded translucent card behind the
   *  whole block (the CapCut subtitle look); `'none'` for clean plates. */
  backdrop?: 'none' | 'shadow' | 'outline' | 'box'
  /** Backing color for `'shadow'`/`'outline'`/`'box'` (default near-black). */
  backdropColor?: string
  /** How the active word is emphasized. `'color'` (default) recolors it to the
   *  accent; `'box'` seats it in a rounded accent pill with dark text (the
   *  dominant short-form caption look). */
  highlight?: 'color' | 'box'
}

const DEFAULT_CAPTIONS: CaptionEntry[] = [
  { text: 'Onda', startMs: 0, endMs: 1500 },
  { text: 'kinetic', startMs: 1500, endMs: 3000 },
  { text: 'captions', startMs: 3000, endMs: 4500 },
]

// Vertical placement → the caption baseline-band centre as a 0–1 fraction of
// canvas height. `lower-third` (the broadcast subtitle position, ~0.78) is the
// default; the others reposition the band toward an edge or centre.
const PLACEMENT_TO_BAND: Record<
  'center' | 'top' | 'bottom' | 'upper-third' | 'lower-third',
  number
> = {
  top: 0.12,
  'upper-third': 0.22,
  center: 0.5,
  'lower-third': 0.78,
  bottom: 0.88,
}

export function Captions({
  captions = DEFAULT_CAPTIONS,
  delay: delayIn = 0,
  color: colorProp,
  accentColor: accentColorProp,
  fontSize = 96,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
  letterSpacing,
  uppercase,
  align = 'center',
  placement = 'lower-third',
  maxWidth = 0.8,
  backdrop = 'shadow',
  backdropColor = '#000000',
  highlight = 'color',
}: CaptionsProps) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
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

  // Word source: per-word-timed (the whole phrase is shown and each word lights
  // up at its OWN spoken time — true karaoke) when `active.words` is supplied,
  // else the phrase text split on spaces (the default cascade reveal).
  const wordTimed = !!(active.words && active.words.length > 0)
  const srcWords = (
    wordTimed
      ? // biome-ignore lint/style/noNonNullAssertion: guarded by wordTimed
        active.words!
      : active.text
          .split(/\s+/)
          .filter(Boolean)
          .map((text) => ({ text, startMs: 0, endMs: 0 }))
  ).map((w) => ({ ...w, text: applyTextCase(w.text, { uppercase }) }))
  const spaceW = measureText(' ', fontSize, { fontFamily, fontWeight, letterSpacing: lsPx }).width
  const maxW = Math.max(0, Math.min(1, maxWidth))
  const maxWidthPx = width * maxW

  // Measure each word and pack them into LINES: a word that would push the
  // current line past `maxWidthPx` starts a new line (greedy wrap) instead of
  // running off-frame. `left` is the word's left edge within its own line;
  // `lineWidths[line]` is each line's shaped width (for per-line centering).
  const laid: { word: string; left: number; line: number; w: number; startMs: number }[] = []
  const lineWidths: number[] = []
  let line = 0
  let cursor = 0
  for (const sw of srcWords) {
    const ww = measureText(sw.text, fontSize, { fontFamily, fontWeight, letterSpacing: lsPx }).width
    if (cursor > 0 && cursor + ww > maxWidthPx) {
      lineWidths[line] = cursor - spaceW
      line += 1
      cursor = 0
    }
    laid.push({ word: sw.text, left: cursor, line, w: ww, startMs: sw.startMs })
    cursor += ww + spaceW
  }
  lineWidths[line] = Math.max(0, cursor - spaceW)
  const numLines = line + 1
  const widestLine = Math.max(...lineWidths)

  // Frames since this caption window opened — the clock its words cascade against.
  const activationLocalFrame = local - (active.startMs / 1000) * fps

  // The word currently carrying the accent. Word-timed: the latest word whose
  // spoken start has passed (so the glow rides the real voice and holds on the
  // last word through any gap). Default: the highest index whose stagger start
  // has passed (the freshest cascade reveal).
  let currentWord = 0
  laid.forEach((w, i) => {
    const reached = wordTimed ? currentMs >= w.startMs : activationLocalFrame >= staggerFrames(i)
    if (reached) currentWord = i
  })

  // Word-timed lines reveal as ONE block (a single settle on activation, words
  // stay put and only the accent moves); cascade lines lift word-by-word.
  const lineReveal = wordTimed
    ? spring({
        frame: activationLocalFrame,
        fps,
        config: SPRING_SMOOTH,
        durationInFrames: DURATION.base,
      })
    : 0

  // Horizontal anchor for the line's CENTRE, kept inside the `maxWidth` safe band
  // so left/right placements never kiss the frame edge.
  const margin = Math.round((width * (1 - Math.max(0, Math.min(1, maxWidth)))) / 2)
  const cx =
    typeof placement === 'object' && placement.x !== undefined
      ? placement.x * width
      : align === 'left'
        ? margin + widestLine / 2
        : align === 'right'
          ? width - margin - widestLine / 2
          : width / 2
  // Vertical anchor: the placement band centre (lower-third ≈ 0.78 by default,
  // the broadcast subtitle position), or a normalized point's y.
  const cy =
    typeof placement === 'object'
      ? (placement.y ?? 0.5) * height
      : height * PLACEMENT_TO_BAND[placement]

  // Each line's vertical centre, relative to the block centre (the Group origin):
  // line L sits at `(L - (numLines-1)/2) * lineHeight`, so the whole block stays
  // centred on the placement band whether it's one line or three.
  const lineCY = (l: number) => (l - (numLines - 1) / 2) * lineHeight
  // A word's left edge within the Group: its line is centred on cx.
  const wordX = (left: number, l: number) => left - (lineWidths[l] ?? 0) / 2

  // Drop-shadow offset for `backdrop: 'shadow'` — a soft dark copy down-right.
  const shOff = Math.max(1.5, fontSize * 0.05)

  return (
    // The Group sits at the band anchor; words are placed per line so the block
    // stays centred while each word reveals + the accent rides the voice.
    <Group x={cx} y={cy}>
      {/* `box` backdrop: one rounded card behind the whole (possibly multi-line)
          block, padded — the guaranteed-legible subtitle look. */}
      {backdrop === 'box' &&
        (() => {
          const padX = fontSize * 0.4
          const padY = fontSize * 0.22
          const boxW = widestLine + padX * 2
          const boxH = numLines * lineHeight + padY * 2
          return (
            <Rect
              x={-boxW / 2}
              y={-boxH / 2}
              width={boxW}
              height={boxH}
              cornerRadius={Math.min(boxH / 2, fontSize * 0.35)}
              // Translucent by default so the footage reads through the card; an
              // explicit `backdropColor` (incl. an 8-digit hex for alpha) wins.
              fill={backdropColor === '#000000' ? '#000000b3' : backdropColor}
              opacity={interpolate(lineReveal, [0, 1], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              })}
            />
          )
        })()}
      {laid.map(({ word, left, line: l, w: ww }, i) => {
        // Reveal ramp. Word-timed: the WHOLE line shares one settle (already
        // there before the voice arrives, only the accent moves). Default: a
        // per-word SPRING_SMOOTH ramp delayed by the stagger wave (cascade).
        const reveal = wordTimed
          ? lineReveal
          : spring({
              frame: activationLocalFrame - staggerFrames(i),
              fps,
              config: SPRING_SMOOTH,
              durationInFrames: DURATION.base,
            })
        const opacity = interpolate(reveal, [0, 1], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
        const ty = interpolate(reveal, [0, 1], [wordTimed ? 12 : 24, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
        // Karaoke accent: only the word the eye is landing on glows; the rest
        // settle to near-white (the last word stays accented once the line's in).
        const isCurrent = i === currentWord
        const x = wordX(left, l)
        const y = lineCY(l) - lineHeight / 2 + ty
        // Boxed active word: a rounded accent pill behind it, dark text on top.
        const boxed = highlight === 'box' && isCurrent
        const textColor = boxed ? '#0a0a0f' : isCurrent ? accentColor : restColor
        // Per-word legibility backing offsets `[dx, dy, alpha]`: `shadow` = one
        // soft copy down-right; `outline` = dark copies ringed around the word.
        const backing: [number, number, number][] = boxed
          ? []
          : backdrop === 'shadow'
            ? [[shOff, shOff, 0.55]]
            : backdrop === 'outline'
              ? [
                  [shOff, 0, 1],
                  [-shOff, 0, 1],
                  [0, shOff, 1],
                  [0, -shOff, 1],
                  [shOff, shOff, 1],
                  [-shOff, shOff, 1],
                  [shOff, -shOff, 1],
                  [-shOff, -shOff, 1],
                ]
              : []
        return (
          <Group key={i}>
            {boxed && (
              <Rect
                x={x - fontSize * 0.18}
                y={lineCY(l) - lineHeight * 0.42 + ty}
                width={ww + fontSize * 0.36}
                height={lineHeight * 0.84}
                cornerRadius={fontSize * 0.18}
                fill={accentColor}
                opacity={opacity}
              />
            )}
            {/* Per-word backing: `shadow` = one soft dark copy down-right;
                `outline` = dark copies ringed around the word (a real border
                that reads over anything). The `box` highlight already isolates
                the active word, so it skips the backing. */}
            {backing.map(([dx, dy, a], k) => (
              <Text
                key={k}
                x={x + dx}
                y={y + dy}
                fontSize={fontSize}
                color={backdropColor}
                fontFamily={fontFamily}
                fontWeight={fontWeight}
                letterSpacing={lsPx}
                opacity={opacity * a}
              >
                {word}
              </Text>
            ))}
            <Text
              x={x}
              y={y}
              fontSize={fontSize}
              color={textColor}
              fontFamily={fontFamily}
              fontWeight={fontWeight}
              letterSpacing={lsPx}
              opacity={opacity}
            >
              {word}
            </Text>
          </Group>
        )
      })}
    </Group>
  )
}
