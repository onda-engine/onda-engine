//! LogoSting — a silent, restrained branded reveal: a logo mark wipes in, a title
//! settles beneath it, and a single accent rule lands last. Ported from ondajs.
//!
//! Composition order (one earned beat per element, no overlap-noise):
//!   1. Mark      — the logo `<Path>` is revealed left→right by a clip-wipe.
//!   2. Title     — `ScaleIn` settles the wordmark in beneath the mark.
//!   3. Underline — the accent rule draws last (only when `accent` is true).
//! All three run on the house spring (`SPRING_SMOOTH`): no overshoot, no bounce —
//! the mark lands and stays. Restraint IS the brand.
//!
//! ── Mark draw-on (faithful to ondajs) ───────────────────────────────────────
//! ondajs's mark is a `DrawOn` primitive that strokes the path in via SVG
//! `stroke-dasharray`/`stroke-dashoffset` (`@remotion/paths` `evolvePath`). The
//! engine has the same primitive now: the mark `<Path>` carries a dash as long
//! as the whole path with an offset that retreats to 0 on the house spring, so
//! the stroke is literally drawn on from start to end like a pen. The dash
//! period is the path's arc length, estimated from `d` (see `path-length.ts`) so
//! the pen reaches the end exactly as the reveal completes. The `<Path>` renders
//! only on the Vello/GPU backend (the CPU reference rasterizer skips paths), so
//! the mark is GPU-only.
//!
//! ── Layout / pivots ─────────────────────────────────────────────────────────
//! This is a self-positioning composite. Because the mark needs an animated clip
//! WIDTH and the pieces must stack pixel-exactly, it does not use `<Flex>` (an
//! animated clip/measure would reflow it); instead it centers everything on the
//! canvas via `useVideoConfig()` width/height — the Spotlight/Marquee pattern.
//! The title's `ScaleIn` group is anchored at the title's CENTER so the 0.9→1
//! scale grows about the center (scene scale pivots on the local origin, so the
//! glyphs are drawn offset by -halfWidth). Title/rule widths are ESTIMATED from
//! glyph count × font size (no author-time text metrics) — see Underline.

import { Group, Path, Text, spring, useCurrentFrame, useVideoConfig } from '@onda/react'
import { DURATION, SPRING_SMOOTH } from '../motion.js'
import { estimatePathLength } from '../path-length.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'
import { ScaleIn } from './ScaleIn.js'
import { Underline } from './Underline.js'

/** Mean glyph advance as a fraction of font size — the same rough display-sans
 *  heuristic `Underline` uses, so the centered title and its accent rule (which
 *  `Underline` sizes with the same factor) stay aligned. */
const CHAR_WIDTH_FACTOR = 0.52
/** Engine line-box height as a multiple of font size (matches the typography
 *  crate; `Underline`/`Highlight` use the same ratio to place the accent). */
const LINE_RATIO = 1.2
/** Pixel gap between the mark and the title (ondajs uses a 32px flex gap). */
const STACK_GAP = 32

/** Choreography offsets — frames *after* the block's own `delay`. The title
 *  begins before the mark is fully home so the two reveals feel linked; the
 *  underline lands last so the eye reads mark → word → accent. (Verbatim from
 *  ondajs.) */
const TITLE_OFFSET = 18
const UNDERLINE_OFFSET = 34

export interface LogoStingProps {
  /** SVG path `d` for the logo mark, in `viewBox` coordinate space. */
  d?: string
  /** The brand / product title beneath the mark. */
  title?: string
  /** Frames before the sting starts. */
  delay?: TimeInput
  /** Draw the accent rule beneath the title (the single earned-color moment). */
  accent?: boolean
  /** SVG viewBox `"minX minY width height"` — must match the space of `d`. */
  viewBox?: string
  /** Rendered width of the mark in px. */
  pathWidth?: number
  /** Rendered height of the mark in px. */
  pathHeight?: number
  /** Stroke width, in px (after the viewBox→pixel scale; see note below). */
  strokeWidth?: number
  /** Logo stroke color (default: theme `text`). */
  stroke?: string
  /** Underline accent color — the signature dusty rose (default: theme `accent`). */
  accentColor?: string
  /** Title font size in px. */
  titleFontSize?: number
  /** Title color (default: theme `text`). */
  color?: string
  /** Display font family (must be loaded at render time) (default: theme `headingFamily`). */
  fontFamily?: string
  /** Title font weight (display default 600). */
  fontWeight?: number
}

/** Parse an SVG `viewBox` string into `[minX, minY, width, height]`, defensively
 *  — falls back to a unit box on malformed input so the mark never NaNs out. */
function parseViewBox(vb: string): [number, number, number, number] {
  const parts = vb
    .trim()
    .split(/[\s,]+/)
    .map((n) => Number.parseFloat(n))
  const minX = parts[0] ?? 0
  const minY = parts[1] ?? 0
  const w = parts[2] ?? 1
  const h = parts[3] ?? 1
  return [
    Number.isFinite(minX) ? minX : 0,
    Number.isFinite(minY) ? minY : 0,
    Number.isFinite(w) && w > 0 ? w : 1,
    Number.isFinite(h) && h > 0 ? h : 1,
  ]
}

