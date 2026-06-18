//! SplitScreen — two side-by-side (or stacked) content panes divided by a thin
//! token line. Ported from ondajs (`split-screen`).
//!
//! A container — the documented exception to the "self-contained" rule, since
//! wrapping arbitrary `left`/`right` content (any scene subtree) is its whole
//! job. The two panes are positioned ABSOLUTELY with explicit x/y (not `<Flex>`):
//! when `animate`, each pane translates a few px every frame, and a layout
//! container would reflow as the measured bbox shifted. Pane sizes are derived
//! from the overall `width`/`height`, `ratio`, `gap`, and `divider` so the math
//! is deterministic and frame-pure.
//!
//! Entrance: matching ondajs, the panes start pulled IN toward the center seam
//! and SPREAD APART to settle — the left/top pane starts displaced toward the
//! center and slides out to the left/top, the right/bottom pane starts toward
//! the center and slides out to the right/bottom — a 16px travel on the house
//! spring. (ondajs drives this via `useEntrance({type:'slide', direction:'left'})`
//! for the first pane and `'right'` for the second; in its `entrySlide` the sign
//! convention has `'up'`/`'left'` start at `+distance`, so both panes begin near
//! the seam.) Each pane is clipped to its own rect so animated/overflowing
//! content stays inside its panel.
//!
//! Approximations vs ondajs (CSS):
//!  - The empty-pane placeholder label uses `letterSpacing` in ondajs; the
//!    engine has no letter-spacing, so the placeholder is drawn without it, and
//!    its horizontal centering is estimated from glyph advance (a pure
//!    frame→scene function can't read the engine's measured text box back).
//!  - ondajs honors a `placement` prop via `PlacementBox`; like the other ports
//!    (Spotlight, Marquee) this centers the box in the composition instead.

