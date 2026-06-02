//! Terminal — a terminal session window. Ported from ondajs.
//!
//! A dark rounded window (`<Rect>`) with an optional title bar (three dot
//! `<Ellipse>`s + a label). After an optional delay the command types itself
//! out one glyph per frame after the prompt, a block cursor blinks while typing
//! (keyed off the frame, never a timer — so the result is deterministic), then
//! the output lines appear one-by-one on a fade stagger once typing finishes.
//!
//! Layout note: the visible command grows one glyph per step, so its measured
//! width changes every frame; output lines fade their opacity per-frame too. A
//! Flex/AbsoluteFill column would reflow/jiggle on those changes (HARD RULE 2),
//! so every line is positioned at an explicit `x`/`y` inside the window
//! `<Group>` instead of being laid out by Flex — the window frame stays rock
//! steady while the command types into it.
//!
//! Self-positioning: ondajs uses a `PlacementBox` (CSS) to place the window on
//! the canvas. The engine has no CSS placement, so the window is centered on the
//! composition by default; pass explicit `x`/`y` (top-left of the window) to
//! place it elsewhere.
//!
//! Cursor caveat: like `Typewriter`, the blinking block cursor is appended as a
//! second styled `runs` entry so the engine measures the command and positions
//! the cursor right after the last revealed glyph — no manual text-width math.
//! Per-run colors render on the GPU (Vello) path; the CPU reference draws the
//! concatenated runs in the node's base style, so there the cursor inherits the
//! command's `textColor`. GPU is the primary path, so this is acceptable.
//!
//! Color defaults: ondajs ships `var(--onda-…, #hex)` CSS-token defaults. The
//! engine has no CSS variables, so the literal hex fallbacks are used directly.

import { Ellipse, Group, Rect, Text, useCurrentFrame, useVideoConfig } from '@onda/react'
import type { TextRunInput } from '@onda/react'
import { useStaggeredEntrance, useTextReveal } from '../hooks.js'
import { STAGGER } from '../motion.js'
import { useTheme } from '../theme.js'

export interface TerminalProps {
  /** The command that types itself out after the prompt. */
  command?: string
  /** Output lines that appear, staggered, once the command finishes typing. */
  output?: string[]
  /** The shell prompt glyph. */
  prompt?: string
  /** Title-bar label. Empty hides it (dots still show if `chrome` is on). */
  title?: string
  /** Show window chrome (dots + title bar). */
  chrome?: boolean
  /** Frames before typing starts. */
  delay?: number
  /** Frames to type the whole command (linear cadence). */
  typeSpeed?: number
  /** Frames after the command finishes before output begins. */
  outputDelay?: number
  /** Monospace font stack (default: theme `monoFamily`). */
  fontFamily?: string
  /** Font size in px. Sized for a 1080p+ video canvas, not a screen UI. */
  fontSize?: number
  /** Width of the window in px. Fixed so the frame is stable while the command
   *  types into it — a terminal has a defined size, it doesn't grow char by char. */
  width?: number
  /** Command text color (default: theme `text`). */
  textColor?: string
  /** Prompt glyph color — the earned accent (default: theme `accent`). */
  promptColor?: string
  /** Output line color (default: theme `textMuted`). */
  outputColor?: string
  /** Window background color (default: theme `background`). */
  background?: string
  /** Window corner radius in px (default: theme `radius`). */
  cornerRadius?: number
  /** Absolute x of the window's top-left. Defaults to horizontally centered. */
  x?: number
  /** Absolute y of the window's top-left. Defaults to vertically centered. */
  y?: number
}

// Monospace glyph advance as a fraction of font size — for the prompt offset
// only (the command/cursor are glued by the engine's own measurement via runs).
const MONO_CHAR_W = 0.6
// Line box as a fraction of font size (ondajs uses CSS line-height 1.6).
const LINE_HEIGHT = 1.6

