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

import {
  Ellipse,
  Group,
  Path,
  Rect,
  Text,
  radialGradient,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import type { TextRunInput } from '@onda/react'
import { useStaggeredEntrance, useTextReveal } from '../hooks.js'
import { STAGGER } from '../motion.js'
import { type Placement, usePlacement } from '../placement.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

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
  delay?: TimeInput
  /** Frames to type the whole command (linear cadence). */
  typeSpeed?: TimeInput
  /** Frames after the command finishes before output begins. */
  outputDelay?: TimeInput
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
  /** Where the window sits: a region keyword (`'center'`, `'lower-third'`, …)
   *  or normalized `{x,y}` (0–1, window center). The shared placement contract;
   *  default `'center'`. */
  placement?: Placement
  /** @deprecated Legacy alias — absolute x of the window's top-left in px.
   *  Prefer `placement`. */
  x?: number
  /** @deprecated Legacy alias — absolute y of the window's top-left in px.
   *  Prefer `placement`. */
  y?: number
}

// Monospace glyph advance as a fraction of font size — for the prompt offset
// only (the command/cursor are glued by the engine's own measurement via runs).
const MONO_CHAR_W = 0.6
// Line box as a fraction of font size (ondajs uses CSS line-height 1.6).
const LINE_HEIGHT = 1.6

// Output check mark. The mono font lacks U+2713 (it falls back to "√"), so a
// leading "✓"/"✔" on an output line is stripped from the text and drawn as a
// small <Path> tick instead. The "M…L…L…" coords are in a unit (0..1) box,
// scaled by `checkBox` at the call site.
const CHECK_GLYPHS = /^[✓✔]\s?/u
const CHECK_PATH = 'M 0.18 0.55 L 0.42 0.78 L 0.84 0.26'

