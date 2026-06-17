//! KineticText — opinionated per-GLYPH entrance presets, now a thin facade over
//! the general `<TextAnimator>` engine. The four from→to presets (rise/fade/scale/
//! blur) are just preset `animate` channel maps routed through TextAnimator, so
//! there is ONE kinetic-type engine, one layout path, one kerning-accurate
//! placement. `wave` is the exception — a decaying sine ripple whose offset is a
//! function of BOTH progress and glyph index, so it doesn't fit TextAnimator's
//! `[from, to]` channel model and keeps its own small dedicated path.
//!
//! Presets:
//! - `rise`  — translateY 24 → 0 + fade (the house entrance, per glyph).
//! - `fade`  — opacity only (the layout-safe minimum).
//! - `scale` — 0.6 → 1 + fade, scaled about the glyph's OWN center.
//! - `blur`  — blur 12 → 0 + fade: a per-glyph soft→sharp focus-pull through the
//!             engine's render-to-texture pass (CPU + GPU).
//! - `wave`  — a gentle sine translateY that ripples across glyphs + fade; the
//!             ripple phase is the glyph index, so the wave travels the line.

import { Group, Text, interpolate, spring, useCurrentFrame, useVideoConfig } from '@onda/react'
import { useFittedFontSize } from '../bounds.js'
import { LINE_RATIO, layoutGlyphLine, lineStartX, lineTopY } from '../glyph-line.js'
import { DURATION, SPRING_SMOOTH, STAGGER, staggerFrames } from '../motion.js'
import { type Placement, usePlacement } from '../placement.js'
import { useTextMetricsReady } from '../text-metrics.js'
import { type TextStyleProps, applyTextCase } from '../text-style.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'
import { staggeredSettle, useTimeScale } from '../timing.js'
import { type TextAnimate, TextAnimator } from './TextAnimator.js'

/** The per-glyph entrance presets. */
export type KineticTextPreset = 'rise' | 'fade' | 'scale' | 'blur' | 'wave'

export interface KineticTextProps extends TextStyleProps {
  /** The line to choreograph. Laid out as one row of absolutely-placed glyphs. */
  text?: string
  /** Font size in px (default 96). */
  fontSize?: number
  /** Opt-in auto-fit: `'frame'` scales the font size DOWN (never up) so the
   *  line cannot exceed the frame minus the safe margins. Default `'none'`
   *  (the historical behavior). */
  fit?: 'none' | 'frame'
  /** Explicit width cap in px for the line; combines with `fit` (the smaller
   *  cap wins). */
  maxWidth?: number
  /** Per-glyph entrance flavor (default `'rise'`). */
  preset?: KineticTextPreset
  /** Time between consecutive glyphs entering (default `STAGGER` = 5 frames). */
  stagger?: TimeInput
  /** Time each glyph's entrance takes to settle (default `DURATION.base`). */
  durationInFrames?: TimeInput
  /** Time before the FIRST glyph starts (default 0). */
  delay?: TimeInput
  /** Compress the whole timing envelope (delay, stagger, durations) so the
   *  entrance settles at least `hold` before the end of the enclosing clip
   *  (`useVideoConfig().durationInFrames`, Sequence-scoped). Opt-in. */
  fitToClip?: boolean
  /** Hard cap on the settle time (frames or '0.5s'). Wins over `fitToClip`. */
  maxSettle?: TimeInput
  /** Breathing room before the cut for `fitToClip` (default 6 frames). */
  hold?: TimeInput
  /** Horizontal alignment of the line about its anchor (default `'center'`). */
  align?: 'left' | 'center' | 'right'
  /** Where the line sits: a region keyword (`'center'`, `'lower-third'`, …) or
   *  normalized `{x,y}` (0–1, line center). The shared placement contract;
   *  default `'center'` (the historical centering). */
  placement?: Placement
}

/** Starting rise distance in px for the `rise` preset (the house 24px envelope). */
const RISE_PX = 24
/** Starting scale for the `scale` preset. */
const SCALE_FROM = 0.6
/** Starting blur sigma in px for the `blur` preset's focus-pull. */
const BLUR_FROM = 12
/** Peak amplitude in px of the `wave` preset's sine ripple. */
const WAVE_AMPLITUDE = 28

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** The from→to presets as TextAnimator channel maps — the single source of truth
 *  for what each preset animates. `wave` is procedural and handled separately. */
const PRESET_ANIMATE: Record<Exclude<KineticTextPreset, 'wave'>, TextAnimate> = {
  rise: { y: [RISE_PX, 0], opacity: [0, 1] },
  fade: { opacity: [0, 1] },
  scale: { scale: [SCALE_FROM, 1], opacity: [0, 1] },
  blur: { blur: [BLUR_FROM, 0], opacity: [0, 1] },
}

