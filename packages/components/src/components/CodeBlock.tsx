//! CodeBlock — syntax-highlighted source on a dark rounded panel, revealed
//! line-by-line on a stagger. Ported from ondajs (`code-block`).
//!
//! ondajs renders DOM: a glass `<Surface>` with a `<pre>` whose lines are
//! `<div>`s and tokens are `<span>`s colored by a deterministic regex
//! tokenizer. Here the same structure becomes scene nodes — a self-positioned
//! dark `<Rect>` panel (the "glass" surface), an optional macOS-style chrome
//! bar (`<Ellipse>` dots + a title `<Text>`), and one `<Text runs={...}>` per
//! source line. The tokenizer is ported verbatim: a single ordered regex →
//! per-token `{text,type}` → a styled run with the type's color. Pure function
//! of frame (§1) — no async, no Shiki, no state; frame N is reproducible.
//!
//! LAYOUT: the panel is centered by computing its top-left offset from the
//! composition size (not a `<Flex>`), so the per-frame line reveals never
//! trigger a reflow. Lines are positioned by EXPLICIT `y` inside the content
//! `<Group>`; each line's rise+fade is a nested inner `<Group>` carrying the
//! motion translate (HARD RULE 2 — translate lives on a child of the
//! absolutely-positioned content group, never on a Flex child).
//!
//! APPROXIMATIONS:
//! - The ondajs surface is a CSS frosted-glass panel. This renders a flat dark
//!   fill + 1px stroke; the engine now also ships a `backdropBlur` node prop
//!   (real frosted glass) this Surface could adopt in a follow-up.
//! - Per-token colors render on the GPU (Vello) `runs` path. The CPU reference
//!   rasterizer draws a line's concatenated run text in the node style, so the
//!   syntax highlighting collapses to `textColor` there. GPU is the primary
//!   path, so this is an acceptable degradation.
//! - Monospace column alignment relies on the engine gluing each run after the
//!   previous (it does), plus a real monospace `fontFamily` being loaded; with
//!   a proportional fallback, columns won't align (same as any code renderer).
//! - The per-line rise uses the choreography `rise` pattern; the engine's rise
//!   travels its default 12px (ondajs requested 6px). The difference is
//!   visually negligible and the cascade reads identically.

import { Ellipse, Group, Rect, Text, useVideoConfig } from '@onda-engine/react'
import type { TextRunInput } from '@onda-engine/react'
import { useStaggeredEntrance } from '../hooks.js'
import type { TextStyleProps } from '../text-style.js'
import { useTheme } from '../theme.js'
import type { TimeInput } from '../time.js'

export interface CodeBlockProps extends TextStyleProps {
  /** The source to render. Newlines split into reveal-able lines. */
  code?: string
  /** Filename shown in the title bar. Empty hides the title (dots still show if `chrome`). */
  title?: string
  /** Show the macOS-style window chrome (three dots + title bar). */
  chrome?: boolean
  /** Reveal lines one-by-one instead of all at once. */
  revealLines?: boolean
  /** Frames before the first line appears. */
  delay?: TimeInput
  /** Frames between successive line reveals. */
  lineDelay?: TimeInput
  /** Code font size in px. Sized for a video canvas, not a screen UI. */
  fontSize?: number
  /** Panel width in px. */
  width?: number
  /** Default text color — identifiers, punctuation, operators (default: theme `text`). */
  textColor?: string
  /** Keyword color. A muted, dusty violet — reads as syntax, not the brand accent (default: theme `palette[1]`). */
  keywordColor?: string
  /** String literal color — dusty sage (default: theme `palette[3]`). */
  stringColor?: string
  /** Comment color (default: theme `textMuted`). */
  commentColor?: string
  /** Numeric literal color — dusty amber (default: theme `palette[2]`). */
  numberColor?: string
  /** JSX / HTML tag-name color — dusty cyan (default: theme `palette[1]`). */
  tagColor?: string
  /** Panel background fill (the "glass" surface) (default: theme `surface`). */
  panelColor?: string
  /** Panel border color (default: theme `border`). */
  borderColor?: string
}

