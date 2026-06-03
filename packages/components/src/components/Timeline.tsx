//! Timeline — a vertical event timeline. Ported from ondajs (`timeline`).
//!
//! A vertical line (`<Rect>`) draws on top-to-bottom first, then event dots
//! (`<Ellipse>`) cascade in down the line with the canonical stagger, then each
//! label (`<Text>`) fades in beside its dot. The final dot earns the dusty-rose
//! accent — one focal moment, the rest neutral. This mirrors the ondajs
//! choreography (line → dots → labels); ondajs lays the line out horizontally,
//! this port runs it vertically (per the engine component spec) with an explicit
//! `y` per event.
//!
//! Layout / scene caveats:
//! - FIXED dimensions, centered by computing a top-left offset from the
//!   composition size (the BarChart pattern) rather than a `<Flex>`/
//!   `<AbsoluteFill>` — the line-reveal clip animates per frame, and a layout
//!   container would chase the growing bbox and jiggle. Dots/labels are placed by
//!   explicit `x`/`y` inside one `<Group>`, never as Flex children.
//! - The line "draws on" via a `clipRect` (engine signature
//!   `clipRect(width, height)`, anchored at the clip Group's local origin) whose
//!   height grows top→bottom. The engine has no stroke-dash draw-on, so a clip
//!   reveal is the faithful substitute (the ondajs original used `evolvePath`
//!   stroke-dash).
//! - `entryScale` pivots on a node's LOCAL origin (0,0), so each dot's subtree
//!   origin is translated to the dot CENTER first; the dot then scales from its
//!   own center, not its top-left corner.

