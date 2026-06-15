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

import { Group, Image, Text, clipRect, useCurrentFrame } from '@onda/react'
import { useTheme } from '../theme.js'

export type Ease = 'linear' | 'ease' | 'easeIn' | 'easeOut' | 'easeInOut' | [number, number, number, number]

/** One position keyframe. `ease` is the curve of the segment ENDING at this key. */
export interface PosKey {
  at: number
  x: number
  y: number
  ease?: Ease
}
/** One scalar keyframe (opacity 0–1, scale, rotation°). */
export interface ValKey {
  at: number
  v: number
  ease?: Ease
}

export interface KeyframesImageContent {
  kind: 'image'
  src: string
  width: number
  height: number
  cornerRadius?: number
  /** Pivot in content space (defaults to the tile CENTER). */
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

export interface KeyframesProps {
  position?: PosKey[]
  opacity?: ValKey[]
  scale?: ValKey[]
  rotation?: ValKey[]
  content: KeyframesImageContent | KeyframesTextContent
}

const NAMED: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
}

/** Standard CSS cubic-bezier easing — solve y for x=t via Newton–Raphson. */
function makeBezier([x1, y1, x2, y2]: [number, number, number, number]): (t: number) => number {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t
  const dX = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  const solveX = (x: number) => {
    let t = x
    for (let i = 0; i < 8; i++) {
      const dx = sampleX(t) - x
      const d = dX(t)
      if (Math.abs(dx) < 1e-5 || d === 0) break
      t -= dx / d
    }
    return t
  }
  return (x: number) => sampleY(solveX(x < 0 ? 0 : x > 1 ? 1 : x))
}

const FN_CACHE = new Map<string, (t: number) => number>()
function easeFn(e?: Ease): (t: number) => number {
  const p: [number, number, number, number] =
    (Array.isArray(e) ? e : NAMED[e ?? 'linear']) ?? [0, 0, 1, 1]
  const key = p.join(',')
  let f = FN_CACHE.get(key)
  if (!f) {
    f = makeBezier(p)
    FN_CACHE.set(key, f)
  }
  return f
}

function sample<T extends { at: number; ease?: Ease }>(
  track: T[] | undefined,
  frame: number,
  get: (k: T) => number,
  dflt: number,
): number {
  if (!track || track.length === 0) return dflt
  const first = track[0] as T
  const last = track[track.length - 1] as T
  if (frame <= first.at) return get(first)
  if (frame >= last.at) return get(last)
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i] as T
    const b = track[i + 1] as T
    if (frame >= a.at && frame < b.at) {
      const t = (frame - a.at) / (b.at - a.at)
      const e = easeFn(b.ease)(t)
      return get(a) + (get(b) - get(a)) * e
    }
  }
  return get(last)
}

export function Keyframes({ position, opacity, scale, rotation, content }: KeyframesProps) {
  const frame = useCurrentFrame()
  const theme = useTheme()
  const x = sample(position, frame, (k) => k.x, 0)
  const y = sample(position, frame, (k) => k.y, 0)
  const op = sample(opacity, frame, (k) => k.v, 1)
  const sc = sample(scale, frame, (k) => k.v, 1)
  const rot = sample(rotation, frame, (k) => k.v, 0)
  if (op <= 0.002) return null

  let inner: React.ReactNode
  if (content.kind === 'image') {
    const ax = content.anchorX ?? content.width / 2
    const ay = content.anchorY ?? content.height / 2
    inner = (
      <Group x={-ax} y={-ay} clip={clipRect(content.width, content.height, content.cornerRadius ?? 0)}>
        <Image src={content.src} width={content.width} height={content.height} fit="cover" />
      </Group>
    )
  } else {
    inner = (
      <Text
        x={-(content.anchorX ?? 0)}
        y={-(content.anchorY ?? 0)}
        fontSize={content.fontSize}
        color={content.color ?? theme.text}
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
      <Group scaleX={sc} scaleY={sc} rotation={rot}>
        {inner}
      </Group>
    </Group>
  )
}
