//! BlurReveal — the reference Onda reveal: opacity + a small rise + a real
//! soft→sharp focus-pull, all on the house spring (no overshoot). Ported from
//! ondajs.
//!
//! The blur is FIRST-CLASS: the engine's render-to-texture pass blurs the
//! subtree and composites it back, so the literal ondajs `blur(10px → 0)` ramp
//! is reproduced directly (a `blur` prop on the inner motion `<Group>`) — no
//! scale-settle stand-in. The text resolves from soft to sharp as it rises and
//! fades in, on both backends.
//!
//! Self-positioning: an `<AbsoluteFill>` centers the content, and the motion
//! (opacity + rise + blur) lives on a NESTED inner `<Group>` — the layout pass
//! owns the outer position, so a motion translate must not sit on a direct
//! AbsoluteFill child.

import {
  AbsoluteFill,
  Group,
  Text,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import type { ReactNode } from 'react'
import { useFittedFontSize } from '../bounds.js'
import { DURATION, SPRING_SMOOTH } from '../motion.js'
import { type Placement, PlacementShift } from '../placement.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

export interface BlurRevealProps {
  /** What to reveal. Rendered as a single-line `<Text>` unless `children` is
   *  provided. */
  text?: string
  /** Custom content to reveal instead of `text` (wins over `text` when both are
   *  given). Lets BlurReveal wrap any subtree, not just a string. */
  children?: ReactNode
  /** Frames before the reveal starts. */
  delay?: TimeInput
  /** Frames until the reveal fully settles (default `DURATION.base` = 18). With
   *  `SPRING_SMOOTH` the visible motion settles in roughly this range. */
  durationInFrames?: TimeInput
  /** Text color (hex `#rrggbb` / `#rrggbbaa`). Ignored when `children` is set.
   *  (default: theme `text`) */
  color?: string
  /** Text size in px. Ignored when `children` is set. */
  fontSize?: number
  /** Opt-in auto-fit: `'frame'` scales the font size DOWN (never up) so the
   *  measured line cannot exceed the frame minus the safe margins. Default
   *  `'none'` (the historical behavior). */
  fit?: 'none' | 'frame'
  /** Explicit width cap in px for the line; combines with `fit` (the smaller
   *  cap wins). */
  maxWidth?: number // (Ignored when `children` is set.)
  /** Loaded font family. Ignored when `children` is set. (default: theme `fontFamily`) */
  fontFamily?: string
  /** Font weight (display default 600). Ignored when `children` is set. */
  fontWeight?: number
  /** Where the reveal sits. The legacy `'top'`/`'bottom'` keywords keep their
   *  historical edge-flush meaning (layout `justify`); every other region
   *  keyword and normalized `{x,y}` (0-1, content center) goes through the
   *  shared placement contract. Default `'center'`. */
  placement?: Placement
  /** Rise distance in px (the original's 16px envelope; small on purpose). */
  travelPx?: number
  /** Starting blur in px (gaussian sigma) for the soft→sharp focus-pull; ramps
   *  to 0 as the reveal settles (the ondajs original's `blur(10px → 0)`). */
  fromBlur?: number
}

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export function BlurReveal({
  text = 'Onda',
  children,
  delay: delayIn = 0,
  durationInFrames: durationInFramesIn = DURATION.base,
  color: colorProp,
  fontSize: fontSizeProp = 96,
  fit,
  maxWidth,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
  placement = 'center',
  travelPx = 16,
  fromBlur = 10,
}: BlurRevealProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const durationInFrames = framesOf(durationInFramesIn, fps)
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  // Opt-in auto-fit for the single-line `text` form (children own their box).
  const fontSize = useFittedFontSize(text, fontSizeProp, { fontFamily, fontWeight, fit, maxWidth })

  // One house spring drives opacity, rise, and the focus-pull blur so they read
  // as a single motion — mirrors the ondajs original, where opacity, blur, and
  // the 16px rise all derive from one `SPRING_SMOOTH` progress.
  const progress = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: SPRING_SMOOTH,
    durationInFrames,
  })

  const opacity = interpolate(progress, [0, 1], [0, 1], CLAMP)
  const y = interpolate(progress, [0, 1], [travelPx, 0], CLAMP)
  // Real soft→sharp focus-pull: the engine's render-to-texture pass blurs the
  // subtree by `blur` px, ramping fromBlur → 0 as the reveal settles.
  const blur = interpolate(progress, [0, 1], [fromBlur, 0], CLAMP)

  // Legacy keywords keep their exact pre-contract behavior (edge-flush via the
  // layout pass); everything else resolves through the shared contract.
  const isLegacy = placement === 'center' || placement === 'top' || placement === 'bottom'
  const justify = placement === 'top' ? 'start' : placement === 'bottom' ? 'end' : 'center'

  const content: ReactNode = children ?? (
    <Text fontSize={fontSize} color={color} fontFamily={fontFamily} fontWeight={fontWeight}>
      {text}
    </Text>
  )

  return (
    <PlacementShift placement={isLegacy ? undefined : placement}>
      <AbsoluteFill justify={isLegacy ? justify : 'center'} align="center">
        {/* Inner group carries the motion translate/blur/opacity; the outer
            AbsoluteFill owns positioning (don't translate a direct layout child). */}
        <Group y={y} blur={blur} opacity={opacity}>
          {content}
        </Group>
      </AbsoluteFill>
    </PlacementShift>
  )
}