import {
  Ellipse,
  Group,
  Rect,
  Text,
  clipRect,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import { entryFade, entryScale } from '../choreography.js'
import { DURATION, SPRING_SMOOTH, STAGGER, staggerFrames } from '../motion.js'
import { measureText, useTextMetricsReady } from '../text-metrics.js'
import { useTheme } from '../theme.js'

/** One anchor on the timeline. */
export interface TimelineEvent {
  label: string
}

export interface TimelineProps {
  /** Anchor points down the timeline. Order is preserved — top to bottom. */
  events?: TimelineEvent[]
  /** Frames before the line begins to draw. */
  delay?: number
  /** Frames over which the vertical line reveals itself top→bottom. */
  lineDuration?: number
  /** Frames between the line completing and the first dot appearing. */
  dotDelay?: number
  /** Frames between consecutive dot entrances (canonical Onda stagger = 4). */
  dotStagger?: number
  /** Per-dot entrance duration. */
  dotDuration?: number
  /** Dot diameter in px. */
  dotSize?: number
  /** Vertical distance between consecutive events, in px. */
  spacing?: number
  /** Line thickness in px. */
  lineWidth?: number
  /** Line color (default: theme `border`). */
  lineColor?: string
  /** Non-final dot color (default: theme `text`). */
  dotColor?: string
  /** Final dot color — the earned accent (Onda rose) (default: theme `accent`). */
  accentColor?: string
  /** Label color (default: theme `textMuted`). */
  labelColor?: string
  /** Label font size in px. */
  fontSize?: number
  /** Loaded font family for labels (default: theme `headingFamily ?? fontFamily`). */
  fontFamily?: string
}

const DEFAULT_EVENTS: TimelineEvent[] = [
  { label: 'Concept' },
  { label: 'Build' },
  { label: 'Ship' },
  { label: 'Iterate' },
]

export function Timeline({
  events = DEFAULT_EVENTS,
  delay = 0,
  lineDuration = DURATION.slow,
  dotDelay = 8,
  dotStagger = STAGGER,
  dotDuration = DURATION.base,
  dotSize = 18,
  spacing = 110,
  lineWidth = 4,
  lineColor: lineColorProp,
  dotColor: dotColorProp,
  accentColor: accentColorProp,
  labelColor: labelColorProp,
  fontSize = 28,
  fontFamily: fontFamilyProp,
}: TimelineProps) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const theme = useTheme()
  const lineColor = lineColorProp ?? theme.border
  const dotColor = dotColorProp ?? theme.text
  const accentColor = accentColorProp ?? theme.accent
  const labelColor = labelColorProp ?? theme.textMuted
  const fontFamily = fontFamilyProp ?? theme.headingFamily ?? theme.fontFamily

  const count = events.length
  const lastIndex = count - 1

  // Vertical extent the dots span: first dot at y=0, last at spacing*lastIndex.
  const dotsSpan = count > 1 ? spacing * lastIndex : 0
  // Pixels reserved between a dot's right edge and its label.
  const labelGap = Math.round(dotSize * 0.9) + 16

  // Local x where labels start (just past the dot + gap).
  const labelX = dotSize + labelGap

  // Footprint of the whole subtree. Content runs from the dot column's left edge
  // (local x=0) to the right end of the WIDEST label — measured exactly (real
  // shaped width) and reserved from `labelX` outward, so the timeline centers on
  // true canvas center. `useTextMetricsReady` warms the engine in the browser;
  // `measureText` is the per-label sync read (a hook can't run in a reduce).
  useTextMetricsReady()
  const maxLabelWidth = events.reduce(
    (max, e) =>
      Math.max(
        max,
        Math.ceil(measureText(e.label, fontSize, { fontFamily, fontWeight: 500 }).width),
      ),
    0,
  )
  const subtreeWidth = labelX + maxLabelWidth
  const subtreeHeight = dotsSpan

  // Center by an explicit offset — no layout container chasing the animated clip.
  const originX = Math.round((width - subtreeWidth) / 2)
  const originY = Math.round((height - subtreeHeight) / 2)

  // The line sits along the dot column (dots centered on it). Local x of the
  // line's left edge so the line is centered under the dots.
  const lineX = Math.round((dotSize - lineWidth) / 2)

  // Line-draw reveal: a top→bottom clip that grows with the house spring. The
  // line spans from the first dot center to the last dot center.
  const lineLocal = Math.max(0, frame - delay)
  const lineProgress =
    count > 1
      ? spring({ frame: lineLocal, fps, config: SPRING_SMOOTH, durationInFrames: lineDuration })
      : 0
  const revealHeight = interpolate(lineProgress, [0, 1], [0, dotsSpan], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <Group x={originX} y={originY}>
      {/* The vertical line. Drawn from the first dot center down to the last.
          Revealed top→bottom by a clip whose height animates. The engine's
          `clipRect(width, height)` is anchored at this Group's local origin
          (0,0), so it clips the column [0, lineX+lineWidth] × [0, revealHeight];
          the line Rect (at x=lineX) is fully covered horizontally and revealed
          down to `revealHeight`. The Rect's own measured size never changes, so
          nothing reflows. Rendered only with ≥2 events — a single event has no
          line. */}
      {count > 1 && revealHeight > 0 ? (
        <Group clip={clipRect(lineX + lineWidth, revealHeight)}>
          <Rect
            x={lineX}
            y={0}
            width={lineWidth}
            height={dotsSpan}
            cornerRadius={lineWidth / 2}
            fill={lineColor}
          />
        </Group>
      ) : null}

      {events.map((event, i) => {
        const thisDotDelay = delay + lineDuration + dotDelay + staggerFrames(i, dotStagger)

        // Dot entrance — scale + fade from the canonical vocabulary.
        const dotMotion = entryScale({
          frame,
          fps,
          delay: thisDotDelay,
          durationInFrames: dotDuration,
        })

        // Label trails its dot by 2 frames — dot leads, label is its consequence.
        const labelMotion = entryFade({
          frame,
          fps,
          delay: thisDotDelay + 2,
          durationInFrames: dotDuration,
        })

        const isLast = i === lastIndex
        const fillColor = isLast ? accentColor : dotColor

        // Dot center: column centered on the line, stepping down by `spacing`.
        const dotCenterX = dotSize / 2
        const dotCenterY = spacing * i

        return (
          <Group key={`${i}-${event.label}`}>
            {/* Dot. The subtree origin is moved to the dot CENTER so entryScale
                grows from the center (scale pivots on the local origin). */}
            <Group
              x={dotCenterX}
              y={dotCenterY}
              scaleX={dotMotion.scaleX}
              scaleY={dotMotion.scaleY}
              opacity={dotMotion.opacity}
            >
              <Ellipse
                x={-dotSize / 2}
                y={-dotSize / 2}
                width={dotSize}
                height={dotSize}
                fill={fillColor}
              />
            </Group>

            {/* Label — opacity-only motion, placed by explicit x/y. Vertically
                centered against the dot (text is measured from its own origin,
                so nudge up by half the font size). */}
            <Group opacity={labelMotion.opacity}>
              <Text
                x={dotSize + labelGap}
                y={dotCenterY - Math.round(fontSize / 2)}
                fontSize={fontSize}
                color={isLast ? accentColor : labelColor}
                fontFamily={fontFamily}
                fontWeight={500}
              >
                {event.label}
              </Text>
            </Group>
          </Group>
        )
      })}
    </Group>
  )
}