export function Terminal({
  command = 'npx ondajs add code-block',
  output = ['✓ added code-block', '✓ wrote 4 files'],
  prompt = '$',
  title = 'zsh',
  chrome = true,
  delay = 0,
  typeSpeed = 30,
  outputDelay = 8,
  fontFamily: fontFamilyProp,
  fontSize = 48,
  width = 1100,
  textColor: textColorProp,
  promptColor: promptColorProp,
  outputColor: outputColorProp,
  background: backgroundProp,
  cornerRadius: cornerRadiusProp,
  x,
  y,
}: TerminalProps) {
  const frame = useCurrentFrame()
  const { width: compWidth, height: compHeight, fps } = useVideoConfig()
  const theme = useTheme()
  const textColor = textColorProp ?? theme.text
  const promptColor = promptColorProp ?? theme.accent
  const outputColor = outputColorProp ?? theme.textMuted
  const background = backgroundProp ?? theme.background
  const fontFamily =
    fontFamilyProp ??
    theme.monoFamily ??
    theme.fontFamily ??
    'ui-monospace, "SF Mono", Menlo, monospace'

  // Linear char count for the command — constant cadence (the intentional
  // non-spring case; matches ondajs `useTextReveal`).
  const shown = useTextReveal({ length: command.length, delay, durationInFrames: typeSpeed })
  const revealed = command.slice(0, Math.max(0, shown))
  const typing = shown < command.length

  // Deterministic blink keyed purely off the frame: toggles every half second.
  const half = Math.max(1, Math.round(fps / 2))
  const blinkOn = Math.floor(frame / half) % 2 === 0
  const showCursor = typing && blinkOn

  // Output lines fade in, staggered, after the command finishes typing.
  const outputAt = useStaggeredEntrance({
    type: 'fade',
    delay: delay + typeSpeed + outputDelay,
    increment: STAGGER,
  })

  // Window geometry. Title bar holds the dots + label; the body holds the
  // command line plus one row per output line. Everything is sized in px from
  // the font size so the box is stable regardless of how much has typed.
  const lineBox = Math.round(fontSize * LINE_HEIGHT)
  const titleBarHeight = chrome ? Math.round(fontSize * 1.5) : 0
  const bodyPadX = Math.round(fontSize * 0.75)
  const bodyPadY = Math.round(fontSize * 0.6)
  const lineCount = 1 + output.length
  const bodyHeight = bodyPadY * 2 + lineCount * lineBox
  const windowHeight = titleBarHeight + bodyHeight
  const cornerRadius = cornerRadiusProp ?? theme.radius

  // Center on the canvas unless an explicit position is given (the engine has no
  // CSS placement). x/y are the window's top-left in composition space.
  const winX = x ?? Math.round((compWidth - width) / 2)
  const winY = y ?? Math.round((compHeight - windowHeight) / 2)

  // Title-bar dots: three neutral-grey circles, matching ondajs's chrome dots
  // (it draws `--onda-border-lit, #26262E`; here a touch lighter so they read).
  const dotR = Math.round(fontSize * 0.19)
  const dotGap = Math.round(fontSize * 0.42)
  const dotY = Math.round(titleBarHeight / 2 - dotR)
  const dotColor = '#3a3a42'
  const dotStartX = bodyPadX

  // Prompt + command share the first body line. The command is offset past the
  // prompt glyph plus one space (estimated for a monospace stack).
  const bodyTop = titleBarHeight + bodyPadY
  const promptX = bodyPadX
  const commandX = promptX + Math.round((prompt.length + 1) * fontSize * MONO_CHAR_W)

  // Cursor as a second styled run so the engine glues the block glyph right
  // after the last revealed command glyph (no manual text-width math).
  const commandRuns: TextRunInput[] | undefined = showCursor
    ? [
        { text: revealed, color: textColor, fontSize, fontFamily, fontWeight: 500 },
        { text: '▍', color: textColor, fontSize, fontFamily, fontWeight: 500 },
      ]
    : undefined

  return (
    <Group x={winX} y={winY}>
      {/* Window panel. */}
      <Rect width={width} height={windowHeight} cornerRadius={cornerRadius} fill={background} />

      {/* Title bar: dots + optional label. */}
      {chrome ? (
        <>
          <Ellipse x={dotStartX} y={dotY} width={dotR * 2} height={dotR * 2} fill={dotColor} />
          <Ellipse
            x={dotStartX + dotGap}
            y={dotY}
            width={dotR * 2}
            height={dotR * 2}
            fill={dotColor}
          />
          <Ellipse
            x={dotStartX + dotGap * 2}
            y={dotY}
            width={dotR * 2}
            height={dotR * 2}
            fill={dotColor}
          />
          {title ? (
            <Text
              x={dotStartX + dotGap * 2 + dotR * 2 + Math.round(fontSize * 0.6)}
              y={Math.round(titleBarHeight / 2 - fontSize * 0.62 * 0.62)}
              fontSize={Math.round(fontSize * 0.62)}
              color="#56565f"
              fontFamily={fontFamily}
            >
              {title}
            </Text>
          ) : null}
        </>
      ) : null}

      {/* Prompt glyph + the command typing itself out (with cursor run). */}
      <Text x={promptX} y={bodyTop} fontSize={fontSize} color={promptColor} fontFamily={fontFamily}>
        {prompt}
      </Text>
      <Text
        x={commandX}
        y={bodyTop}
        fontSize={fontSize}
        color={textColor}
        fontFamily={fontFamily}
        fontWeight={500}
        runs={commandRuns}
      >
        {revealed}
      </Text>

      {/* Output lines — staggered fade once the command finishes typing. */}
      {output.map((line, i) => (
        <Text
          key={i}
          x={bodyPadX}
          y={bodyTop + (i + 1) * lineBox}
          fontSize={fontSize}
          color={outputColor}
          fontFamily={fontFamily}
          opacity={outputAt(i).opacity}
        >
          {line}
        </Text>
      ))}
    </Group>
  )
}
