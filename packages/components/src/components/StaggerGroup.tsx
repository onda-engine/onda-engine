//! StaggerGroup — reveals a list of items in sequence on the canonical Onda
//! stagger (`STAGGER` = 4 frames between siblings). Ported from ondajs.
//!
//! The composition primitive behind animated lists and sequenced reveals. Items
//! are a `string[]`, rendered as styled `<Text>` and laid out by the engine's
//! layout pass (taffy) via a single `<Flex>` (row or column). Each item enters
//! with the workhorse Onda entrance — `entryFadeRise` (opacity + a ~12px upward
//! rise on `SPRING_SMOOTH`) — offset by `staggerFrames(i, stagger)` so the eye
//! reads the cascade as one continuous beat. The same stagger rhythm as
//! `WordStagger`; keeping one cascade across the library is what makes the
//! fingerprint readable.
//!
//! Layout-safe rise: the per-item motion is applied on an INNER `<Group y>` that
//! is nested inside the direct `<Flex>` child. The layout pass only overwrites a
//! direct child's x/y, so the inner group's translate survives; and because a
//! translate is applied after layout, it does NOT change the item's measured box
//! and so does NOT make the row/column reflow as the cascade runs. The opacity
//! sits on the outer (layout-positioned) group, where it is always safe.
//!
//! This is NOT a `<Sequence>`-based component: every item renders on every frame
//! and per-item visibility is driven by the staggered local frame fed into
//! `entryFadeRise`, so frame N is correct with zero knowledge of frame N-1.

import { AbsoluteFill, Flex, Group, Text, useCurrentFrame, useVideoConfig } from '@onda-engine/react'
import { entryFadeRise } from '../choreography.js'
import { DURATION, STAGGER, staggerFrames } from '../motion.js'
import type { TextStyleProps } from '../text-style.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

export interface StaggerGroupProps extends TextStyleProps {
  /** The items to reveal, in source order (default: four short lines). */
  items?: string[]
  /** Frames before the FIRST item starts (default 0). */
  delay?: TimeInput
  /** Frames between consecutive items. Canonical Onda stagger is `4`. */
  stagger?: TimeInput
  /** Per-item reveal duration (default `DURATION.base` = 18). */
  duration?: TimeInput
  /** Layout direction for the items (default `'column'`). */
  direction?: 'row' | 'column'
  /** Pixels between items (default 16). */
  gap?: number
  /** Cross-axis alignment of items (default `'center'`). */
  align?: 'start' | 'center' | 'end'
  /** Font size in px (default 48). */
  fontSize?: number
}

export function StaggerGroup({
  items = ['Less is more', 'Calm is power', 'Motion has a feel', 'Made to be edited'],
  delay: delayIn = 0,
  stagger: staggerIn = STAGGER,
  duration: durationIn = DURATION.base,
  direction = 'column',
  gap = 16,
  align = 'center',
  color: colorProp,
  fontSize = 48,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
}: StaggerGroupProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const stagger = framesOf(staggerIn, fps)
  const duration = framesOf(durationIn, fps)
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  return (
    // Center the whole cascade in the composition. `AbsoluteFill` is a
    // full-size flex container; its center alignment positions the inner
    // `Flex` block. The inner `Flex` keeps `align` to control how the items
    // align relative to one another.
    <AbsoluteFill justify="center" align="center">
      <Flex direction={direction} align={align} gap={gap}>
        {items.map((item, i) => {
          // Per-item entrance, staggered. `entryFadeRise` clamps at both ends, so
          // the item is correct before it starts and after it has settled.
          const { opacity, y } = entryFadeRise({
            frame,
            fps,
            delay: delay + staggerFrames(i, stagger),
            durationInFrames: duration,
          })
          return (
            // Outer group: positioned by the layout pass; carries opacity (safe).
            // Inner group: carries the rise translate (survives layout; no reflow).
            <Group key={i} opacity={opacity}>
              <Group y={y}>
                <Text
                  fontSize={fontSize}
                  color={color}
                  fontFamily={fontFamily}
                  fontWeight={fontWeight}
                >
                  {item}
                </Text>
              </Group>
            </Group>
          )
        })}
      </Flex>
    </AbsoluteFill>
  )
}
