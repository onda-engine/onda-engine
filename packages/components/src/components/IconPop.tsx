//! IconPop — an icon (a glyph/emoji or a built-in shape) popping into place with
//! an overshoot spring (scale 0 → peak past 1, then settle to 1).
//! Ported from ondajs.
//!
//! ondajs renders one of four SVG icons (check/cross/dot/star) inside a 0–24
//! viewBox and pops it in via `entryScale` (SPRING_SMOOTH — no overshoot). This
//! port keeps the four built-in `shape` icons (drawn as `<Path>`, GPU-only) and
//! adds a `glyph` mode (any character/emoji via `<Text>`) — except that common
//! decorative star/sparkle symbols (e.g. "✦", which most render fonts have no
//! glyph for and would draw blank) transparently fall back to the built-in
//! `star` <Path>, so a star glyph always pops something visible. And — per the
//! IconPop brief — uses an *overshoot* spring: a lightly-damped `spring` config
//! whose value rises past 1.0 and rings down, giving the pop a little life (vs.
//! the house spring's flat settle).
//!
//! Overshoot model: the underdamped `POP_SPRING` drives a normalized progress
//! that goes 0 → ~1.19 → 1 (it overshoots past 1, then settles). We split that
//! into a rise term (`min(progress, 1)`) and an overshoot bump (`progress - 1`
//! when positive), then scale ONLY the bump to the `overshoot` prop. So the
//! scale starts at exactly 0, peaks at ≈ `1 + overshoot`, and settles to ≈ 1 —
//! one continuous pop, the bounce magnitude tunable, the start never clipped.
//!
//! Pivot caveat: scene scale pivots on the node's LOCAL ORIGIN (0,0), not the
//! node's center. So the icon's geometry is drawn CENTERED on (0,0) — the outer
//! `<Group x y>` marks that center on the canvas, and the inner `<Group>` does
//! the scaling about it, so the pop grows from the middle rather than a corner.
//!
//! Backend caveats: `<Path>` (the four shapes) renders only on the Vello/GPU
//! backend (the CPU reference skips paths). The outline shapes (check, cross)
//! are stroked here; the engine's `<Path>` exposes no line-cap / line-join, so
//! the SVG `round` caps/joins become the default butt/miter — a faithful-enough
//! approximation for a quick pop. The `glyph` mode renders on either backend.