export function KineticText({
  text: textProp = 'kinetic',
  fontSize = 96,
  fit,
  maxWidth,
  preset = 'rise',
  stagger = STAGGER,
  durationInFrames = DURATION.base,
  delay = 0,
  fitToClip,
  maxSettle,
  hold,
  align = 'center',
  color,
  fontFamily,
  fontWeight = 600,
  italic = false,
  letterSpacing,
  uppercase,
  placement,
}: KineticTextProps) {
  // Uppercase the SOURCE once here, before it's handed to the per-glyph engine
  // (TextAnimator / KineticWave), so the transform survives the glyph layout.
  const text = applyTextCase(textProp, { uppercase })
  // KineticText is the engine's DISPLAY-statement component, so it follows the
  // theme's heading family by default (`headingFamily ?? fontFamily`) — set
  // `fontDisplay` on the brand and the kinetic lines pick up the title face,
  // while body components keep `fontFamily`. An explicit prop still wins.
  const theme = useTheme()
  const resolvedFamily = fontFamily ?? theme.headingFamily ?? theme.fontFamily

  // `wave` is a decaying sine ripple (a function of progress AND index), not a
  // from→to channel — it keeps its own small path. Everything else is the general
  // engine with a preset channel map.
  if (preset === 'wave') {
    return (
      <KineticWave
        text={text}
        fontSize={fontSize}
        fit={fit}
        maxWidth={maxWidth}
        stagger={stagger}
        durationInFrames={durationInFrames}
        delay={delay}
        fitToClip={fitToClip}
        maxSettle={maxSettle}
        hold={hold}
        align={align}
        color={color}
        fontFamily={resolvedFamily}
        fontWeight={fontWeight}
        italic={italic}
        letterSpacing={letterSpacing}
        placement={placement}
      />
    )
  }

  return (
    <TextAnimator
      text={text}
      units="glyph"
      animate={PRESET_ANIMATE[preset]}
      fit={fit}
      maxWidth={maxWidth}
      stagger={stagger}
      durationInFrames={durationInFrames}
      delay={delay}
      fitToClip={fitToClip}
      maxSettle={maxSettle}
      hold={hold}
      align={align}
      fontSize={fontSize}
      color={color}
      fontFamily={resolvedFamily}
      fontWeight={fontWeight}
      italic={italic}
      letterSpacing={letterSpacing}
      placement={placement}
    />
  )
}

interface KineticWaveProps {
  text: string
  fontSize: number
  fit?: 'none' | 'frame'
  maxWidth?: number
  stagger: TimeInput
  durationInFrames: TimeInput
  delay: TimeInput
  fitToClip?: boolean
  maxSettle?: TimeInput
  hold?: TimeInput
  align: 'left' | 'center' | 'right'
  color?: string
  fontFamily?: string
  fontWeight: number
  italic?: boolean
  letterSpacing?: number
  placement?: Placement
}

/** The `wave` preset: a gentle decaying sine ripple across glyphs. Placement
 *  matches TextAnimator (one kerning-accurate `glyphLayout` call, absolute
 *  left-to-right about the canvas center) so only the motion differs. */
function KineticWave({
  text,
  fontSize: fontSizeProp,
  fit,
  maxWidth,
  stagger: staggerIn,
  durationInFrames: durationIn,
  delay: delayIn,
  fitToClip,
  maxSettle,
  hold,
  align,
  color: colorProp,
  fontFamily: fontFamilyProp,
  fontWeight,
  italic = false,
  letterSpacing,
  placement,
}: KineticWaveProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  useTextMetricsReady()
  const measureOpts = { fontFamily, fontWeight }

  // Opt-in auto-fit (same contract as TextAnimator).
  const fontSize = useFittedFontSize(text, fontSizeProp, { ...measureOpts, fit, maxWidth })

  // Kerning-accurate resting positions via the SHARED glyph-line primitive
  // (matches TextAnimator exactly — one layout path for the whole family).
  const laid = layoutGlyphLine(text, fontSize, measureOpts)
  const placed = laid.rendered
  const lineWidth = laid.width

  // Timing: parse + clip-fit (same contract as TextAnimator).
  const staggerBase = framesOf(staggerIn, fps, STAGGER)
  const durationBase = framesOf(durationIn, fps, DURATION.base)
  const delayBase = framesOf(delayIn, fps)
  const naturalSettle = staggeredSettle(placed.length, staggerBase, durationBase, delayBase)
  const timeScale = useTimeScale(naturalSettle, { fitToClip, maxSettle, hold })
  const stagger = staggerBase * timeScale
  const durationInFrames = Math.max(1, durationBase * timeScale)
  const delay = delayBase * timeScale

  // Shared placement contract (matches TextAnimator's anchoring exactly).
  const resolved = usePlacement(placement, { width: lineWidth, height: fontSize * LINE_RATIO })
  const anchorX = Math.round(resolved.x)
  const startX = lineStartX(align, anchorX, lineWidth)
  const baseY = lineTopY(resolved.y, fontSize)

  return (
    <Group>
      {placed.map(({ ch, x, renderIndex: i }) => {
        const progress = spring({
          frame: Math.max(0, frame - delay - staggerFrames(i, stagger)),
          fps,
          config: SPRING_SMOOTH,
          durationInFrames,
        })
        const opacity = interpolate(progress, [0, 1], [0, 1], CLAMP)
        // A gentle sine offset that fades out as the glyph settles, with the
        // ripple phase keyed to the glyph index so the wave travels the line.
        const ripple = Math.sin(progress * Math.PI + i * 0.6)
        const dy = ripple * WAVE_AMPLITUDE * (1 - progress)

        return (
          <Text
            key={`${i}-${ch}`}
            x={startX + x}
            y={baseY + dy}
            opacity={opacity}
            fontSize={fontSize}
            color={color}
            fontFamily={fontFamily}
            fontWeight={fontWeight}
            italic={italic}
            letterSpacing={letterSpacing}
          >
            {ch}
          </Text>
        )
      })}
    </Group>
  )
}
