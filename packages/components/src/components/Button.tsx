//! Button — a styled CTA pill: a rounded filled `<Rect>` with a centered label.
//! Fades + rises in on the house spring, then plays an optional press-dip at
//! `pressFrame` (a quick scale to 0.94 and back on the house ease, reading as a
//! physical click). Ported from ondajs.
//!
//! Two variants, matching ondajs: `'primary'` paints the pill with `color` and
//! draws the label in `textColor`; `'ghost'` leaves the pill transparent with a
//! `color` border and a `color`-tinted label.
//!
//! Self-positioning: like the ondajs original (which wraps the button in a
//! `PlacementBox` that defaults to centered), this centers itself on the canvas
//! by default. The whole assembly is drawn around its LOCAL ORIGIN (0,0) — the
//! pill at `(-width/2, -height/2)`, the label offset by its own estimated extent
//! — and that origin is then placed at the canvas center (or at the `x`/`y`
//! canvas-fraction you pass). Centering the assembly on the origin also puts the
//! pivot for the press dip at the button's visual center (HARD RULE 3), so it
//! dips from the middle rather than the corner.
//!
//! Approximations vs the ondajs (CSS) original:
//! - `box-shadow` (the soft accent glow on primary, the quiet inset lift) has no
//!   scene-graph equivalent — dropped. Depth is implied by the fill/border alone.
//! - The primary variant keeps the ondajs subtle light border (`1px solid
//!   rgba(255,255,255,0.14)` → {@link PRIMARY_BORDER}), drawn as a thin stroke so
//!   the solid accent fill reads as a crisp, raised CTA against the dark canvas
//!   rather than a flat wash. The ghost's inset highlight is still dropped (no
//!   inset-shadow primitive); its `color` border carries the shape.
//! - `letter-spacing: -0.01em` is unsupported by the text engine — dropped.
//! - The label width/height are ESTIMATED from glyph count × font size (no
//!   author-time text metrics), so the centering is approximate; pass `width`
//!   sized to your label, or accept the small offset on very long labels.
//! - The ghost transparent fill uses `'#00000000'` (the engine has no `none`).

import { Group, Rect, Text, interpolate, useCurrentFrame, useVideoConfig } from '@onda/react'
import { entryFadeRise } from '../choreography.js'
import { HOUSE_EASE } from '../easing.js'
import { DURATION } from '../motion.js'
import { useTheme } from '../theme.js'

/** Mean glyph advance as a fraction of the font size — a rough display-sans
 *  heuristic, used only to center the label (the engine measures the real text
 *  at render time). */
const CHAR_WIDTH_FACTOR = 0.54
/** Engine line-box height as a multiple of font size (matches the typography
 *  crate; the same ratio `Highlight`/`Underline` use). */
const LINE_RATIO = 1.2

// Press-dip envelope, ported from ondajs: scale eases down to PRESS_SCALE over
// PRESS_IN frames into `pressFrame`, then springs back to 1 over PRESS_OUT.
// Short and tight so it reads as a click, not a bounce — no overshoot.
const PRESS_SCALE = 0.94
const PRESS_IN = 3
const PRESS_OUT = 7

// Subtle top-light edge on the primary pill (ondajs's `1px solid
// rgba(255,255,255,0.14)`, as `#ffffff24` — the engine takes hex, not CSS
// `rgba()`), drawn as a thin stroke. It crisps the solid accent fill into a
// deliberate, raised CTA instead of a flat, washed-out wash.
const PRIMARY_BORDER = '#ffffff24'
const PRIMARY_BORDER_WIDTH = 1