export function LogoSting({
  d = 'M 50 60 Q 100 20 150 60 T 250 60',
  title = 'Onda',
  delay: delayIn = 0,
  accent = true,
  viewBox = '0 0 300 120',
  pathWidth = 400,
  pathHeight = 160,
  strokeWidth = 3,
  stroke: strokeProp,
  accentColor: accentColorProp,
  titleFontSize = 96,
  color: colorProp,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
}: LogoStingProps) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const theme = useTheme()
  const stroke = strokeProp ?? theme.text
  const accentColor = accentColorProp ?? theme.accent
  const color = colorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.headingFamily ?? theme.fontFamily

  // ── Mark reveal: ondajs's stroke draw-on via an animated dash. ─────────────
  // Progress 0→1 on the house spring over DURATION.slow (24f), the DrawOn default.
  const markProgress = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: SPRING_SMOOTH,
    durationInFrames: DURATION.slow,
  })
  // Dash period = the path's arc length (in viewBox units, the Path's local
  // space — strokeWidth is given there too). One dash + one gap, each as long as
  // the whole path; the offset retreats len→0 so the stroke uncovers from start
  // to end as progress → 1 (the BoundingBox draw-on, applied to a Path).
  const markLength = Math.max(1, estimatePathLength(d))
  const dashOffset = markLength * (1 - Math.max(0, Math.min(1, markProgress)))

  // viewBox → pixel scale for the path. The path `d` is authored in viewBox
  // units; map it onto pathWidth × pathHeight. (Non-uniform scale is fine for a
  // mark; strokeWidth is given in *post-scale* px and applied on the Path
  // directly, so it stays a consistent visual weight regardless of the scale.)
  const [vbMinX, vbMinY, vbW, vbH] = parseViewBox(viewBox)
  const scaleX = pathWidth / vbW
  const scaleY = pathHeight / vbH

  // ── Centered vertical stack geometry. ─────────────────────────────────────
  // Title line-box height + a centered estimate of the title's pixel width.
  const titleLineHeight = titleFontSize * LINE_RATIO
  const titleWidth = title.length * titleFontSize * CHAR_WIDTH_FACTOR
  // The accent rule occupies a sliver below the title's line box; include it in
  // the stack height so the whole composite stays vertically centered.
  const accentBand = accent ? 9 : 0 // ~ lineThickness (3) + small breathing room
  const stackHeight = pathHeight + STACK_GAP + titleLineHeight + accentBand
  const stackTop = (height - stackHeight) / 2
  const centerX = width / 2

  // Mark: centered horizontally, sitting at the top of the stack.
  const markX = centerX - pathWidth / 2
  const markY = stackTop

  // Title: its top-left origin (the wipe/baseline reference) below the mark.
  const titleTop = stackTop + pathHeight + STACK_GAP
  const titleLeft = centerX - titleWidth / 2

  return (
    <Group>
      {/* 1. Mark — the logo arrives, stroked on start→end by an animated dash
          (the ondajs DrawOn; GPU/Vello only — the CPU reference skips paths). */}
      <Group x={markX} y={markY}>
        <Group scaleX={scaleX} scaleY={scaleY} x={-vbMinX * scaleX} y={-vbMinY * scaleY}>
          {/* fill none ('#00000000') so only the stroke reads, like ondajs. The
              dash period is the path length; the offset retreats to 0 as the pen
              draws. Round caps/joins keep the moving pen-tip clean.
              Gate on progress > 0 (like BoundingBox): at exactly 0 the whole path
              sits in the dash gap, but the end-point lands on a dash boundary and
              the round cap would render a stray zero-length dot at the path END
              (the right side). Not drawing until the pen has actually started
              avoids that artifact and keeps frame 0 clean. */}
          {markProgress > 0.001 ? (
            <Path
              d={d}
              fill="#00000000"
              stroke={stroke}
              strokeWidth={strokeWidth / scaleX}
              strokeCap="round"
              strokeJoin="round"
              strokeDash={[markLength, markLength]}
              strokeDashOffset={dashOffset}
            />
          ) : null}
        </Group>
      </Group>

      {/* 2. Title — settles in beneath the mark. The ScaleIn group is anchored at
          the title CENTER so the 0.9→1 scale grows about the center (scene scale
          pivots on the local origin), and the glyphs are drawn at -halfWidth. */}
      <Group x={centerX} y={titleTop}>
        <ScaleIn delay={delay + TITLE_OFFSET} durationInFrames={DURATION.base} from={0.9}>
          <Text
            x={-titleWidth / 2}
            fontSize={titleFontSize}
            color={color}
            fontFamily={fontFamily}
            fontWeight={fontWeight}
          >
            {title}
          </Text>
        </ScaleIn>
      </Group>

      {/* 3. Accent rule — earned, single, last. Only when `accent` is true. We
          hand `Underline` the title (so the rule width tracks the wordmark) with
          a fully-transparent text color so the title glyphs DON'T double-render —
          only the rule reads (the engine analogue of ondajs's empty string). The
          rule is centered under the title; `Underline` places it below the line
          box, so we anchor this group at the title's top-left. */}
      {accent ? (
        <Group x={titleLeft} y={titleTop}>
          <Underline
            text={title}
            delay={delay + UNDERLINE_OFFSET}
            duration={1}
            lineDelay={0}
            lineDuration={DURATION.fast}
            color="#00000000"
            accentColor={accentColor}
            fontSize={titleFontSize}
            fontFamily={fontFamily}
            fontWeight={fontWeight}
            lineThickness={3}
            lineOffset={0}
            align="center"
          />
        </Group>
      ) : null}
    </Group>
  )
}
