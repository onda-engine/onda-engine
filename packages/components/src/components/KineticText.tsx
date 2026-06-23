//! KineticText — opinionated per-GLYPH entrance presets, now a thin facade over
//! the general `<TextAnimator>` engine. The four from→to presets (rise/fade/scale/
//! blur) are just preset `animate` channel maps routed through TextAnimator, so
//! there is ONE kinetic-type engine, one layout path, one kerning-accurate
//! placement. `wave` and `scatter` are the exceptions — procedural per-glyph
//! motion (a function of BOTH progress AND glyph index) that doesn't fit
//! TextAnimator's `[from, to]` channel model, so each keeps its own small path.
//!
//! Presets:
//! - `rise`  — translateY 24 → 0 + fade (the house entrance, per glyph).
//! - `fade`  — opacity only (the layout-safe minimum).
//! - `scale` — 0.6 → 1 + fade, scaled about the glyph's OWN center.
//! - `blur`  — blur 12 → 0 + fade: a per-glyph soft→sharp focus-pull through the
//!             engine's render-to-texture pass (CPU + GPU).
//! - `wave`  — a gentle sine translateY that ripples across glyphs + fade; the
//!             ripple phase is the glyph index, so the wave travels the line.
//! - `scatter` — each glyph flies in from a RANDOM direction + tumbles upright
//!             (per-glyph random offset/rotation/scale that all decay to rest) +
//!             fade. The randomness is a deterministic hash of the glyph index, so
//!             it is STABLE frame-to-frame (no jitter) and identical in preview and
//!             export. Makes a kinetic wordmark EDITABLE — one `text` string, any
//!             length, instead of hand-placing each scattered letter. Set `exit` to
//!             also scatter the glyphs back OUT over the clip's final frames (a full
//!             enter→hold→leave wordmark sting).

import {
  Group,
  Text,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda-engine/react'
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
export type KineticTextPreset = 'rise' | 'fade' | 'scale' | 'blur' | 'wave' | 'scatter'

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
  /** Optional per-glyph color PALETTE. When set, glyph `i` is painted
   *  `colors[i % colors.length]` (cycling), overriding the single `color` — a
   *  multicolor wordmark from ONE editable string. Omit to paint the whole line one
   *  color. Works with every preset (each glyph keeps its color through the entrance). */
  colors?: string[]
  /** `scatter` only — also scatter the glyphs back OUT (tumbling + fading) over the
   *  clip's final frames, so the line exits as kinetically as it entered. Default off
   *  (settle and hold). */
  exit?: boolean
  /** Duration of the scatter-OUT when `exit` is on (frames or '0.5s'); default ~14f. */
  exitDuration?: TimeInput
}

/** Starting rise distance in px for the `rise` preset (the house 24px envelope). */
const RISE_PX = 24
/** Starting scale for the `scale` preset. */
const SCALE_FROM = 0.6
/** Starting blur sigma in px for the `blur` preset's focus-pull. */
const BLUR_FROM = 12
/** Peak amplitude in px of the `wave` preset's sine ripple. */
const WAVE_AMPLITUDE = 28
/** `scatter` preset — how far (px) each glyph flies in from, peak tumble (deg), and
 *  the starting scale it grows from. Tuned for a lively but legible settle. */
const SCATTER_DIST = 120
const SCATTER_ROT = 42
const SCATTER_SCALE = 0.4

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** Deterministic [0,1) hash for glyph `i` on channel `salt` — a pure function of the
 *  index (NOT the frame), so each glyph's scatter direction/tumble is stable across
 *  renders: lively randomness with frame-perfect determinism (preview == export). */
const scatterHash = (i: number, salt: number): number => {
  const v = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453
  return v - Math.floor(v)
}

/** The from→to presets as TextAnimator channel maps — the single source of truth
 *  for what each preset animates. `wave` and `scatter` are procedural (per-glyph
 *  randomized / index-keyed) and handled by their own dedicated paths. */
