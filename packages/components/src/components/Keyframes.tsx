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
} from '@onda/react'
import { type PosKey, type ValKey, sampleKeyframes } from '../keyframes-sampler.js'
import { type Theme, useTheme } from '../theme.js'

// The track types + sampler now live in ../keyframes-sampler.js — ONE
// implementation shared with the cinema export + the Studio preview. Re-exported
// here so existing `import { PosKey } from './components/Keyframes'` keeps working.
export type { Ease, PosKey, ValKey } from '../keyframes-sampler.js'

export interface KeyframesImageContent {
  kind: 'image'
  /** Image source. Omit for a `gradient`/`color` placeholder to swap for an image. */
  src?: string
  /** Gradient fill (linear/radial/fbm) used when `src` is absent — wins over `color`. */
  gradient?: GradientInput
  /** Solid fill (hex) used when neither `src` nor `gradient` is set. Defaults to the theme surface. */
  color?: string
  /** Outline color (hex) — for a stroked/outline rect. */
  stroke?: string
  strokeWidth?: number
  width: number
  height: number
  cornerRadius?: number
  /** Pivot in content space (defaults to the tile CENTER). */
  anchorX?: number
  anchorY?: number
}
/** An ellipse/ring leaf — fill via `color`/`gradient`, or `stroke` only for a ring. */
export interface KeyframesEllipseContent {
  kind: 'ellipse'
  width: number
  height: number
  color?: string
  gradient?: GradientInput
  stroke?: string
  strokeWidth?: number
  anchorX?: number
  anchorY?: number
}
/** An arbitrary vector path leaf (SVG `d`, local space). Native/GPU render. */
export interface KeyframesPathContent {
  kind: 'path'
  d: string
  color?: string
  gradient?: GradientInput
  stroke?: string
  strokeWidth?: number
  anchorX?: number
  anchorY?: number
}
export interface KeyframesTextContent {
  kind: 'text'
  text: string
  fontSize: number
  color?: string
  fontFamily?: string
  fontWeight?: number
  letterSpacing?: number
  /** Pivot in content space (defaults to top-left 0,0). */
  anchorX?: number
  anchorY?: number
}

export type KeyframesContent =
  | KeyframesImageContent
  | KeyframesTextContent
  | KeyframesEllipseContent
  | KeyframesPathContent

export interface KeyframesProps {
  position?: PosKey[]
  opacity?: ValKey[]
  scale?: ValKey[]
  /** Non-uniform horizontal scale — wins over `scale` (e.g. a bar growing wide). */
  scaleX?: ValKey[]
  /** Non-uniform vertical scale — wins over `scale`. */
  scaleY?: ValKey[]
  rotation?: ValKey[]
  content: KeyframesContent
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
export function resolveColor(c: string | undefined, theme: Theme): string | undefined {
  if (!c) return c
  return (THEME_TOKENS as readonly string[]).includes(c)
    ? (theme as unknown as Record<string, string>)[c]
    : c
}

/** Build paint props (fill/gradient/stroke) for a shape leaf. `stroke`-only (no
 *  color/gradient) yields a ring; `fallbackFill` applies only when nothing else is set.
 *  `color`/`stroke` may be a brand-token name (resolved via the theme). */
function paint(
  c: { color?: string; gradient?: GradientInput; stroke?: string; strokeWidth?: number },
  theme: Theme,
  fallbackFill?: string,
): Record<string, unknown> {
  const p: Record<string, unknown> = {}
  const color = resolveColor(c.color, theme)
  const stroke = resolveColor(c.stroke, theme)
  if (c.gradient) p.gradient = c.gradient
  else if (color) p.fill = color
  else if (fallbackFill && !stroke) p.fill = fallbackFill
  if (stroke) {
    p.stroke = stroke
    p.strokeWidth = c.strokeWidth ?? 2
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
    const ax = content.anchorX ?? content.width / 2
    const ay = content.anchorY ?? content.height / 2
    inner = content.src ? (
      <Group
        x={-ax}
        y={-ay}
        clip={clipRect(content.width, content.height, content.cornerRadius ?? 0)}
      >
        <Image src={content.src} width={content.width} height={content.height} fit="cover" />
      </Group>
    ) : (
      // No image yet → a gradient/solid/outline placeholder card to swap an image into.
      <Group x={-ax} y={-ay}>
        <Rect
          width={content.width}
          height={content.height}
          cornerRadius={content.cornerRadius ?? 0}
          {...paint(content, theme, theme.surface)}
        />
      </Group>
    )
  } else if (content.kind === 'ellipse') {
    const ax = content.anchorX ?? content.width / 2
    const ay = content.anchorY ?? content.height / 2
    inner = (
      <Group x={-ax} y={-ay}>
        <Ellipse
          width={content.width}
          height={content.height}
          {...paint(content, theme, theme.surface)}
        />
      </Group>
    )
  } else if (content.kind === 'path') {
    inner = (
      <Group x={-(content.anchorX ?? 0)} y={-(content.anchorY ?? 0)}>
        <Path d={content.d} {...paint(content, theme, theme.surface)} />
      </Group>
    )
  } else {
    inner = (
      <Text
        x={-(content.anchorX ?? 0)}
        y={-(content.anchorY ?? 0)}
        fontSize={content.fontSize}
        color={resolveColor(content.color, theme) ?? theme.text}
        fontFamily={content.fontFamily ?? theme.headingFamily ?? theme.fontFamily}
        fontWeight={content.fontWeight ?? 400}
        letterSpacing={content.letterSpacing}
      >
        {content.text}
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