export interface ButtonProps {
  /** The button label. */
  label?: string
  /** `'primary'` = filled with `color`; `'ghost'` = transparent with a `color`
   *  border and `color`-tinted label. */
  variant?: 'primary' | 'ghost'
  /** Accent color — the primary fill and the ghost border/label tint
   *  (default: theme `accent`). */
  color?: string
  /** Label color on the primary variant (default: theme `text`). Ignored
   *  by `'ghost'`, which tints the label with `color`. */
  textColor?: string
  /** Pill width in px (default 280). */
  width?: number
  /** Pill height in px (default 72). */
  height?: number
  /** Corner radius in px (default: theme `radius`). */
  cornerRadius?: number
  /** Border thickness in px for the `'ghost'` variant (default 2). */
  borderWidth?: number
  /** Label font size in px (default 24). */
  fontSize?: number
  /** Loaded font family (e.g. a `--font` passed to `onda render`) (default: theme `fontFamily`). */
  fontFamily?: string
  /** Label font weight (display default 600). */
  fontWeight?: number
  /** Horizontal center as a 0–1 fraction of canvas width (default 0.5 — centered,
   *  mirroring the ondajs `placement` default). */
  centerX?: number
  /** Vertical center as a 0–1 fraction of canvas height (default 0.5). */
  centerY?: number
  /** Play the entrance (fade + rise on the house spring). */
  entrance?: boolean
  /** Frames before the entrance begins. */
  delay?: number
  /** Entrance duration in frames (default `DURATION.base` = 18). */
  durationInFrames?: number
  /** Play the click-dip press animation. */
  press?: boolean
  /** Frame the press dip lands on (relative to the local timeline). */
  pressFrame?: number
}

export function Button({
  label = 'Get started',
  variant = 'primary',
  color: colorProp,
  textColor: textColorProp,
  width = 280,
  height = 72,
  cornerRadius: cornerRadiusProp,
  borderWidth = 2,
  fontSize = 24,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
  centerX = 0.5,
  centerY = 0.5,
  entrance = true,
  delay = 0,
  durationInFrames = DURATION.base,
  press = true,
  pressFrame = 30,
}: ButtonProps) {
  const frame = useCurrentFrame()
  const { fps, width: compWidth, height: compHeight } = useVideoConfig()
  const theme = useTheme()
  const color = colorProp ?? theme.accent
  const textColor = textColorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  // Entrance: fade + rise on the house spring (ondajs's `useEntrance` rise).
  const enter = entrance
    ? entryFadeRise({ frame, fps, delay, durationInFrames })
    : { opacity: 1, y: 0 }
  const opacity = enter.opacity
  const riseY = enter.y

  // Press dip: down on the house ease into `pressFrame`, back out after it.
  // interpolate clamps outside the window, so scale rests at 1 until the dip
  // begins and returns to 1 once it settles.
  const pressScale = press
    ? interpolate(
        frame,
        [pressFrame - PRESS_IN, pressFrame, pressFrame + PRESS_OUT],
        [1, PRESS_SCALE, 1],
        {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: HOUSE_EASE,
        },
      )
    : 1

  const isPrimary = variant === 'primary'
  const cornerRadius = cornerRadiusProp ?? theme.radius
  const radius = cornerRadius

  // Estimated label extent, used to center it over the pill. No author-time
  // engine text metrics exist, so derive from glyph count × size.
  const labelWidth = Math.max(0, label.length) * fontSize * CHAR_WIDTH_FACTOR
  const lineHeight = fontSize * LINE_RATIO
  // Text places its TOP-LEFT at (x, y); offset by half the estimated extent so
  // the label sits centered on the local origin (where the pill is also centered).
  const labelX = -labelWidth / 2
  const labelY = -lineHeight / 2

  const labelColor = isPrimary ? textColor : color

  // Canvas placement of the button's center (the local origin of the assembly).
  // Defaults to centered, matching ondajs's default `placement`.
  const originX = centerX * compWidth
  const originY = centerY * compHeight

  return (
    // Canvas positioning: place the assembly's local origin at the canvas point.
    <Group x={originX} y={originY}>
      {/* Entrance fade — layout-safe, separate from the pivoted scale. */}
      <Group opacity={opacity}>
        {/* Rise translate (entrance). */}
        <Group y={riseY}>
          {/* Press scale — pivots on the local origin, the button's center,
              independent of the rise offset above. */}
          <Group scaleX={pressScale} scaleY={pressScale}>
            <Rect
              x={-width / 2}
              y={-height / 2}
              width={width}
              height={height}
              cornerRadius={radius}
              fill={isPrimary ? color : '#00000000'}
              stroke={isPrimary ? PRIMARY_BORDER : color}
              strokeWidth={isPrimary ? PRIMARY_BORDER_WIDTH : borderWidth}
            />
            <Text
              x={labelX}
              y={labelY}
              fontSize={fontSize}
              color={labelColor}
              fontFamily={fontFamily}
              fontWeight={fontWeight}
            >
              {label}
            </Text>
          </Group>
        </Group>
      </Group>
    </Group>
  )
}
