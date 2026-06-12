//! WordRotate — cycle a list of phrases in place, one at a time. Ported from ondajs.
//!
//! Faithful to the ondajs original: phrases are stacked at the SAME point and
//! only one is visible at a time. Each phrase rises in on `SPRING_SMOOTH`
//! (translateY 12 → 0), holds at full opacity, then fades down as the next
//! arrives — the outgoing fade and incoming fade share frames so the swap reads
//! as one motion. The opacity envelope is a 4-point keyframe on `HOUSE_EASE`,
//! matching ondajs exactly. Slot timing: `slot = holdDuration + transitionDuration`
//! and phrase `i` starts at `delay + i * slot`. After the last phrase has held,
//! everything is faded out (no wrap-around — same as ondajs).
//!
//! Layout / placement notes (vs the ondajs/CSS original):
//!  - ondajs stacks the phrases with an `inline-grid` (`gridArea: 'phrase'`) and
//!    aligns them with CSS `justifySelf`/`text-align`. The engine has no CSS grid
//!    and `<Text>` is single-line + engine-measured, but the measured width is
//!    not available synchronously at author time. So the phrases are positioned
//!    ABSOLUTELY at an explicit `x`/`y` on a `<Group>` (NOT inside a `<Flex>`/
//!    `<AbsoluteFill>` — overlapping siblings would otherwise be stacked into a
//!    column by the layout pass, and a per-frame translate on a layout child is
//!    clobbered, HARD RULE 2). Each phrase nests an inner `<Group y={...}>` for
//!    the rise so the absolute placement (outer) and the motion translate (inner)
//!    don't fight.
//!  - Horizontal alignment (`align`) uses the REAL shaped phrase width
//!    (`measureText`) to shift the anchor left/center/right — exact, falling back
//!    to a glyph-count estimate only until the engine warms in the browser.
//!  - `letterSpacing` and `lineHeight` from the ondajs schema are dropped: the
//!    scene `<Text>` exposes neither. Phrases are single words/short phrases, so
//!    line-height is moot; letter-spacing has no engine primitive.
//!  - `size` (semantic typography role) and the `placement` region system are
//!    dropped in favor of explicit `fontSize` and `x`/`y` (defaulting to the
//!    composition center), matching how the other ported components place
//!    themselves.

import { Group, Text, interpolate, spring, useCurrentFrame, useVideoConfig } from '@onda/react'
import { HOUSE_EASE } from '../easing.js'
import { SPRING_SMOOTH } from '../motion.js'
import { measureText, useTextMetricsReady } from '../text-metrics.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export interface WordRotateProps {
  /** Phrases cycled in place, in order. One is visible at a time. */
  phrases?: string[]
  /** Frames before the first phrase begins to enter (default `0`). */
  delay?: TimeInput
  /** Frames each phrase holds at full opacity before the next arrives
   *  (default `30`). */
  holdDuration?: TimeInput
  /** Frames for a single phrase to fade in (and, separately, fade out)
   *  (default `12`). */
  transitionDuration?: number
  /** Text color (default: theme `text`). */
  color?: string
  /** Font size in px. Phrases are usually large (default `96`). */
  fontSize?: number
  /** Loaded font family (e.g. a `--font` passed to `onda render`) (default: theme `fontFamily`). */
  fontFamily?: string
  /** Font weight (display default `600`). */
  fontWeight?: number
  /** Italic text (default `false`). */
  italic?: boolean
  /** Horizontal anchor of each phrase relative to `x` (default `'left'`).
   *  `'center'`/`'right'` use an estimated text width (see doc comment). */
  align?: 'left' | 'center' | 'right'
  /** Absolute x of the anchor point. Defaults to the composition center. */
  x?: number
  /** Absolute y (top-ish) of the text. Defaults to vertical center. */
  y?: number
}

export function WordRotate({
  phrases = ['fast', 'beautiful', 'restrained'],
  delay: delayIn = 0,
  holdDuration: holdDurationIn = 30,
  transitionDuration = 12,
  color: colorProp,
  fontSize = 96,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
  italic = false,
  align = 'left',
  x,
  y,
}: WordRotateProps) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const holdDuration = framesOf(holdDurationIn, fps)
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.fontFamily
  // Warm real text measurement (browser re-renders when ready); per-phrase widths
  // are read with the sync `measureText` inside the map below.
  useTextMetricsReady()

  // Each phrase's slot overlaps its neighbor's by `transitionDuration` — the
  // outgoing fade and the incoming fade share frames, so the swap reads as one
  // motion rather than two. (Verbatim ondajs timing.)
  const slot = holdDuration + transitionDuration

  // Default the anchor to the composition center; roughly center the single
  // line vertically by lifting the top by ~0.6 of the cap height.
  const ax = x ?? Math.round(width / 2)
  const py = y ?? Math.round(height / 2 - fontSize * 0.6)

  return (
    <Group x={ax} y={py}>
      {phrases.map((phrase, i) => {
        const phraseStart = delay + i * slot
        const local = frame - phraseStart

        const rise = spring({
          frame: local,
          fps,
          config: SPRING_SMOOTH,
          durationInFrames: transitionDuration,
        })
        const translateY = interpolate(rise, [0, 1], [12, 0], CLAMP)

        const opacity = interpolate(
          local,
          [0, transitionDuration, transitionDuration + holdDuration, slot + transitionDuration],
          [0, 1, 1, 0],
          { ...CLAMP, easing: HOUSE_EASE },
        )

        // Anchor offset: 'left' is exact; 'center'/'right' use the real shaped
        // width (measured) so alignment hugs the actual phrase.
        const estWidth = measureText(phrase, fontSize, { fontFamily, fontWeight }).width
        const offsetX = align === 'center' ? -estWidth / 2 : align === 'right' ? -estWidth : 0

        return (
          <Group key={`${i}-${phrase}`} x={offsetX} y={translateY} opacity={opacity}>
            <Text
              fontSize={fontSize}
              color={color}
              fontFamily={fontFamily}
              fontWeight={fontWeight}
              italic={italic}
            >
              {phrase}
            </Text>
          </Group>
        )
      })}
    </Group>
  )
}
