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
//! the lower-third band by default (the broadcast subtitle position) and lifts in
//! with a subtle 4% `SPRING_SMOOTH` scale pulse over its first frames. The accent
//! is a BRIGHTNESS contrast (`text` over the dim canvas), not a rose flash —
//! captions arrive constantly and a per-caption accent flash would burn.
//!
//! Scene-graph notes vs the ondajs (CSS) original:
//! - The centered origin is derived from the caption's MEASURED width (the
//!   engine shapes the text — proportional, exact; a glyph-count estimate is the
//!   fallback until the wasm engine warms in the browser). The active caption is
//!   a single `<Text>`; its origin is recomputed per frame, but because only one
//!   caption shows at a time there is no row to reflow.
//! - The pulse scales about the caption's CENTRE: the `<Text>` is offset to
//!   `(-estW/2, -lineHeight/2)` inside a `<Group>` placed at the band anchor, so
//!   scene scale (which pivots on the group's LOCAL ORIGIN) grows the caption in
//!   place instead of drifting toward one corner.
//! - `letterSpacing` / `lineHeight` are CSS-only knobs the scene `<Text>` does
//!   not expose; they are accepted for prop-shape parity with ondajs but not
//!   applied (see `approximations`). Line height comes from the engine's fixed
//!   text box instead.

import { Group, Text, interpolate, spring, useCurrentFrame, useVideoConfig } from '@onda/react'
import { SPRING_SMOOTH } from '../motion.js'
import { useTextMetrics } from '../text-metrics.js'
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
  /** Inactive word color (the Onda dim). Accepted for prop-shape parity with
   *  ondajs; only the active caption is now drawn, so inactive words never appear
   *  and this is NOT applied (see `approximations`) (default: theme `textMuted`). */
  color?: string
  /** Active caption color (the Onda text color). The contrast moment is
   *  brightness against the dim canvas, not a rose accent — captions appear
   *  constantly and a rose pulse on every one would burn the eye (default: theme
   *  `text`). */
  accentColor?: string
  /** Font size in px. */
  fontSize?: number
  /** Loaded font family (e.g. a `--font` passed to `onda render`) (default: theme `fontFamily`). */
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
  accentColor: accentColorProp,
  fontSize = 96,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
  align = 'center',
  placement = 'lower-third',
  maxWidth = 0.8,
}: CaptionsProps) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const theme = useTheme()
  const accentColor = accentColorProp ?? theme.text
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

  // Real shaped width of the active caption. Measured unconditionally (the hook
  // must run every render) with an empty string in the gaps; the result is only
  // read once an active caption exists.
  const measured = useTextMetrics(active?.text ?? '', fontSize, { fontFamily, fontWeight })

  if (!active) return null

  // Activation pulse — a 0→1 SPRING_SMOOTH ramp over the caption's first 4
  // frames. Restrained: only a 4% scale lift, no overshoot.
  const activationLocalFrame = local - (active.startMs / 1000) * fps
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
  const scale = 1 + 0.04 * pulseClamped

  // Caption box: the engine measures the real shaped width (proportional —
  // exact; falls back to a glyph-count estimate until the wasm engine warms in
  // the browser) and a fixed 1.2em line box.
  const estWidth = measured.width
  const lineHeight = fontSize * 1.2

  // Horizontal anchor for the caption's CENTRE, kept inside the `maxWidth`
  // safe band so left/right placements never kiss the frame edge.
  const margin = Math.round((width * (1 - Math.max(0, Math.min(1, maxWidth)))) / 2)
  const cx =
    align === 'left'
      ? margin + estWidth / 2
      : align === 'right'
        ? width - margin - estWidth / 2
        : width / 2
  // Vertical anchor: the placement band centre (lower-third ≈ 0.78 by default).
  const cy = height * PLACEMENT_TO_BAND[placement]

  return (
    // The Group sits at the band anchor; the `<Text>` is offset to its own
    // centre so the scale pulse (which pivots on the group's LOCAL ORIGIN)
    // grows the caption in place rather than drifting toward a corner.
    <Group x={cx} y={cy} scaleX={scale} scaleY={scale}>
      <Text
        x={-estWidth / 2}
        y={-lineHeight / 2}
        fontSize={fontSize}
        color={accentColor}
        fontFamily={fontFamily}
        fontWeight={fontWeight}
      >
        {active.text}
      </Text>
    </Group>
  )
}
