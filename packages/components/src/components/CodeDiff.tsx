//! CodeDiff — a unified code diff panel, revealed line-by-line. Added / removed
//! lines carry a colored left border + gutter symbol (`+`/`−`) and a tinted row
//! backing; context lines stay neutral. Ported from ondajs (`code-diff`).
//!
//! Like `BarChart`, the panel has FIXED dimensions and is positioned by
//! computing its top-left offset (centered) inside a single `<Group>` — NOT a
//! `<Flex>` — because each line reveals with a translate (rise), and a layout
//! container would reflow (jiggle) as the measured subtree grew. Every line
//! sits at an EXPLICIT `y` (`rowHeight * i`); its tinted backing `<Rect>`,
//! left-border accent `<Rect>`, gutter, and monospace `<Text>` all hang off
//! that row's local origin.
//!
//! Approximations vs ondajs:
//!  - CSS `background: ${c}14` (≈8% alpha tint) → the backing `<Rect>` fill uses
//!    an `#rrggbbXX` alpha-hex string derived from the line color (suffix `14`).
//!  - The 4px CSS `border-left` is a thin accent `<Rect>` at the row's left edge.
//!  - The dimmed gutter (`opacity: 0.8` in ondajs) uses a `cc` alpha suffix
//!    (0xcc/0xff ≈ 0.8) on the line color.
//!  - Colors are normalized to 6-digit `rrggbb` before the alpha suffix is
//!    appended (via `rgbHex`), so any supported hex form is accepted without
//!    tripping the engine's strict color parser.
//!  - `letter-spacing` on the title is unsupported and dropped.
//!  - Monospace alignment relies on a monospace `fontFamily`; the engine measures
//!    each line, so columns line up if (and only if) the font is monospaced.
//!  - The window-chrome dots are `<Ellipse>` nodes; the `var(--onda-*)` CSS
//!    fallbacks are replaced with concrete hex colors.
//!  - Engine `<Text>` is single-line (no auto-wrap) — pre-split any line that
//!    would exceed the panel width.

import { Ellipse, Group, Rect, Text, useCurrentFrame, useVideoConfig } from '@onda/react'
import { entryFadeRise } from '../choreography.js'
import { DURATION, STAGGER, staggerFrames } from '../motion.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

/** Line kind — drives gutter symbol, color, and row treatment. */
export type DiffLineType = 'add' | 'remove' | 'context'

/** A single diff line. */
export interface DiffLine {
  /** The line text (no leading +/−; the gutter adds it). */
  text: string
  /** Line kind. Defaults to `'context'` when omitted. */
  type?: DiffLineType
}

export interface CodeDiffProps {
  /** The diff lines, top to bottom. */
  lines?: DiffLine[]
  /** Filename shown in the title bar. */
  title?: string
  /** Show window chrome (dots + title bar). */
  chrome?: boolean
  /** Reveal lines one-by-one (else all appear together). */
  revealLines?: boolean
  /** Frames before the first line appears. */
  delay?: TimeInput
  /** Frames between consecutive line reveals (default canonical `STAGGER` = 5). */
  lineDelay?: TimeInput
  /** Monospace font stack for code (and the title) (default: theme `monoFamily ?? fontFamily`). */
  fontFamily?: string
  /** Code font size in px. */
  fontSize?: number
  /** Panel width in px. */
  width?: number
  /** Default (context) text color (default: theme `textMuted`). */
  textColor?: string
  /** Added-line color — a restrained green (default: theme `palette[3]`). */
  addColor?: string
  /** Removed-line color — a restrained red tinted toward bg (default: `#cf6f7e`). */
  removeColor?: string
  /** Panel surface (glass) fill (default: theme `surface`). */
  surfaceColor?: string
  /** Panel border / chrome divider color (default: theme `border`). */
  borderColor?: string
  /** Panel corner radius in px (default: theme `radius`). */
  cornerRadius?: number
  /** Window-chrome traffic-light dot color (default: theme `border`). */
  chromeDotsColor?: string
  /** Window-chrome title (filename) color — the one earned accent: it names the
   *  file under change (default: theme `accent`). */
  chromeTitleColor?: string
}

