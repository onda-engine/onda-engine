//! Keyframes — the engine's general declarative-keyframe primitive. Animate ANY
//! element along explicit per-channel tracks (position / opacity / scale /
//! rotation), each keyframe carrying its own easing (a named curve OR a raw
//! cubic-bezier [x1,y1,x2,y2] — so a Lottie/AE curve transcribes 1:1). This is what
//! lets a composition express ARBITRARY motion, not just the fixed entrance presets:
//! "this element is at A at frame 0, B at frame 18 on THIS ease, C at frame 54…".
//!
//! It renders ONE content element (an image tile or a text line) so it slots into
//! the flat composition-entry model; the content (src / text / color) stays an
//! editable prop while the motion lives in the tracks (motion is never themed).

import {
  Ellipse,
  type GradientInput,
  Group,
  Image,
  Path,
  Rect,
  Text,
  clipRect,
  useCurrentFrame,
} from '@onda-engine/react'
import { LINE_RATIO, layoutGlyphLine, lineStartX } from '../glyph-line.js'
import { type PosKey, type ValKey, sampleKeyframes } from '../keyframes-sampler.js'
import { type Theme, useTheme } from '../theme.js'

// The track types + sampler now live in ../keyframes-sampler.js — ONE
// implementation shared with the cinema export + the Studio preview. Re-exported
// here so existing `import { PosKey } from './components/Keyframes'` keeps working.
export type { Ease, PosKey, ValKey } from '../keyframes-sampler.js'

// ── Slot binding ──────────────────────────────────────────────────────────────
// A fill can be SLOT-BOUND: an override handle (`slot`) carrying the original literal
// (`default`, rendered when unset → byte-identical) and an optional `value` override
// (wins). The renderer only needs `value ?? default`; `slot` is the id the studio/agent
// targets, and multiple fills may share one. For a color T is a string — a brand token
// OR a literal hex; the renderer never constrains a slot value to brand tokens.
export interface SlotRef<T> {
  slot: string
  default: T
  value?: T
}
export type Slottable<T> = T | SlotRef<T>
function isSlotRef<T>(v: Slottable<T> | undefined): v is SlotRef<T> {
  return typeof v === 'object' && v !== null && 'slot' in v && 'default' in v
}
/** The effective value of a slottable field: the override (`value`) if set, else `default`.
 *  Overloaded so a REQUIRED field (e.g. `width`) resolves to `T`, an optional one to `T | undefined`. */
export function slotValue<T>(v: Slottable<T>): T
export function slotValue<T>(v: Slottable<T> | undefined): T | undefined
export function slotValue<T>(v: Slottable<T> | undefined): T | undefined {
  if (v === undefined) return undefined
  return isSlotRef(v) ? (v.value ?? v.default) : v
}

export interface KeyframesImageContent {
  kind: 'image'
  /** Image source — a literal URL or a `{slot}` to swap. Omit for a `gradient`/`color` placeholder. */
  src?: Slottable<string>
  /** Gradient fill (linear/radial/fbm or a `{slot}`) used when `src` is absent — wins over `color`. */
  gradient?: Slottable<GradientInput>
  /** Solid fill — a hex, a brand-token name, or a `{slot}`; used when neither `src` nor `gradient` is set. Defaults to the theme surface. */
  color?: Slottable<string>
  /** Outline color (hex/token/`{slot}`) — for a stroked/outline rect. */
  stroke?: Slottable<string>
  /** Outline thickness (px) — a literal or a `{slot}`. */
  strokeWidth?: Slottable<number>
  /** Width (px) — a literal or a `{slot}` (resize). */
  width: Slottable<number>
  /** Height (px) — a literal or a `{slot}` (resize). */
  height: Slottable<number>
  /** Corner rounding (px) — a literal or a `{slot}`. */
  cornerRadius?: Slottable<number>
  /** Pivot in content space (defaults to the tile CENTER). */
  anchorX?: number
  anchorY?: number
}
/** An ellipse/ring leaf — fill via `color`/`gradient`, or `stroke` only for a ring. */
export interface KeyframesEllipseContent {
  kind: 'ellipse'
  width: Slottable<number>
  height: Slottable<number>
  color?: Slottable<string>
  gradient?: Slottable<GradientInput>
  stroke?: Slottable<string>
  strokeWidth?: Slottable<number>
  anchorX?: number
  anchorY?: number
}
/** An arbitrary vector path leaf (SVG `d`, local space). Native/GPU render. */
export interface KeyframesPathContent {
  kind: 'path'
  d: string
  color?: Slottable<string>
  gradient?: Slottable<GradientInput>
  stroke?: Slottable<string>
  strokeWidth?: Slottable<number>
  anchorX?: number
  anchorY?: number
}
export interface KeyframesTextContent {
  kind: 'text'
  text: Slottable<string>
  /** Text size (px) — a literal or a `{slot}` (resize). */
  fontSize: Slottable<number>
  color?: Slottable<string>
  /** Typeface — a literal family name or a `{slot}` (the brand `font`). */
  fontFamily?: Slottable<string>
  /** Weight — a literal or a `{slot}`. */
  fontWeight?: Slottable<number>
  letterSpacing?: number
  /** Horizontal alignment of the text about its `position` x. `'left'` (default,
   *  and the legacy behaviour) anchors the LEFT edge at the position; `'center'`
   *  measures the rendered text and centres it on the position; `'right'` ends at
   *  it. When set, it OVERRIDES `anchorX` (the engine computes the pivot). This is
   *  what lets the agent "centre this text" on a raw-positioned Keyframes element. */
  align?: 'left' | 'center' | 'right'
  /** Vertical alignment of the text about its `position` y. `'top'` (default, the
   *  legacy behaviour) anchors the TOP of the line box at the position; `'middle'`
   *  centres it vertically; `'bottom'` anchors the bottom edge. When set, it
   *  OVERRIDES `anchorY`. Combine with `align` for the full 9-point grid — e.g.
   *  `align:'right' + vAlign:'top'` = top-right corner, `align:'center' +
   *  vAlign:'middle'` = dead-centre on the position. */
  vAlign?: 'top' | 'middle' | 'bottom'
  /** Pivot in content space (defaults to top-left 0,0). `anchorX` ignored when
   *  `align` is set; `anchorY` ignored when `vAlign` is set. */
  anchorX?: number
  anchorY?: number
}

