//! KineticText — an opinionated per-GLYPH choreography fabric. One line of text,
//! each glyph animating in on the house stagger with a chosen preset, so the
//! kinetic-type "signature move" is one component, not hand-wired per scene.
//!
//! Layout: each glyph's x-advance is the REAL shaped width (`measureText`, like
//! Marquee/TrackingIn), and glyphs are placed ABSOLUTELY left-to-right about an
//! anchor — NOT a `<Flex>`. A per-frame motion transform (rise/scale/wave) grows
//! a glyph's bbox, and inside a layout pass that would reflow/jiggle the whole
//! line every frame (HARD RULE 2). Absolute placement pins each glyph's resting
//! x so only the motion (which lives on the glyph's own transform/opacity/blur)
//! moves — the line never reflows.
//!
//! Motion: glyph `i` enters staggered by `staggerFrames(i, stagger)` on the
//! house spring (`SPRING_SMOOTH`, no overshoot) over `durationInFrames`. Presets:
//! - `rise`  — translateY 24 → 0 + fade (the house entrance, per glyph).
//! - `fade`  — opacity only (the layout-safe minimum).
//! - `scale` — 0.6 → 1 + fade, scaled about the glyph's OWN center (originX/Y).
//! - `blur`  — the real `blur` prop 12 → 0 + fade: a per-glyph soft→sharp
//!             focus-pull through the engine's render-to-texture pass (CPU+GPU).
//! - `wave`  — a gentle sine translateY that ripples across glyphs + fade; the
//!             ripple phase is the glyph index, so the wave travels the line.
//!
//! Spaces advance the cursor but emit no glyph node (nothing to animate).

import { Group, Text, interpolate, spring, useCurrentFrame, useVideoConfig } from '@onda/react'
import { DURATION, SPRING_SMOOTH, STAGGER, staggerFrames } from '../motion.js'
import { measureText, useTextMetricsReady } from '../text-metrics.js'
import { useTheme } from '../theme.js'

/** The per-glyph entrance presets. */
export type KineticTextPreset = 'rise' | 'fade' | 'scale' | 'blur' | 'wave'

export interface KineticTextProps {
  /** The line to choreograph. Laid out as one row of absolutely-placed glyphs. */
  text?: string
  /** Font size in px (default 96). */
  fontSize?: number
  /** Per-glyph entrance flavor (default `'rise'`). */
  preset?: KineticTextPreset
  /** Frames between consecutive glyphs entering (default `STAGGER` = 5). */
  stagger?: number
  /** Frames each glyph's entrance takes to settle (default `DURATION.base`). */
  durationInFrames?: number
  /** Frames before the FIRST glyph starts (default 0). */
  delay?: number
  /** Horizontal alignment of the line about its anchor (default `'center'`). */
  align?: 'left' | 'center' | 'right'
  /** Text color (default: theme `text`). */
  color?: string
  /** Loaded font family (default: theme `fontFamily`). */
  fontFamily?: string
  /** Font weight (display default 600). */
  fontWeight?: number
}

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** Starting rise distance in px for the `rise` preset (the house 24px envelope). */
const RISE_PX = 24
/** Starting scale for the `scale` preset. */
const SCALE_FROM = 0.6
/** Starting blur sigma in px for the `blur` preset's focus-pull. */
const BLUR_FROM = 12
/** Peak amplitude in px of the `wave` preset's sine ripple. */
const WAVE_AMPLITUDE = 28

export function KineticText({
  text = 'kinetic',
  fontSize = 96,
  preset = 'rise',
  stagger = STAGGER,
  durationInFrames = DURATION.base,
  delay = 0,
  align = 'center',
  color: colorProp,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
}: KineticTextProps) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  // Real shaped advances. `useTextMetricsReady` loads the engine in the browser
  // and re-renders when warm; `measureText` is the sync per-glyph read (a hook
  // can't run in the loop below). Same pattern as Marquee/TrackingIn.
  useTextMetricsReady()
  const measureOpts = { fontFamily, fontWeight }

  // Place each glyph at its running-sum x (resting position). Spaces advance the
  // cursor but emit no node — there's nothing to animate, and an empty Text would
  // measure to ~0 anyway. We measure the whole-string prefix advances so kerning
  // between neighbours is honored, rather than summing isolated-glyph widths.
  const chars = Array.from(text)
  let cursor = 0
  const placed: { ch: string; x: number; glyphIndex: number }[] = []
  let glyphIndex = 0
  for (const ch of chars) {
    const x = cursor
    cursor += measureText(ch, fontSize, measureOpts).width
    if (ch.trim().length === 0) continue // space: advance only
    placed.push({ ch, x, glyphIndex: glyphIndex++ })
  }
  const lineWidth = cursor

  // Anchor the line about the canvas center per `align`; pin a baseline-ish y.
  const anchorX = Math.round(width / 2)
  const startX =
    align === 'center' ? anchorX - lineWidth / 2 : align === 'right' ? anchorX - lineWidth : anchorX
  // Roughly vertically center the single line (matches TrackingIn/Typewriter).
  const baseY = Math.round(height / 2 - fontSize * 0.6)

  return (
    <Group>
      {placed.map(({ ch, x, glyphIndex: i }) => {
        // Per-glyph spring progress (0→1), staggered by index on the house spring.
        const progress = spring({
          frame: Math.max(0, frame - delay - staggerFrames(i, stagger)),
          fps,
          config: SPRING_SMOOTH,
          durationInFrames,
        })
        const opacity = interpolate(progress, [0, 1], [0, 1], CLAMP)

        // Per-preset transform on THIS glyph's own node (resting x pins layout).
        let dy = 0
        let scale = 1
        let blur = 0
        switch (preset) {
          case 'fade':
            break
          case 'scale':
            scale = interpolate(progress, [0, 1], [SCALE_FROM, 1], CLAMP)
            break
          case 'blur':
            blur = interpolate(progress, [0, 1], [BLUR_FROM, 0], CLAMP)
            break
          case 'wave': {
            // A gentle sine offset that fades out as the glyph settles, with the
            // ripple phase keyed to the glyph index so the wave travels the line.
            const ripple = Math.sin(progress * Math.PI + i * 0.6)
            dy = ripple * WAVE_AMPLITUDE * (1 - progress)
            break
          }
          default: // 'rise'
            dy = interpolate(progress, [0, 1], [RISE_PX, 0], CLAMP)
            break
        }

        // `scale` pivots about the glyph's own center so it grows in place rather
        // than from its top-left corner; advance ≈ glyph width for the pivot x.
        const advance = measureText(ch, fontSize, measureOpts).width
        const originX = preset === 'scale' ? advance / 2 : 0
        const originY = preset === 'scale' ? fontSize / 2 : 0

        return (
          <Text
            key={`${i}-${ch}`}
            x={startX + x}
            y={baseY + dy}
            scaleX={scale}
            scaleY={scale}
            originX={originX}
            originY={originY}
            blur={blur > 0.01 ? blur : undefined}
            opacity={opacity}
            fontSize={fontSize}
            color={color}
            fontFamily={fontFamily}
            fontWeight={fontWeight}
          >
            {ch}
          </Text>
        )
      })}
    </Group>
  )
}