const DEFAULT_LINES: DiffLine[] = [
  { text: "const onda = motion('default');", type: 'remove' },
  { text: "const onda = motion('identity');", type: 'add' },
  { text: 'export default onda;', type: 'context' },
]

// Two-hex alpha suffix (~8%) for the row backing tint — the scene equivalent of
// ondajs's `${color}14` (0x14 / 0xff ≈ 0.078).
const TINT_ALPHA = '14'
// Two-hex alpha suffix (~80%) for the dimmed gutter glyph — the scene
// equivalent of ondajs's `opacity: 0.8` (0xcc / 0xff ≈ 0.8).
const GUTTER_ALPHA = 'cc'

// Removed-line default — a restrained, desaturated red pulled toward the dark bg
// (not a garish diff-tool neon), paired with the muted `palette[3]` green for
// adds. The theme accent is freed for the ONE earned highlight (the filename).
const RESTRAINED_RED = '#cf6f7e'

/** Strip a leading `#` and any trailing alpha, yielding a clean 6-digit
 *  `rrggbb` so an alpha suffix can be appended without tripping the engine's
 *  strict color parser. Mirrors the helper in `Vignette.tsx`. */
function rgbHex(color: string): string {
  let hex = color.startsWith('#') ? color.slice(1) : color
  if (hex.length === 3 || hex.length === 4) {
    const r = hex[0] ?? '0'
    const g = hex[1] ?? '0'
    const b = hex[2] ?? '0'
    hex = `${r}${r}${g}${g}${b}${b}`
  }
  return hex.slice(0, 6).padEnd(6, '0')
}

