//! DrawOn — an SVG path that "draws on", the substrate for logos, icons, and
//! signature flourishes. Ported from ondajs.
//!
//! ondajs strokes the path in with `@remotion/paths`' `evolvePath`, which turns a
//! 0→1 spring progress into the `stroke-dasharray`/`stroke-dashoffset` pair that
//! reveals the line from its start to its end. `@onda-engine/react` has no stroke-dash
//! animation, so this is APPROXIMATED with a **clip wipe**: the fully-stroked
//! `<Path>` is masked by a `clipRect` whose width grows 0 → full across the path's
//! bounding box on the house spring (`SPRING_SMOOTH`, no overshoot — the same
//! spring and timing ondajs uses). The line therefore reveals left-to-right (the
//! natural read direction) rather than strictly following the path's arc-length
//! parameterization; for a left-to-right path (logos, signatures, the default
//! wave) the two are visually close. See `approximations`.
//!
//! Bounds: the engine exposes no author-time path metrics, so the clip rect is
//! sized from a lightweight parse of the `d` string's coordinates, padded by half
//! the stroke width so round caps/joins at the extremes are never clipped.
//!
//! Backend caveat: `<Path>` renders only on the Vello/GPU backend; the CPU
//! reference rasterizer skips paths, so there is nothing to reveal there.
//!
//! Pivot: scale/rotation on a node pivot on its local origin (0,0); this
//! component applies neither, so no centering caveat applies — the path renders in
//! its own coordinate space exactly as authored.

import { Group, Path, clipRect } from '@onda-engine/react'
import { useSpringValue } from '../hooks.js'
import { DURATION } from '../motion.js'
import { useTheme } from '../theme.js'
import type { TimeInput } from '../time.js'

export interface DrawOnProps {
  /** SVG path `d` attribute (in the path's own coordinate space). The default is
   *  a gentle wave — on-brand. */
  d?: string
  /** Stroke color (hex `#rrggbb` / `#rrggbbaa`) (default: theme `text`). */
  color?: string
  /** Stroke width in path coordinate units. */
  strokeWidth?: number
  /** Frames before the draw-on starts. */
  delay?: TimeInput
  /** Frames to fully draw the path in (default `DURATION.slow` = 24). */
  durationInFrames?: TimeInput
}

/** Parse the bounding box of an SVG path's `d` string from its coordinate pairs.
 *
 *  This is a lightweight estimator, not a full path engine: it handles the common
 *  absolute/relative move/line/curve commands (M/L/C/S/Q/T and their lowercase
 *  forms) by tracking the running pen position over consecutive number pairs, and
 *  the single-axis H/V commands. Arc (A/a) flag arguments would skew a strict
 *  pair-walk, so arcs fall back to treating their numbers as a loose point cloud —
 *  good enough to size a reveal wipe. Returns null when no numbers are found. */
function pathBounds(d: string): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi)
  if (!tokens || tokens.length === 0) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let penX = 0
  let penY = 0
  let cmd = ''
  let found = false

  const acc = (x: number, y: number) => {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    found = true
  }

  let i = 0
  while (i < tokens.length) {
    const tok = tokens[i] ?? ''
    if (/^[a-zA-Z]$/.test(tok)) {
      cmd = tok
      i += 1
      // Z/z close the subpath and carry no coordinates.
      if (cmd === 'Z' || cmd === 'z') {
        // nothing to consume
      }
      continue
    }

    const lower = cmd.toLowerCase()
    const rel = cmd === lower && cmd !== ''

    if (lower === 'h') {
      const n = Number.parseFloat(tok)
      if (Number.isFinite(n)) {
        penX = rel ? penX + n : n
        acc(penX, penY)
      }
      i += 1
      continue
    }
    if (lower === 'v') {
      const n = Number.parseFloat(tok)
      if (Number.isFinite(n)) {
        penY = rel ? penY + n : n
        acc(penX, penY)
      }
      i += 1
      continue
    }

    // Everything else is consumed as x,y pairs. For curve commands the control
    // points are also pairs, so accounting for all of them only ever widens the
    // box conservatively — exactly what we want for a non-clipping reveal.
    const xs = tokens[i] ?? ''
    const ys = tokens[i + 1] ?? ''
    const xn = Number.parseFloat(xs)
    const yn = Number.parseFloat(ys)
    if (Number.isFinite(xn) && Number.isFinite(yn)) {
      const px = rel ? penX + xn : xn
      const py = rel ? penY + yn : yn
      acc(px, py)
      penX = px
      penY = py
      i += 2
    } else {
      // Stray/unparseable token — skip it rather than stall.
      i += 1
    }
  }

  if (!found) {
    return null
  }
  return { minX, minY, maxX, maxY }
}

export function DrawOn({
  d = 'M 10 50 Q 100 10 190 50',
  color: colorProp,
  strokeWidth = 3,
  delay = 0,
  durationInFrames = DURATION.slow,
}: DrawOnProps) {
  // House spring (SPRING_SMOOTH, no overshoot) drives the reveal 0 → 1 — the same
  // spring/config/timing ondajs feeds to `evolvePath`. (useSpringValue reads
  // frame + fps internally.)
  const progress = useSpringValue({ delay, durationInFrames })
  const theme = useTheme()
  const color = colorProp ?? theme.text

  const bounds = pathBounds(d)

  // The stroke's round caps/joins extend half the stroke width beyond the path's
  // geometric bounds, so pad the wipe box by that much on every side; otherwise
  // the start/end caps would be sliced off at the edges of the clip.
  const pad = strokeWidth / 2 + 1

  // Without parseable bounds (degenerate `d`), still emit the stroked path — but
  // gate it on the spring so it stays invisible until the draw-on begins.
  if (!bounds) {
    if (progress <= 0) {
      return null
    }
    return <Path d={d} stroke={color} strokeWidth={strokeWidth} />
  }

  const boxX = bounds.minX - pad
  const boxY = bounds.minY - pad
  const boxWidth = bounds.maxX - bounds.minX + pad * 2
  const boxHeight = bounds.maxY - bounds.minY + pad * 2

  // The revealed slice of the box, left → right. Clamp ≥ 0 so a 0-progress frame
  // produces an empty (collapsed) clip rather than a negative one.
  const revealWidth = Math.max(0, boxWidth * progress)

  // Nothing revealed yet — render nothing (the line hasn't started drawing).
  if (revealWidth <= 0) {
    return null
  }

  // The clip is in the path's local space. We translate the clip Group's origin
  // to the box's top-left, clip to (revealWidth × boxHeight), then render the
  // path back at the negated offset so its coordinates are unchanged — the clip
  // window simply grows rightward across the stationary, fully-stroked path.
  return (
    <Group x={boxX} y={boxY} clip={clipRect(revealWidth, boxHeight)}>
      <Group x={-boxX} y={-boxY}>
        <Path d={d} stroke={color} strokeWidth={strokeWidth} />
      </Group>
    </Group>
  )
}