import {
  Group,
  Rect,
  Text,
  clipRect,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda-engine/react'
import type { ReactNode } from 'react'
import { DURATION, SPRING_SMOOTH } from '../motion.js'
import type { TextStyleProps } from '../text-style.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

export interface SplitScreenProps extends TextStyleProps {
  /** Content for the left (or top) pane — any scene subtree. */
  left?: ReactNode
  /** Content for the right (or bottom) pane — any scene subtree. */
  right?: ReactNode
  /** Pane axis: `horizontal` = side-by-side, `vertical` = stacked. */
  orientation?: 'horizontal' | 'vertical'
  /** Fraction (0..1) of the main axis given to the `left` (or top) pane. */
  ratio?: number
  /** Gap between the two panes in px. */
  gap?: number
  /** Draw a thin token divider in the gap between the panes. */
  divider?: boolean
  /** Slide the two panes apart from the center seam on the house spring. */
  animate?: boolean
  /** Frames before the entrance. */
  delay?: TimeInput
  /** Overall width in px. Defaults to the full composition width. */
  width?: number
  /** Overall height in px. Defaults to the full composition height. */
  height?: number
  /** Pane background fill (default: theme `surface`). */
  paneBackground?: string
  /** Outer (gutter) background fill, seen in the gap behind the divider (default: theme `background`). */
  background?: string
  /** Divider color (thin token line) (default: theme `border`). */
  dividerColor?: string
  /** Placeholder label color for an empty pane (default: theme `textMuted`). */
  placeholderColor?: string
}

/** House-spring travel for the pane entrance, in px (matches ondajs). */
const TRAVEL = 16

/** Default pane fill — a lifted surface that reads against the dark canvas
 *  (the theme `surface` token sits too close to `background` when used bare). */
const PANE_FILL = '#1b1e2a'
/** Default divider/pane-edge color — a brighter hairline than `border` so the
 *  seam and panel edges register on the dark canvas. */
const PANE_EDGE = '#3a4055'

export function SplitScreen({
  left,
  right,
  orientation = 'horizontal',
  ratio = 0.5,
  gap = 0,
  divider = true,
  animate = true,
  delay: delayIn = 0,
  width,
  height,
  paneBackground: paneBackgroundProp,
  background: backgroundProp,
  dividerColor: dividerColorProp,
  placeholderColor: placeholderColorProp,
  fontFamily: fontFamilyProp,
}: SplitScreenProps) {
  const frame = useCurrentFrame()
  const { fps, width: compWidth, height: compHeight } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const theme = useTheme()
  // The house `surface`/`border` tokens are tuned to sit *on* a card; alone on
  // the bare canvas they're nearly invisible (surface ≈ background, and the
  // hairline border vanishes), so the two-pane structure reads as flat dark.
  // Lift the pane fill a notch above `surface` and brighten the divider/edge so
  // the split reads clearly against the dark canvas. Explicit props still win.
  const paneBackground = paneBackgroundProp ?? PANE_FILL
  const background = backgroundProp ?? theme.background
  const dividerColor = dividerColorProp ?? PANE_EDGE
  const placeholderColor = placeholderColorProp ?? theme.textMuted
  const fontFamily = fontFamilyProp ?? theme.fontFamily
  // Outer container corner radius in px (matches ondajs `borderRadius`). The
  // engine's `clipRect` takes an optional corner radius, so the rounded
  // container is reproduced faithfully.
  const OUTER_RADIUS = theme.radius ?? 20

  const boxWidth = width ?? compWidth
  const boxHeight = height ?? compHeight

  const horizontal = orientation === 'horizontal'

  // Clamp ratio defensively so a bad value never produces a negative pane.
  const r = Math.max(0, Math.min(1, ratio))

  // Thickness of the divider band (only when shown), measured on the main axis.
  // A 2px seam reads as a deliberate token line on the dark canvas (a 1px line
  // washes out at this contrast).
  const dividerThickness = divider ? 2 : 0

  // Main-axis length to split between the two panes, after removing the gap and
  // the divider band. The full gap holds both the gutter and the divider line.
  const mainAxis = horizontal ? boxWidth : boxHeight
  const crossAxis = horizontal ? boxHeight : boxWidth
  const splittable = Math.max(0, mainAxis - gap - dividerThickness)
  const firstLen = splittable * r
  const secondLen = splittable - firstLen

  // The first pane starts at 0; the second pane sits past the first + gap +
  // divider band. The divider line is centered in the gutter, on the boundary.
  const firstOffset = 0
  const secondOffset = firstLen + gap + dividerThickness
  const dividerOffset = firstLen + gap / 2

  // Center the whole box in the composition (ondajs uses PlacementBox; the ports
  // center — see header). Rounded to whole px so edges stay crisp.
  const boxX = Math.round((compWidth - boxWidth) / 2)
  const boxY = Math.round((compHeight - boxHeight) / 2)

  // Entrance progress on the house spring (no overshoot), shared by both panes.
  const progress = animate
    ? spring({
        frame: Math.max(0, frame - delay),
        fps,
        config: SPRING_SMOOTH,
        durationInFrames: DURATION.base,
      })
    : 1
  const opacity = interpolate(progress, [0, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  // Panes start pulled IN toward the center seam and SPREAD APART to settle
  // (matching ondajs's `entrySlide` sign convention: `'left'`/`'up'` start at
  // `+distance`, `'right'`/`'down'` at `-distance`). So the first (left/top)
  // pane starts toward the center (positive) and eases out to its rest position,
  // and the second (right/bottom) pane starts toward the center (negative) and
  // eases out the other way; both ease to 0.
  const firstTravel = interpolate(progress, [0, 1], [TRAVEL, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const secondTravel = interpolate(progress, [0, 1], [-TRAVEL, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <Group x={boxX} y={boxY} clip={clipRect(boxWidth, boxHeight, OUTER_RADIUS)}>
      {/* Gutter background — seen in the gap behind the divider. */}
      <Rect width={boxWidth} height={boxHeight} cornerRadius={OUTER_RADIUS} fill={background} />

      {/* First pane (left when horizontal, top when vertical). */}
      <Pane
        x={horizontal ? firstOffset : 0}
        y={horizontal ? 0 : firstOffset}
        width={horizontal ? firstLen : crossAxis}
        height={horizontal ? crossAxis : firstLen}
        content={left}
        label={horizontal ? 'Left' : 'Top'}
        opacity={opacity}
        translateX={horizontal ? firstTravel : 0}
        translateY={horizontal ? 0 : firstTravel}
        background={paneBackground}
        edge={dividerColor}
        placeholderColor={placeholderColor}
        fontFamily={fontFamily}
      />

      {/* Divider line, centered on the boundary and stretched across the cross
          axis. Drawn over the panes so the seam reads as a thin token line. */}
      {divider ? (
        <Rect
          x={horizontal ? dividerOffset : 0}
          y={horizontal ? 0 : dividerOffset}
          width={horizontal ? dividerThickness : crossAxis}
          height={horizontal ? crossAxis : dividerThickness}
          fill={dividerColor}
        />
      ) : null}

      {/* Second pane (right when horizontal, bottom when vertical). */}
      <Pane
        x={horizontal ? secondOffset : 0}
        y={horizontal ? 0 : secondOffset}
        width={horizontal ? secondLen : crossAxis}
        height={horizontal ? crossAxis : secondLen}
        content={right}
        label={horizontal ? 'Right' : 'Bottom'}
        opacity={opacity}
        translateX={horizontal ? secondTravel : 0}
        translateY={horizontal ? 0 : secondTravel}
        background={paneBackground}
        edge={dividerColor}
        placeholderColor={placeholderColor}
        fontFamily={fontFamily}
      />
    </Group>
  )
}

/** A single pane: a background rect + its content (or a centered placeholder
 *  label), clipped to its own rect so content can't bleed past the panel. The
 *  entrance translate is applied on an inner `<Group>` while the outer `<Group>`
 *  holds the layout position — so the clip stays put as the content slides. */
function Pane({
  x,
  y,
  width,
  height,
  content,
  label,
  opacity,
  translateX,
  translateY,
  background,
  edge,
  placeholderColor,
  fontFamily,
}: {
  x: number
  y: number
  width: number
  height: number
  content?: ReactNode
  label: string
  opacity: number
  translateX: number
  translateY: number
  background: string
  edge: string
  placeholderColor: string
  fontFamily?: string
}) {
  // Below ~1px on either axis the pane is degenerate (e.g. ratio at an extreme);
  // skip it so a zero-size clip never produces artefacts.
  if (width < 1 || height < 1) return null

  // Placeholder label sizing/position when the pane has no content.
  const placeholderSize = 28
  // Letter-spacing (ondajs `0.04em`); widens the line by `tracking × (glyphs−1)`,
  // folded into the centering so the placeholder stays centered.
  const placeholderTracking = placeholderSize * 0.04
  const labelX = Math.round(
    (width -
      (label.length * placeholderSize * 0.6 +
        placeholderTracking * Math.max(0, label.length - 1))) /
      2,
  )
  const labelY = Math.round((height - placeholderSize) / 2)

  return (
    <Group x={x} y={y} clip={clipRect(width, height)}>
      {/* Pane fill + a faint edge stroke so the panel reads against the canvas
          (the house "surface + 1px border" pattern). */}
      <Rect width={width} height={height} fill={background} stroke={edge} strokeWidth={1} />
      <Group x={translateX} y={translateY} opacity={opacity}>
        {content ?? (
          <Text
            x={labelX}
            y={labelY}
            fontSize={placeholderSize}
            letterSpacing={placeholderTracking}
            color={placeholderColor}
            fontFamily={fontFamily}
            fontWeight={500}
          >
            {label}
          </Text>
        )}
      </Group>
    </Group>
  )
}