const PRESET_ANIMATE: Record<Exclude<KineticTextPreset, 'wave' | 'scatter'>, TextAnimate> = {
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
  colors,
  exit,
  exitDuration,
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
  if (preset === 'wave' || preset === 'scatter') {
    const Procedural = preset === 'wave' ? KineticWave : KineticScatter
    return (
      <Procedural
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
        colors={colors}
        exit={exit}
        exitDuration={exitDuration}
      />
    )
  }

  return (
    <TextAnimator
      text={text}
      units="glyph"
      animate={PRESET_ANIMATE[preset]}
      colors={colors}
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

/** Shared props for the procedural presets (`wave`, `scatter`) — the same surface
 *  KineticText forwards; only the per-glyph motion differs between them. */
interface ProceduralPresetProps {
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
  /** Per-glyph color palette (cycled by glyph index); overrides `color` when set. */
  colors?: string[]
  /** `scatter` only — scatter the glyphs back OUT over the clip's final frames. */
  exit?: boolean
  /** Duration of the scatter-OUT when `exit` is on (default ~14f). */
  exitDuration?: TimeInput
}

/** Default length (frames) of the scatter-OUT when `exit` is enabled without a duration. */
const EXIT_FRAMES = 14

/** Resolve a glyph's color: the palette entry for its index (cycling) when a palette
 *  is given, else the single line color. */
const glyphColor = (colors: string[] | undefined, i: number, fallback: string): string =>
  colors && colors.length > 0 ? (colors[i % colors.length] as string) : fallback

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
  colors,
}: ProceduralPresetProps) {
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
            color={glyphColor(colors, i, color)}
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

/** The `scatter` preset: every glyph flies in from its OWN random direction,
 *  distance, and tumble (rotation + scale), all decaying to zero so the line
 *  resolves onto its kerned resting positions. The randomness is a deterministic
 *  hash of the glyph index (stable across frames), and the resting layout is the
 *  shared `glyphLayout` path — so when settled it is byte-identical to the other
 *  presets, only the entrance differs. This is what makes a scattering wordmark
 *  EDITABLE (one `text` string, any length) instead of hand-rigged per letter. */
function KineticScatter({
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
  colors,
  exit,
  exitDuration,
}: ProceduralPresetProps) {
  const frame = useCurrentFrame()
  const { fps, durationInFrames: clipFrames } = useVideoConfig()
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.fontFamily

  useTextMetricsReady()
  const measureOpts = { fontFamily, fontWeight }

  // Opt-in auto-fit (same contract as TextAnimator).
  const fontSize = useFittedFontSize(text, fontSizeProp, { ...measureOpts, fit, maxWidth })

  // Kerning-accurate resting positions via the SHARED glyph-line primitive — the
  // glyphs SETTLE onto exactly where every other preset places them.
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

  // Optional scatter-OUT: over the clip's final `exitFrames`, glyphs fly back out
  // (a fresh per-glyph random direction/tumble) and fade — the mirror of the entrance.
  const exitFrames = exit ? framesOf(exitDuration, fps, EXIT_FRAMES) : 0
  const exitStart = clipFrames - exitFrames

  return (
    <Group>
      {placed.map(({ ch, x, width, renderIndex: i }) => {
        const progress = spring({
          frame: Math.max(0, frame - delay - staggerFrames(i, stagger)),
          fps,
          config: SPRING_SMOOTH,
          durationInFrames,
        })
        // `settle` goes 1 → 0 as the glyph arrives: scale ALL of the entrance
        // displacement (offset + tumble) by it so everything resolves to rest.
        const settle = 1 - progress
        // `leave` goes 0 → 1 across the exit window (ease-in: accelerate out).
        const leaveRaw =
          exitFrames > 0 ? Math.min(1, Math.max(0, (frame - exitStart) / exitFrames)) : 0
        const leave = leaveRaw * leaveRaw
        const inAngle = scatterHash(i, 1) * Math.PI * 2
        const inDist = SCATTER_DIST * (0.55 + 0.45 * scatterHash(i, 2))
        const outAngle = scatterHash(i, 4) * Math.PI * 2
        const outDist = SCATTER_DIST * (0.55 + 0.45 * scatterHash(i, 5))
        const dx = Math.cos(inAngle) * inDist * settle + Math.cos(outAngle) * outDist * leave
        const dy = Math.sin(inAngle) * inDist * settle + Math.sin(outAngle) * outDist * leave
        const rot =
          (scatterHash(i, 3) * 2 - 1) * SCATTER_ROT * settle +
          (scatterHash(i, 6) * 2 - 1) * SCATTER_ROT * leave
        // Scale grows in, then shrinks back toward SCATTER_SCALE as it leaves.
        const scaleIn = interpolate(progress, [0, 1], [SCATTER_SCALE, 1], CLAMP)
        const scale = scaleIn * (1 - leave) + SCATTER_SCALE * leave
        const opacity = interpolate(progress, [0, 1], [0, 1], CLAMP) * (1 - leave)

        return (
          <Text
            key={`${i}-${ch}`}
            x={startX + x + dx}
            y={baseY + dy}
            scaleX={scale}
            scaleY={scale}
            originX={width / 2}
            originY={fontSize / 2}
            rotation={rot}
            opacity={opacity}
            fontSize={fontSize}
            color={glyphColor(colors, i, color)}
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