export type KeyframesContent =
  | KeyframesImageContent
  | KeyframesTextContent
  | KeyframesEllipseContent
  | KeyframesPathContent

/** A keyframe on the path-`d` MORPH track: the `content.kind:"path"` `d` at frame `at`. */
export interface DMorphKey {
  at: number
  d: string
}

export interface KeyframesProps {
  position?: PosKey[]
  opacity?: ValKey[]
  scale?: ValKey[]
  /** Non-uniform horizontal scale — wins over `scale` (e.g. a bar growing wide). */
  scaleX?: ValKey[]
  /** Non-uniform vertical scale — wins over `scale`. */
  scaleY?: ValKey[]
  rotation?: ValKey[]
  /** Path-`d` MORPH track — interpolates a `content.kind:"path"` element's `d` across
   *  keyframes so the SHAPE itself transforms (a wave reforming, a logo morphing). The
   *  forms must share segment structure (same command sequence) → numeric lerp with
   *  ease-in-out, exactly like CSS `d:path()`. Ignored for non-path content. */
  morph?: DMorphKey[]
  content: KeyframesContent
}

// ── Path-`d` morph: interpolate two same-structure SVG `d` strings number-by-number
// (keep command letters, lerp the coordinates). Mismatched structure → step (no crash).
const PATH_TOKENS = /[a-zA-Z]|-?\d*\.?\d+/g
function lerpPathD(a: string, b: string, t: number): string {
  const ta = a.match(PATH_TOKENS)
  const tb = b.match(PATH_TOKENS)
  if (!ta || !tb || ta.length !== tb.length) return t < 0.5 ? a : b
  return ta
    .map((tok, i) =>
      /[a-zA-Z]/.test(tok) ? tok : (Number(tok) + (Number(tb[i]) - Number(tok)) * t).toFixed(3),
    )
    .join(' ')
}
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}
function sampleMorph(keys: DMorphKey[], frame: number): string {
  const first = keys[0]
  if (!first) return ''
  const last = keys[keys.length - 1]
  if (keys.length === 1 || !last || frame <= first.at) return first.d
  if (frame >= last.at) return last.d
  let i = 0
  while (i < keys.length - 1) {
    const next = keys[i + 1]
    if (!next || next.at > frame) break
    i++
  }
  const a = keys[i]
  const b = keys[i + 1]
  if (!a || !b) return first.d
  return lerpPathD(a.d, b.d, easeInOut((frame - a.at) / (b.at - a.at)))
}

// Brand-token names a color/stroke can reference instead of a literal hex — they
// resolve through the active theme, so a fill bound to "accent" recolors when the
// brand changes (the cascade the editor's brand-binding relies on).
const THEME_TOKENS = [
  'accent',
  'accentSoft',
  'text',
  'textMuted',
  'background',
  'surface',
  'border',
] as const
export function resolveColor(c: Slottable<string> | undefined, theme: Theme): string | undefined {
  const s = slotValue(c)
  if (!s) return s
  return (THEME_TOKENS as readonly string[]).includes(s)
    ? (theme as unknown as Record<string, string>)[s]
    : s
}

