//! PathMorph — the "magic move": one SVG shape continuously morphing into another.
//! CLOSED shapes (an emblem → a filled mark) are FILLED; OPEN paths (a line/curve
//! motif → another) are STROKED. This matters: an open path that is FILLED
//! auto-closes into a solid blob over your content (the #1 PathMorph misuse — a
//! "line motif" rendered as a white lens), so a line is NEVER filled. For a line
//! that simply DRAWS ON (no shape change) prefer `<DrawOn>`; reach for PathMorph
//! when the line/shape itself MORPHS.
//!
//! Closed shapes morph via `@onda/react`'s `morphPath` (flubber — point
//! CORRESPONDENCE so the fill never tears). Open paths use a per-number lerp so the
//! stroke stays OPEN (flubber re-closes its output into a ring). Feed two `d`
//! strings in the SAME coordinate space; it animates the in-between over
//! `durationInFrames` after `delay`, positioned/scaled by `x`/`y`/`scale`.
//!
//! Backend caveat: like `<Path>`, this renders on the Vello/GPU backend; the CPU
//! reference degrades (no path fills).
import { Group, Path, interpolate, morphPath, useCurrentFrame } from '@onda/react'
import { DURATION } from '../motion.js'
import { useTheme } from '../theme.js'

/** A path is CLOSED if it explicitly closes (`Z`/`z`); open paths are lines/curves. */
function isClosedPath(d: string): boolean {
  return /[zZ]/.test(d)
}

/** Lerp two structurally-identical path `d` strings number-by-number (same command
 *  letters in the same order) → a clean in-between that stays OPEN. Returns null
 *  when the structures differ (the caller then falls back to flubber). */
function lerpPathD(from: string, to: string, t: number): string | null {
  const tok = (d: string): string[] => d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []
  const a = tok(from)
  const b = tok(to)
  if (a.length === 0 || a.length !== b.length) return null
  const out: string[] = []
  for (let i = 0; i < a.length; i++) {
    const ca = a[i] as string
    const cb = b[i] as string
    const na = Number(ca)
    const nb = Number(cb)
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      if (ca !== cb) return null // command letters must line up
      out.push(ca)
    } else {
      out.push(String(na + (nb - na) * t))
    }
  }
  return out.join(' ')
}

export interface PathMorphProps {
  /** SVG path `d` to morph FROM (e.g. a logo emblem, or a line), in its own space. */
  from: string
  /** SVG path `d` to morph TO (e.g. a divider, or another line), in the SAME space. */
  to: string
  /** Ink color (hex). FILL for closed shapes, STROKE for open lines. Defaults theme `text`. */
  color?: string
  /** Force STROKE (line) rendering. Auto-true when BOTH paths are OPEN (no `Z`). */
  stroke?: boolean
  /** Stroke width in path-coordinate units (when stroked). Default 4. */
  strokeWidth?: number
  /** Frames before the `from` shape appears. */
  delay?: number
  /** Frames to HOLD the `from` shape (recognizable) before the morph begins. */
  holdFrames?: number
  /** Frames the morph itself takes (default `DURATION.slow` = 24). */
  durationInFrames?: number
  /** Composition position of the morph's local origin. */
  x?: number
  y?: number
  /** Uniform scale of the path's coordinate space. */
  scale?: number
  /** Fade the shape in over the first 8 frames (default true). */
  fadeIn?: boolean
}

export function PathMorph({
  from,
  to,
  color,
  stroke,
  strokeWidth = 4,
  delay = 0,
  durationInFrames,
  x = 0,
  y = 0,
  scale = 1,
  fadeIn = true,
}: PathMorphProps) {
  const frame = useCurrentFrame()
  const theme = useTheme()
  const dur = durationInFrames ?? DURATION.slow
  const t = interpolate(frame, [delay, delay + dur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  // A LINE motif (both paths open) STROKES; a SHAPE morph (closed) FILLS. Filling an
  // open path auto-closes it into a blob over the content — so we never do that.
  const asLine = stroke ?? (!isClosedPath(from) && !isClosedPath(to))
  // Open paths: a per-number lerp keeps the line OPEN (flubber would re-close its
  // output into a lens ring). Fall back to flubber when the structures differ.
  const d = asLine ? (lerpPathD(from, to, t) ?? morphPath(from, to, t)) : morphPath(from, to, t)
  const ink = color ?? theme.text
  const opacity = fadeIn
    ? interpolate(frame, [delay, delay + 8], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 1
  return (
    <Group x={x} y={y} opacity={opacity}>
      <Group scaleX={scale} scaleY={scale}>
        {asLine ? (
          <Path d={d} stroke={ink} strokeWidth={strokeWidth} strokeCap="round" />
        ) : (
          <Path d={d} fill={ink} />
        )}
      </Group>
    </Group>
  )
}