import {
  Group,
  Path,
  Text,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import { DURATION } from '../motion.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

/** The four built-in shape icons, matching ondajs (inside a 0–24 viewBox). */
export type IconShape = 'check' | 'cross' | 'dot' | 'star'

/** Path data + paint mode for each built-in shape, in the 0–24 viewBox. */
const SHAPES: Record<IconShape, { d: string; filled: boolean }> = {
  check: { d: 'M5 13 L9 17 L19 7', filled: false },
  cross: { d: 'M6 6 L18 18 M6 18 L18 6', filled: false },
  dot: { d: 'M12 12 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0', filled: true },
  star: {
    d: 'M12 2 L14.9 8.9 L22.4 9.5 L16.7 14.4 L18.5 21.7 L12 17.8 L5.5 21.7 L7.3 14.4 L1.6 9.5 L9.1 8.9 Z',
    filled: true,
  },
}

/** Decorative star/sparkle symbol chars that fonts routinely lack a glyph for
 *  (so `<Text>` would draw nothing — a blank frame). When a `glyph` is one of
 *  these, we fall back to the guaranteed-renderable built-in `star` <Path>
 *  instead, so the pop is never invisible. Other glyphs (real letters, common
 *  emoji) still render via <Text>. */
const STAR_SYMBOLS = new Set([
  '✦', // U+2726 black four-pointed star
  '✧', // U+2727 white four-pointed star
  '★', // U+2605 black star
  '☆', // U+2606 white star
  '✪', // U+272A circled white star
  '✶', // U+2736 six-pointed black star
  '✷', // U+2737 eight-pointed rectilinear black star
  '✸', // U+2738 heavy eight-pointed rectilinear black star
  '✹', // U+2739 twelve-pointed black star
  '✺', // U+273A sixteen-pointed asterisk
  '⭐', // U+2B50 star
  '🌟', // U+1F31F glowing star
  '✨', // U+2728 sparkles
  '⭑', // U+2B51 black small star
  '⭒', // U+2B52 white small star
])

export interface IconPopProps {
  /** A character/emoji to pop in (e.g. "✦", "★", "🎉"). Takes precedence over
   *  `shape` when set. Rendered via `<Text>` so it works on both backends. */
  glyph?: string
  /** One of the four built-in shapes (check/cross/dot/star). Used when `glyph`
   *  is not set. Drawn as `<Path>` — GPU/Vello only. */
  shape?: IconShape
  /** Icon size in px (the icon is square-ish, centered on its placement point). */
  iconSize?: number
  /** Icon color (default: theme `accent`). */
  color?: string
  /** Stroke width for the outline shapes (check, cross). Ignored by glyph and by
   *  the filled shapes (dot, star). */
  strokeWidth?: number
  /** Frames before the pop starts. */
  delay?: TimeInput
  /** Frames the pop takes to settle (default `DURATION.base` = 18). */
  durationInFrames?: TimeInput
  /** Overshoot amount — how far past 1.0 the scale peaks before settling, as a
   *  fraction (default 0.18 ≈ an 18% bump). 0 disables the overshoot. */
  overshoot?: number
  /** Canvas x of the icon's CENTER (the pop grows from here). */
  x?: number
  /** Canvas y of the icon's CENTER. */
  y?: number
}

/** A lightly-damped spring config that overshoots before settling. Stiffer +
 *  much less damped than the house spring, so its normalized value rises above
 *  1.0 and rings down — the source of the pop's bounce. */
const POP_SPRING = { mass: 1, stiffness: 200, damping: 12 } as const

/** The natural peak EXCESS above 1.0 of the time-remapped `POP_SPRING` value
 *  (measured against the engine's spring integrator: the first peak lands near
 *  ~1.19, i.e. ~0.19 over 1.0, for `durationInFrames` in the 12–24 range). We
 *  divide the raw overshoot ring by this so the `overshoot` prop maps directly
 *  to the on-screen peak height (`peak scale ≈ 1 + overshoot`). */
const PEAK_EXCESS = 0.19

export function IconPop({
  glyph,
  shape = 'check',
  iconSize = 96,
  color: colorProp,
  strokeWidth = 3,
  delay: delayIn = 0,
  durationInFrames: durationInFramesIn = DURATION.base,
  overshoot = 0.18,
  x = 0,
  y = 0,
}: IconPopProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const durationInFrames = framesOf(durationInFramesIn, fps)
  const theme = useTheme()
  const color = colorProp ?? theme.accent
  const fontFamily = theme.fontFamily

  // Underdamped spring: progress 0 → ~1.19 (overshooting past 1) → 1, re-timed
  // to settle in `durationInFrames`.
  const progress = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: POP_SPRING,
    durationInFrames,
  })

  // Split progress into a rise term (capped at 1) plus the overshoot bump (the
  // part above 1), scaling ONLY the bump to the `overshoot` prop. This keeps the
  // start at exactly 0 and the settle at ~1, with a tunable peak ≈ 1 + overshoot.
  const rise = Math.min(progress, 1)
  const bump = Math.max(0, progress - 1) * (overshoot / PEAK_EXCESS)
  const scale = rise + bump

  // Opacity fades in over the first portion of the pop (clamped), independent of
  // the bounce so the icon never flickers as the spring rings.
  const opacity = interpolate(frame - delay, [0, durationInFrames * 0.5], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    // Outer group: places the icon's CENTER on the canvas.
    <Group x={x} y={y}>
      {/* Inner group: scales (with overshoot) about that center + fades. */}
      <Group scaleX={scale} scaleY={scale} opacity={opacity}>
        {glyph
          ? // A decorative star/sparkle char the font may lack a glyph for would
            // render blank via <Text>; draw the built-in `star` <Path> instead so
            // the pop is always visible. Other glyphs render as text.
            STAR_SYMBOLS.has(glyph)
            ? renderShape('star', iconSize, color, strokeWidth)
            : renderGlyph(glyph, iconSize, color, fontFamily)
          : renderShape(shape, iconSize, color, strokeWidth)}
      </Group>
    </Group>
  )
}

/** Render a character/emoji centered on the local origin (0,0). The engine
 *  measures text but we can't read measurements here, so the centering is an
 *  approximation: width is estimated from `iconSize`, and the vertical nudge
 *  assumes the glyph cap-box is ~0.7 of the font size. Wide/narrow glyphs will
 *  sit slightly off-center. */
function renderGlyph(glyph: string, iconSize: number, color: string, fontFamily?: string) {
  // Estimate the rendered glyph width (most emoji/symbols are ~square at this
  // font size; multi-codepoint strings will be wider and under-shifted).
  const estWidth = iconSize * 0.62
  return (
    <Text
      fontSize={iconSize}
      color={color}
      fontFamily={fontFamily}
      x={-estWidth / 2}
      y={-iconSize / 2}
    >
      {glyph}
    </Text>
  )
}

/** Render a built-in shape centered on the local origin (0,0). The 0–24 viewBox
 *  is scaled to `iconSize` and shifted so the viewBox center (12,12) lands on the
 *  pivot. Outlines are stroked; filled shapes are filled. */
function renderShape(shape: IconShape, iconSize: number, color: string, strokeWidth: number) {
  const def = SHAPES[shape] ?? SHAPES.check
  const unit = iconSize / 24
  // Scale the path geometry from the 24-unit space and center it on (0,0).
  return (
    <Group scaleX={unit} scaleY={unit} x={-iconSize / 2} y={-iconSize / 2}>
      <Path
        d={def.d}
        fill={def.filled ? color : undefined}
        stroke={def.filled ? undefined : color}
        // Stroke width is in the 24-unit space (it scales with the group), so
        // divide by `unit` to keep the on-screen stroke ≈ `strokeWidth` px.
        strokeWidth={def.filled ? undefined : strokeWidth / unit}
        strokeCap="round"
        strokeJoin="round"
      />
    </Group>
  )
}