type TokenType = 'text' | 'keyword' | 'string' | 'comment' | 'number' | 'tag'

const KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'import',
  'export',
  'from',
  'default',
  'class',
  'extends',
  'new',
  'await',
  'async',
  'type',
  'interface',
  'of',
  'in',
  'true',
  'false',
  'null',
  'undefined',
  'this',
  'typeof',
  'as',
])

// Deterministic, dependency-free tokenizer. A single ordered regex captures
// comments / strings / numbers / identifiers / other; identifiers matching a
// keyword are colored. Pure — no async, no state, safe for render (§1).
const TOKEN_RE =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`[^`]*`|"[^"]*"|'[^']*')|(\b\d[\d._]*\b)|([A-Za-z_$][\w$]*)|(\s+|[^\s])/g

function tokenizeLine(line: string): Array<{ text: string; type: TokenType }> {
  const out: Array<{ text: string; type: TokenType }> = []
  // An identifier directly after `<` or `</` is a JSX/HTML tag name — color it
  // so markup reads with the variety a real editor theme has, not flat white.
  let expectTag = false
  for (const m of line.matchAll(TOKEN_RE)) {
    if (m[1]) {
      out.push({ text: m[1], type: 'comment' })
      expectTag = false
    } else if (m[2]) {
      out.push({ text: m[2], type: 'string' })
      expectTag = false
    } else if (m[3]) {
      out.push({ text: m[3], type: 'number' })
      expectTag = false
    } else if (m[4]) {
      if (expectTag) out.push({ text: m[4], type: 'tag' })
      else out.push({ text: m[4], type: KEYWORDS.has(m[4]) ? 'keyword' : 'text' })
      expectTag = false
    } else {
      const t = m[5] ?? ''
      out.push({ text: t, type: 'text' })
      // `<` opens a tag; a following `/` (closing tag) or whitespace keeps the
      // expectation alive; any other punctuation cancels it.
      if (t === '<') expectTag = true
      else if (t === '/' || /^\s+$/.test(t)) {
        /* keep expectTag */
      } else expectTag = false
    }
  }
  return out
}

const DEFAULT_CODE = "const onda = motion('identity');\nexport default onda;"

export function CodeBlock({
  code = DEFAULT_CODE,
  title = 'onda.ts',
  chrome = true,
  revealLines = true,
  delay = 0,
  lineDelay = 3,
  fontFamily: fontFamilyProp,
  letterSpacing,
  fontSize = 48,
  width = 900,
  textColor: textColorProp,
  keywordColor: keywordColorProp,
  stringColor: stringColorProp,
  commentColor: commentColorProp,
  numberColor: numberColorProp,
  tagColor: tagColorProp,
  panelColor: panelColorProp,
  borderColor: borderColorProp,
}: CodeBlockProps) {
  const { width: compWidth, height: compHeight } = useVideoConfig()
  const theme = useTheme()
  const fontFamily = fontFamilyProp ?? theme.monoFamily
  const textColor = textColorProp ?? theme.text
  const keywordColor = keywordColorProp ?? theme.palette[1] ?? '#B49DDD'
  const stringColor = stringColorProp ?? theme.palette[3] ?? '#9DBE9A'
  const commentColor = commentColorProp ?? theme.textMuted
  const numberColor = numberColorProp ?? theme.palette[2] ?? '#D6A87C'
  const tagColor = tagColorProp ?? theme.palette[1] ?? '#82B8C9'
  const panelColor = panelColorProp ?? theme.surface
  const borderColor = borderColorProp ?? theme.border

  const colorFor: Record<TokenType, string> = {
    text: textColor,
    keyword: keywordColor,
    string: stringColor,
    comment: commentColor,
    number: numberColor,
    tag: tagColor,
  }

  const lines = code.split('\n')

  // One staggered rise per line (matches ondajs's
  // useStaggeredEntrance({ type: 'rise', ... })). When revealLines is off, all
  // lines show at once.
  const lineStyleAt = useStaggeredEntrance({
    type: 'rise',
    delay,
    increment: lineDelay,
    distance: 6,
  })

  // Vertical rhythm: a generous line-height for a video canvas (ondajs uses 1.6).
  const lineHeight = Math.round(fontSize * 1.6)
  // Inner padding around the code (ondajs: 28px vertical / 36px horizontal at a
  // 48px font — scaled to roughly track the font size).
  const padX = Math.round(fontSize * 0.75)
  const padY = Math.round(fontSize * 0.58)

  // Chrome bar geometry (only contributes height when shown).
  const dotSize = Math.round(fontSize * 0.38)
  const chromeHeight = chrome ? Math.round(fontSize * 1.5) : 0
  const titleSize = Math.round(fontSize * 0.6)

  // Panel size: width is fixed by the prop; height is derived from the line
  // count so the panel always wraps the code (no measurement / reflow risk).
  const codeHeight = lines.length > 0 ? lineHeight * lines.length : lineHeight
  const panelHeight = chromeHeight + padY * 2 + codeHeight

  // Center the fixed-size panel by computing its top-left offset directly.
  const originX = Math.round((compWidth - width) / 2)
  const originY = Math.round((compHeight - panelHeight) / 2)

  const cornerRadius = theme.radius ?? Math.round(fontSize * 0.4)

  return (
    <Group x={originX} y={originY}>
      {/* The "glass" panel — flat dark fill + faint border (see approximations). */}
      <Rect
        x={0}
        y={0}
        width={width}
        height={panelHeight}
        cornerRadius={cornerRadius}
        fill={panelColor}
        stroke={borderColor}
        strokeWidth={1}
      />

      {/* macOS-style window chrome: three dots + an optional filename. */}
      {chrome ? (
        <Group x={padX} y={0}>
          {[0, 1, 2].map((i) => (
            <Ellipse
              key={i}
              x={i * Math.round(dotSize * 1.55)}
              y={Math.round((chromeHeight - dotSize) / 2)}
              width={dotSize}
              height={dotSize}
              fill={borderColor}
            />
          ))}
          {title ? (
            <Text
              x={Math.round(dotSize * 1.55 * 3) + Math.round(fontSize * 0.5)}
              y={Math.round((chromeHeight - titleSize) / 2)}
              fontSize={titleSize}
              color={commentColor}
              fontFamily={fontFamily}
            >
              {title}
            </Text>
          ) : null}
          {/* Divider beneath the chrome bar. */}
          <Rect
            x={Math.round(-padX)}
            y={chromeHeight}
            width={width}
            height={1}
            fill={borderColor}
          />
        </Group>
      ) : null}

      {/* Code content. Each line is positioned by explicit y; the per-line
          rise+fade rides on a nested inner Group so the translate never sits on
          a layout child (HARD RULE 2). */}
      <Group x={padX} y={chromeHeight + padY}>
        {lines.map((line, i) => {
          const motion = revealLines ? lineStyleAt(i) : null
          const opacity = motion ? motion.opacity : 1
          const motionY = motion ? motion.y : 0

          const tokens = tokenizeLine(line)
          // Per-token styled runs (GPU path). A blank line still needs a Text so
          // its slot is reserved visually; render a single space run for it.
          const runs: TextRunInput[] =
            tokens.length > 0
              ? tokens.map((tok) => ({
                  text: tok.text,
                  color: colorFor[tok.type],
                  fontSize,
                  fontFamily,
                }))
              : [{ text: ' ', color: textColor, fontSize, fontFamily }]

          // Concatenated text is the CPU-backend fallback (single color).
          const flat = tokens.length > 0 ? line : ' '

          const lineY = i * lineHeight

          return (
            <Group key={i} y={lineY} opacity={opacity}>
              <Group y={motionY}>
                <Text
                  x={0}
                  y={0}
                  fontSize={fontSize}
                  color={textColor}
                  fontFamily={fontFamily}
                  letterSpacing={letterSpacing}
                  runs={runs}
                >
                  {flat}
                </Text>
              </Group>
            </Group>
          )
        })}
      </Group>
    </Group>
  )
}