/** Build paint props (fill/gradient/stroke) for a shape leaf. `stroke`-only (no
 *  color/gradient) yields a ring; `fallbackFill` applies only when nothing else is set.
 *  `color`/`stroke` may be a brand-token name (resolved via the theme). */
function paint(
  c: {
    color?: Slottable<string>
    gradient?: Slottable<GradientInput>
    stroke?: Slottable<string>
    strokeWidth?: Slottable<number>
  },
  theme: Theme,
  fallbackFill?: string,
): Record<string, unknown> {
  const p: Record<string, unknown> = {}
  const color = resolveColor(c.color, theme)
  const stroke = resolveColor(c.stroke, theme)
  const gradient = slotValue(c.gradient)
  if (gradient) p.gradient = gradient
  else if (color) p.fill = color
  else if (fallbackFill && !stroke) p.fill = fallbackFill
  if (stroke) {
    p.stroke = stroke
    p.strokeWidth = slotValue(c.strokeWidth) ?? 2
  }
  return p
}

export function Keyframes({
  position,
  opacity,
  scale,
  scaleX,
  scaleY,
  rotation,
  morph,
  content,
}: KeyframesProps) {
  const frame = useCurrentFrame()
  const theme = useTheme()
  const {
    x,
    y,
    opacity: op,
    scaleX: scX,
    scaleY: scY,
    rotation: rot,
  } = sampleKeyframes({ position, opacity, scale, scaleX, scaleY, rotation }, frame)
  if (op <= 0.002) return null

  let inner: React.ReactNode
  if (content.kind === 'image') {
    const width = slotValue(content.width)
    const height = slotValue(content.height)
    const cornerRadius = slotValue(content.cornerRadius) ?? 0
    const ax = content.anchorX ?? width / 2
    const ay = content.anchorY ?? height / 2
    const src = slotValue(content.src)
    inner = src ? (
      <Group x={-ax} y={-ay} clip={clipRect(width, height, cornerRadius)}>
        <Image src={src} width={width} height={height} fit="cover" />
      </Group>
    ) : (
      // No image yet → a gradient/solid/outline placeholder card to swap an image into.
      <Group x={-ax} y={-ay}>
        <Rect
          width={width}
          height={height}
          cornerRadius={cornerRadius}
          {...paint(content, theme, theme.surface)}
        />
      </Group>
    )
  } else if (content.kind === 'ellipse') {
    const width = slotValue(content.width)
    const height = slotValue(content.height)
    const ax = content.anchorX ?? width / 2
    const ay = content.anchorY ?? height / 2
    inner = (
      <Group x={-ax} y={-ay}>
        <Ellipse width={width} height={height} {...paint(content, theme, theme.surface)} />
      </Group>
    )
  } else if (content.kind === 'path') {
    const pathD = morph && morph.length > 0 ? sampleMorph(morph, frame) : content.d
    inner = (
      <Group x={-(content.anchorX ?? 0)} y={-(content.anchorY ?? 0)}>
        <Path d={pathD} {...paint(content, theme, theme.surface)} />
      </Group>
    )
  } else {
    const fontFamily = slotValue(content.fontFamily) ?? theme.headingFamily ?? theme.fontFamily
    const fontWeight = slotValue(content.fontWeight) ?? 400
    const fontSize = slotValue(content.fontSize)
    const text = slotValue(content.text) ?? ''
    // Horizontal: `align` measures the rendered line and anchors left/centre/right
    // edge on the position (overriding anchorX); unset → legacy anchorX pivot.
    let textX = -(content.anchorX ?? 0)
    if (content.align) {
      const { width } = layoutGlyphLine(text, fontSize, {
        fontFamily,
        fontWeight,
        letterSpacing: content.letterSpacing,
      })
      textX = lineStartX(content.align, 0, width)
    }
    // Vertical: the Text node's y is the TOP of the line box (height = fontSize ×
    // LINE_RATIO), so anchoring mirrors the horizontal formula; unset → anchorY.
    let textY = -(content.anchorY ?? 0)
    if (content.vAlign) {
      const h = fontSize * LINE_RATIO
      textY = content.vAlign === 'middle' ? -h / 2 : content.vAlign === 'bottom' ? -h : 0
    }
    inner = (
      <Text
        x={textX}
        y={textY}
        fontSize={fontSize}
        color={resolveColor(content.color, theme) ?? theme.text}
        fontFamily={fontFamily}
        fontWeight={fontWeight}
        letterSpacing={content.letterSpacing}
      >
        {text}
      </Text>
    )
  }

  return (
    <Group x={x} y={y} opacity={op}>
      <Group scaleX={scX} scaleY={scY} rotation={rot}>
        {inner}
      </Group>
    </Group>
  )
}
