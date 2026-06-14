//! TextFadeReplace — crossfade between an old and a new phrase in place. Ported from ondajs.
//!
//! ondajs cycles through a list of phrases, crossfading one into the next so the
//! layout never shifts. This port takes the simplified two-phrase shape the
//! engine batch asked for: a single `from` -> `to` swap. Both phrases are
//! rendered (layered in the same slot) so the swap stays put — `from` rides
//! `outOpacity`, `to` rides `inOpacity`, both from the ported `stateSwap`
//! choreography (a HOUSE_EASE crossfade: old fades out over the first half of
//! the window, new fades in over the second).
//!
//! Layout: the two `<Text>` nodes are layered at the SAME local origin (0,0)
//! inside one `<Group>`, and that single Group is the only child of an
//! `<AbsoluteFill justify="center" align="center">`, so the engine layout pass
//! (taffy) centers the whole block. Only opacity animates per phrase and both
//! phrases are present every frame, so the Group's measured size never changes —
//! this is layout-safe (no per-frame size change, no reflow). Sharing the origin
//! keeps the swap perfectly in place vertically (no negative-translate guess,
//! which would be off by the engine's 1.2x line-box height).
//!
//! Engine notes (vs the ondajs/CSS original):
//!  - The two phrases are anchored at a shared TOP-LEFT origin (block-centered by
//!    the layout pass), not per-phrase center-aligned: the scene `<Text>` has no
//!    measurement-free `text-align`, so phrases of different widths share a left
//!    edge rather than a center. ondajs used CSS `justify-content` for this.
//!  - No `letter-spacing` / `line-height` / `placement` region system on the
//!    scene `<Text>`; centering is handled by the layout pass.
//!  - `<Text>` is single-line (no wrap) — `from`/`to` are expected to be short
//!    phrases (taglines / value props), matching the ondajs use case.

import { AbsoluteFill, Group, Text, useCurrentFrame } from '@onda/react'
import { stateSwap } from '../choreography.js'
import { DURATION } from '../motion.js'
import { type TextStyleProps, applyTextCase } from '../text-style.js'
import { useTheme } from '../theme.js'
import type { TimeInput } from '../time.js'

export interface TextFadeReplaceProps extends TextStyleProps {
  /** The outgoing phrase (shown first, fades out). */
  from: string
  /** The incoming phrase (fades in over `from`). */
  to: string
  /** Frames before the crossfade begins. Until then only `from` is shown
   *  (default `DURATION.hold` = 45, a settled beat before the swap). */
  delay?: TimeInput
  /** Frames the crossfade takes — old out over the first half, new in over the
   *  second (default `DURATION.base` = 18). */
  durationInFrames?: TimeInput
  /** Font size in px (default `96`, matching the ondajs display default). */
  fontSize?: number
}

export function TextFadeReplace({
  from: fromProp,
  to: toProp,
  delay = DURATION.hold,
  durationInFrames = DURATION.base,
  fontSize = 96,
  color: colorProp,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
  italic = false,
  letterSpacing,
  uppercase,
}: TextFadeReplaceProps) {
  // Both phrases are primary text — uppercase each before render.
  const from = applyTextCase(fromProp, { uppercase })
  const to = applyTextCase(toProp, { uppercase })
  const frame = useCurrentFrame()
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.headingFamily ?? theme.fontFamily

  // In-place crossfade on HOUSE_EASE: old fades out over the first half of the
  // window, new fades in over the second. Both are rendered (layered, same
  // origin) so the container never shifts.
  const { outOpacity, inOpacity } = stateSwap({ frame, delay, durationInFrames })

  return (
    <AbsoluteFill justify="center" align="center">
      {/* One layout child (block-centered by taffy). Both phrases live at the
          same local origin so the swap stays put — only opacity animates. */}
      <Group>
        <Group opacity={outOpacity}>
          <Text
            fontSize={fontSize}
            color={color}
            fontFamily={fontFamily}
            fontWeight={fontWeight}
            italic={italic}
            letterSpacing={letterSpacing}
          >
            {from}
          </Text>
        </Group>
        <Group opacity={inOpacity}>
          <Text
            fontSize={fontSize}
            color={color}
            fontFamily={fontFamily}
            fontWeight={fontWeight}
            italic={italic}
            letterSpacing={letterSpacing}
          >
            {to}
          </Text>
        </Group>
      </Group>
    </AbsoluteFill>
  )
}