export function Terminal({
  command = 'npx ondajs add code-block',
  output = ['✓ added code-block', '✓ wrote 4 files'],
  prompt = '$',
  title = 'zsh',
  chrome = true,
  delay: delayIn = 0,
  typeSpeed: typeSpeedIn = 30,
  outputDelay: outputDelayIn = 8,
  fontFamily: fontFamilyProp,
  fontSize = 48,
  width = 1100,
  textColor: textColorProp,
  promptColor: promptColorProp,
  outputColor: outputColorProp,
  background: backgroundProp,
  cornerRadius: cornerRadiusProp,
  placement,
  x,
  y,
}: TerminalProps) {
  const frame = useCurrentFrame()
  const { width: compWidth, height: compHeight, fps } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const typeSpeed = framesOf(typeSpeedIn, fps)
  const outputDelay = framesOf(outputDelayIn, fps)
  const theme = useTheme()
  const textColor = textColorProp ?? theme.text
  const promptColor = promptColorProp ?? theme.accent
  const outputColor = outputColorProp ?? theme.textMuted
  // The window must read as a SURFACE sitting on the canvas, so it defaults to
  // the theme's surface token, not the page background (which would be invisible
  // against an identically-colored composition background).
  const background = backgroundProp ?? theme.surface
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

  // Deterministic blink keyed purely off the frame — a calm, steady cadence:
  // a ~0.62s period where the cursor rests visible for most of it and winks off
  // only briefly, so it reads settled and confident rather than strobing.
  const period = Math.max(2, Math.round(fps * 0.62))
  const blinkOn = frame % period < Math.round(period * 0.66)
  const showCursor = typing && blinkOn

  // Output lines settle in on the house stagger after the command finishes
  // typing — a small rise + fade (opacity + a few px of translateY) on the
  // smooth spring, so each line decelerates into place instead of popping.
  const outputAt = useStaggeredEntrance({
    type: 'rise',
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

  // Anchor on the shared placement contract (window CENTER at the resolved
  // point; corner regions sit flush on the safe margin). Legacy px `x`/`y`
  // (the window's top-left) win per-axis; the default is centered, as before.
  const resolved = usePlacement(placement, { width, height: windowHeight })
  const winX = x ?? Math.round(resolved.originX)
  const winY = y ?? Math.round(resolved.originY)

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

  // Drawn check mark for output lines: a unit <Path> scaled into a glyph-sized
  // box that occupies the same horizontal slot as the stripped "✓ " prefix, so
  // the remaining text aligns exactly where it would after the glyph.
  const checkBox = Math.round(fontSize * 0.62)
  const checkGap = Math.round(fontSize * MONO_CHAR_W * 2 - checkBox)

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
      {/* Depth: a soft, large-radius drop shadow tinted toward the page
          background (never hard black) — painted first so the window reads as a
          surface lifted off the canvas. GPU-only (a canvas-local radial fading
          to transparent), centered just below the panel. */}
      <Rect
        x={-width * 0.12}
        y={windowHeight * 0.04}
        width={width * 1.24}
        height={windowHeight * 1.24}
        gradient={radialGradient(
          // Center in the Rect's local space so it sits beneath the panel mid.
          [width * 0.62, windowHeight * 0.5],
          width * 0.6,
          [
            { offset: 0, color: withAlpha(theme.background, 0x66) },
            { offset: 1, color: withAlpha(theme.background, 0x00) },
          ],
        )}
      />

      {/* A subtle accent glow bleeding from the window's top edge — the one
          earned flourish, kept faint so it warms the panel without shouting. */}
      <Rect
        x={-width * 0.1}
        y={-windowHeight * 0.14}
        width={width * 1.2}
        height={windowHeight * 0.6}
        gradient={radialGradient(
          // Centered on the panel's top edge, in the Rect's local space.
          [width * 0.6, windowHeight * 0.14],
          width * 0.5,
          [
            { offset: 0, color: withAlpha(promptColor, 0x1c) },
            { offset: 1, color: withAlpha(promptColor, 0x00) },
          ],
        )}
      />

      {/* Window panel — a near-black surface with a hairline border so its edge
          reads crisply against the canvas. */}
      <Rect
        width={width}
        height={windowHeight}
        cornerRadius={cornerRadius}
        fill={background}
        stroke={theme.border}
        strokeWidth={1}
      />

      {/* Title bar: dots + optional label + a hairline separator that divides the
          bar from the body, so the chrome reads as a real terminal window. */}
      {chrome ? (
        <>
          <Rect x={0} y={titleBarHeight - 1} width={width} height={1} fill={theme.border} />
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
        letterSpacing={fontSize * 0.04}
        color={textColor}
        fontFamily={fontFamily}
        fontWeight={500}
        runs={commandRuns}
      >
        {revealed}
      </Text>

      {/* Output lines — staggered fade once the command finishes typing. A line
          prefixed with a check glyph gets a drawn <Path> tick (the mono font has
          no U+2713) and the prefix is stripped from its text. */}
      {output.map((line, i) => {
        const hasCheck = CHECK_GLYPHS.test(line)
        const text = hasCheck ? line.replace(CHECK_GLYPHS, '') : line
        const rowY = bodyTop + (i + 1) * lineBox
        const textX = hasCheck ? bodyPadX + checkBox + checkGap : bodyPadX
        const { opacity, y: riseY } = outputAt(i)
        return (
          <Group key={i} y={riseY} opacity={opacity}>
            {hasCheck ? (
              <Group
                x={bodyPadX}
                y={rowY + Math.round((fontSize - checkBox) / 2)}
                scaleX={checkBox}
                scaleY={checkBox}
              >
                <Path d={CHECK_PATH} stroke={theme.accent} strokeWidth={2.2 / checkBox} />
              </Group>
            ) : null}
            <Text
              x={textX}
              y={rowY}
              fontSize={fontSize}
              color={outputColor}
              fontFamily={fontFamily}
            >
              {text}
            </Text>
          </Group>
        )
      })}
    </Group>
  )
}

/** Return `color` (`#rrggbb` / `#rrggbbaa` / `#rgb`) with its alpha channel set
 *  to the given byte (0..255), preserving RGB so a glow fades the tone itself
 *  rather than toward black. Falls back to the input unchanged on an unknown
 *  format. */
function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(255, Math.round(alpha)))
    .toString(16)
    .padStart(2, '0')
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    if (hex.length === 6 || hex.length === 8) {
      return `#${hex.slice(0, 6)}${a}`
    }
    if (hex.length === 3) {
      const r = hex[0] ?? '0'
      const g = hex[1] ?? '0'
      const b = hex[2] ?? '0'
      return `#${r}${r}${g}${g}${b}${b}${a}`
    }
  }
  return color
}
