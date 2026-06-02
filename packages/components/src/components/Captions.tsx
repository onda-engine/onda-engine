//! Captions — sequential word-by-word captions driven by a timed transcript.
//! Ported from ondajs (`captions`).
//!
//! Each entry is a word plus its `[startMs, endMs)` window — the shape every
//! speech-to-text / transcript tool already speaks. The local frame (after
//! `delay`) is converted to milliseconds via `fps`, so the timeline is authored
//! in real-world ms and stays correct at any framerate. The currently-active
//! word lifts to `accentColor` with a subtle 4% `SPRING_SMOOTH` scale pulse over
//! its first frames of activation; surrounding words sit dim at `color` and
//! `opacity 0.7` so the sentence shape stays readable without competing with the
//! focal word. The active state is a BRIGHTNESS contrast (dim → text), not a rose
//! flash — captions arrive constantly and a per-word accent flash would burn.
//!
//! Scene-graph notes vs the ondajs (CSS) original:
//! - Words are laid out by the engine's layout pass (taffy) via a wrapping
//!   `<Flex direction="row" wrap>` with a fixed `width`, so a long transcript
//!   wraps onto multiple lines. Engine `<Text>` is single-line; one word per
//!   `<Text>` keeps each cell measurable.
//! - LAYOUT-SAFETY: scale/opacity on a direct Flex child are safe (the layout
//!   pass measures the node's UNSCALED box, then applies the transform after), so
//!   the pulse never reflows the row. A motion TRANSLATE would be clobbered — the
//!   pulse is scale-only, so no nesting is needed for position; we still wrap each
//!   word in an inner `<Group>` to carry the per-word scale/opacity while the
//!   outer cell is positioned by taffy.
//! - PIVOT CAVEAT: ondajs scales each word about `center bottom`; scene scale
//!   pivots about the node's LOCAL ORIGIN (top-left). At a 4% lift the positional
//!   drift is sub-pixel for caption-sized type, so this reads identically — the
//!   word grows in place rather than shifting. (Per-node transform-origin is a
//!   planned engine feature.)
//! - `letterSpacing` / `lineHeight` are CSS-only knobs the scene `<Text>` does
//!   not expose; they are accepted for prop-shape parity with ondajs but not
//!   applied (see `approximations`). Word spacing comes from the Flex `gap`
//!   (~0.3em) and line height from the engine's fixed text box instead.

import {
  AbsoluteFill,
  Flex,
  Group,
  Text,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import { SPRING_SMOOTH } from '../motion.js'

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
  /** Inactive word color (the Onda dim). */
  color?: string
  /** Active word color (the Onda text color). The contrast moment is brightness,
   *  not a rose accent — captions appear in batches and a rose pulse on every
   *  word would burn the eye. */
  accentColor?: string
  /** Font size in px. */
  fontSize?: number
  /** Loaded font family (e.g. a `--font` passed to `onda render`). */
  fontFamily?: string
  /** Font weight (display default 600). */
  fontWeight?: number
  /** CSS letter-spacing (e.g. `'-0.02em'`). Accepted for prop-shape parity with
   *  ondajs; the scene `<Text>` has no letter-spacing knob, so it is NOT applied
   *  (see `approximations`). */
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

const ALIGN_TO_JUSTIFY: Record<'left' | 'center' | 'right', 'start' | 'center' | 'end'> = {
  left: 'start',
  center: 'center',
  right: 'end',
}

// Vertical placement → AbsoluteFill column justification + a safe-margin pad so
// the block doesn't kiss the frame edge. taffy centers the wrapping block on the
// cross axis; the column justify positions it vertically.
const PLACEMENT_TO_JUSTIFY: Record<
  NonNullable<CaptionsProps['placement']>,
  'start' | 'center' | 'end'
> = {
  top: 'start',
  'upper-third': 'start',
  center: 'center',
  'lower-third': 'end',
  bottom: 'end',
}

export function Captions({
  captions = DEFAULT_CAPTIONS,
  delay = 0,
  color = '#8e8e98',
  accentColor = '#f2f2f4',
  fontSize = 96,
  fontFamily,
  fontWeight = 600,
  align = 'center',
  placement = 'lower-third',
  maxWidth = 0.8,
}: CaptionsProps) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()

  // Convert the local frame (after `delay`) into milliseconds so the captions
  // array can be authored in real-world ms. Pure function of the current frame —
  // any frame renders correctly without prior state.
  const local = Math.max(0, frame - delay)
  const currentMs = (local / fps) * 1000

  const justify = ALIGN_TO_JUSTIFY[align]
  const colJustify = PLACEMENT_TO_JUSTIFY[placement]

  // Word-spacing gap — ondajs used `0.3em`; mirror that relative to font size.
  const gap = Math.round(fontSize * 0.3)
  const blockWidth = Math.round(width * Math.max(0, Math.min(1, maxWidth)))

  // 'upper-third'/'lower-third' want a band offset rather than hard against the
  // edge; map the safe pad accordingly. A simple symmetric pad keeps the block
  // off the frame edge for `top`/`bottom`.
  const isThird = placement === 'upper-third' || placement === 'lower-third'
  const padY = isThird ? Math.round(height * 0.18) : Math.round(height * 0.08)

  return (
    <AbsoluteFill direction="column" justify={colJustify} align="center" padding={padY}>
      {/* The caption block. A wrapping row of word cells; taffy positions each
          word and wraps the line within `blockWidth`. */}
      <Flex direction="row" wrap justify={justify} align="center" gap={gap} width={blockWidth}>
        {captions.map((caption, i) => {
          const isActive = currentMs >= caption.startMs && currentMs < caption.endMs

          // Frame this word becomes active, in the component's local timeline,
          // drives the activation pulse — a 0→1 SPRING_SMOOTH ramp over its
          // first 4 frames. Restrained: only a 4% scale lift, no overshoot.
          const activationLocalFrame = local - (caption.startMs / 1000) * fps
          const pulse = spring({
            frame: activationLocalFrame,
            fps,
            config: SPRING_SMOOTH,
            durationInFrames: 4,
          })
          const pulseClamped = interpolate(pulse, [0, 1], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })

          const scale = isActive ? 1 + 0.04 * pulseClamped : 1
          const wordColor = isActive ? accentColor : color
          // Active word reads at full opacity; inactive words sit dimmer to push
          // focus to the active one without disappearing the surrounding context.
          const opacity = isActive ? 1 : 0.7

          return (
            // Outer cell is positioned by taffy; inner Group carries the
            // (layout-safe) scale + opacity pulse. Scale pivots top-left (see
            // header) — sub-pixel drift at this magnitude.
            <Group key={`${i}-${caption.startMs}-${caption.endMs}`}>
              <Group scaleX={scale} scaleY={scale} opacity={opacity}>
                <Text
                  fontSize={fontSize}
                  color={wordColor}
                  fontFamily={fontFamily}
                  fontWeight={fontWeight}
                >
                  {caption.text}
                </Text>
              </Group>
            </Group>
          )
        })}
      </Flex>
    </AbsoluteFill>
  )
}