export function CodeDiff({
  lines = DEFAULT_LINES,
  title = 'motion.ts',
  chrome = true,
  revealLines = true,
  delay: delayIn = 0,
  lineDelay: lineDelayIn = STAGGER,
  fontFamily: fontFamilyProp,
  fontSize = 44,
  width = 760,
  textColor: textColorProp,
  addColor: addColorProp,
  removeColor: removeColorProp,
  surfaceColor: surfaceColorProp,
  borderColor: borderColorProp,
  cornerRadius: cornerRadiusProp,
  chromeDotsColor: chromeDotsColorProp,
  chromeTitleColor: chromeTitleColorProp,
}: CodeDiffProps) {
  const frame = useCurrentFrame()
  const { fps, width: compWidth, height: compHeight } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const lineDelay = framesOf(lineDelayIn, fps)
  const theme = useTheme()
  const fontFamily = fontFamilyProp ?? theme.monoFamily ?? theme.fontFamily
  const textColor = textColorProp ?? theme.textMuted
  const addColor = addColorProp ?? theme.palette[3] ?? '#7fb58c'
  const removeColor = removeColorProp ?? RESTRAINED_RED
  const surfaceColor = surfaceColorProp ?? theme.surface
  const borderColor = borderColorProp ?? theme.border
  const cornerRadius = cornerRadiusProp ?? theme.radius
  const chromeDotsColor = chromeDotsColorProp ?? theme.border
  // The one earned accent: the filename names the subject under change.
  const chromeTitleColor = chromeTitleColorProp ?? theme.accent

  // Monospace line box height (CSS line-height 1.6 in ondajs).
  const lineHeight = Math.round(fontSize * 1.6)
  // Left padding before the gutter; gutter is ~1.4em wide.
  const padLeft = 18
  const gutterWidth = Math.round(fontSize * 1.4)
  const accentBarWidth = 4

  // Vertical padding around the code block (CSS `24px 0`).
  const codePadY = 24
  const chromeHeight = chrome ? Math.round(fontSize * 1.2) + 36 : 0

  const codeBlockHeight = lines.length > 0 ? lines.length * lineHeight : 0
  const panelHeight = chromeHeight + codePadY * 2 + codeBlockHeight

  // Center the fixed-size panel by computing its top-left offset directly — no
  // layout container, so the per-frame line rise never triggers a reflow.
  const originX = Math.round((compWidth - width) / 2)
  const originY = Math.round((compHeight - panelHeight) / 2)

  const dotRadius = 9
  const dotGap = 10

  const colorFor = (t: DiffLineType): string =>
    t === 'add' ? addColor : t === 'remove' ? removeColor : textColor
  const gutterFor = (t: DiffLineType): string => (t === 'add' ? '+' : t === 'remove' ? '−' : '')

  return (
    <Group x={originX} y={originY}>
      {/* Glass surface. A soft, large-radius, low-opacity drop shadow tinted
          toward the dark bg (not hard black) lifts the panel off the canvas. */}
      <Rect
        x={0}
        y={0}
        width={width}
        height={panelHeight}
        cornerRadius={cornerRadius}
        fill={surfaceColor}
        stroke={borderColor}
        strokeWidth={1}
        shadow={{ color: `#${rgbHex(theme.background)}66`, blur: 36, offsetY: 18 }}
      />

      {chrome ? (
        <Group x={0} y={0}>
          {/* Three traffic-light dots, vertically centered in the chrome bar. */}
          {[0, 1, 2].map((d) => (
            <Ellipse
              key={`dot-${d}`}
              x={24 + d * (dotRadius * 2 + dotGap) + dotRadius}
              y={Math.round(chromeHeight / 2)}
              width={dotRadius * 2}
              height={dotRadius * 2}
              fill={chromeDotsColor}
            />
          ))}
          {/* Filename label, to the right of the dots — the earned accent. Tight
              negative tracking + a touch more weight give it a little authority. */}
          <Text
            x={24 + 3 * (dotRadius * 2 + dotGap) + 10}
            y={Math.round((chromeHeight - fontSize * 0.6) / 2)}
            fontSize={Math.round(fontSize * 0.6)}
            letterSpacing={Math.round(fontSize * 0.6) * -0.02}
            fontWeight={500}
            color={chromeTitleColor}
            fontFamily={fontFamily}
          >
            {title}
          </Text>
          {/* Divider under the chrome bar. */}
          <Rect x={0} y={chromeHeight} width={width} height={1} fill={borderColor} />
        </Group>
      ) : null}

      {/* Code block. Each line sits at an explicit y; reveal is a per-line rise. */}
      <Group x={0} y={chromeHeight + codePadY}>
        {lines.map((line, i) => {
          const type: DiffLineType = line.type ?? 'context'
          const c = colorFor(type)
          const tinted = type !== 'context'
          const gutter = gutterFor(type)
          const rgb = rgbHex(c)

          // Per-line staggered rise — a confident settled lift on the house
          // spring (`entryFadeRise` is SPRING_SMOOTH), one line per STAGGER beat.
          const motion = revealLines
            ? entryFadeRise({
                frame,
                fps,
                delay: delay + staggerFrames(i, lineDelay),
                durationInFrames: DURATION.base,
                travelPx: 10,
              })
            : { opacity: 1, y: 0 }

          const rowY = i * lineHeight
          // Center the glyph baseline-ish within the line box.
          const textY = rowY + Math.round((lineHeight - fontSize) / 2)

          return (
            <Group key={`line-${i}`} y={motion.y} opacity={motion.opacity}>
              {tinted ? (
                <>
                  {/* Row backing tint (≈8% of the line color). */}
                  <Rect
                    x={0}
                    y={rowY}
                    width={width}
                    height={lineHeight}
                    fill={`#${rgb}${TINT_ALPHA}`}
                  />
                  {/* Left-border accent. */}
                  <Rect x={0} y={rowY} width={accentBarWidth} height={lineHeight} fill={c} />
                </>
              ) : null}

              {/* Gutter symbol (+/−), dimmed slightly via alpha, weighted a touch
                  heavier so the change reads at a glance against the code text. */}
              {gutter !== '' ? (
                <Text
                  x={padLeft}
                  y={textY}
                  fontSize={fontSize}
                  fontWeight={600}
                  color={`#${rgb}${GUTTER_ALPHA}`}
                  fontFamily={fontFamily}
                >
                  {gutter}
                </Text>
              ) : null}

              {/* Line text. */}
              <Text
                x={padLeft + gutterWidth}
                y={textY}
                fontSize={fontSize}
                color={c}
                fontFamily={fontFamily}
              >
                {line.text}
              </Text>
            </Group>
          )
        })}
      </Group>
    </Group>
  )
}
