//! Estimate the arc length of an SVG path `d` string, in its own coordinate
//! space. This is just enough to drive a stroke-dash draw-on: the dash period
//! must match the path length so the "pen" reaches the end exactly as the reveal
//! progress hits 1 (a `[len, len]` dash with offset `len·(1−p)` uncovers the
//! path from 0 to `len` as `p` goes 0→1 — see LogoSting / BoundingBox).
//!
//! Curves are flattened to short chords and summed — an approximation (good to
//! ~1% for typical marks), NOT an exact perimeter. The renderer (kurbo) strokes
//! the true geometry; this only times the reveal. Unsupported elliptical arcs
//! (`A`) fall back to a straight chord to the segment endpoint.

/** Curve flattening resolution (chords per cubic/quadratic segment). */
const STEPS = 24

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Point on a quadratic Bézier at parameter `t`. */
function quadAt(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: number,
): [number, number] {
  const ax = lerp(x0, x1, t)
  const ay = lerp(y0, y1, t)
  const bx = lerp(x1, x2, t)
  const by = lerp(y1, y2, t)
  return [lerp(ax, bx, t), lerp(ay, by, t)]
}

/** Point on a cubic Bézier at parameter `t`. */
function cubicAt(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  t: number,
): [number, number] {
  const [ax, ay] = quadAt(x0, y0, x1, y1, x2, y2, t)
  const [bx, by] = quadAt(x1, y1, x2, y2, x3, y3, t)
  return [lerp(ax, bx, t), lerp(ay, by, t)]
}

/** Tokenize a path `d` into command letters and numbers (handles exponents,
 *  signed/decimal coords, and comma/space separators). */
function tokenize(d: string): string[] {
  return d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []
}

/**
 * Estimate the total arc length of an SVG path, summing flattened segments.
 * Supports M/L/H/V/C/S/Q/T/Z (absolute + relative); `A` is approximated by its
 * chord. Returns `0` for an empty/degenerate path.
 */
export function estimatePathLength(d: string): number {
  const t = tokenize(d)
  let i = 0
  const num = (): number => Number.parseFloat(t[i++] ?? '0') || 0
  const isCmd = (s: string | undefined): boolean =>
    s !== undefined && /^[MmLlHhVvCcSsQqTtAaZz]$/.test(s)

  let total = 0
  // current point, subpath start, previous control point, previous command.
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  let pcx = 0
  let pcy = 0
  let prev = ''

  const line = (nx: number, ny: number): void => {
    total += Math.hypot(nx - cx, ny - cy)
    cx = nx
    cy = ny
  }
  const flattenQuad = (x1: number, y1: number, x2: number, y2: number): void => {
    let px = cx
    let py = cy
    for (let s = 1; s <= STEPS; s++) {
      const [qx, qy] = quadAt(cx, cy, x1, y1, x2, y2, s / STEPS)
      total += Math.hypot(qx - px, qy - py)
      px = qx
      py = qy
    }
    cx = px
    cy = py
  }
  const flattenCubic = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
  ): void => {
    let px = cx
    let py = cy
    for (let s = 1; s <= STEPS; s++) {
      const [qx, qy] = cubicAt(cx, cy, x1, y1, x2, y2, x3, y3, s / STEPS)
      total += Math.hypot(qx - px, qy - py)
      px = qx
      py = qy
    }
    cx = px
    cy = py
  }

  while (i < t.length) {
    const tok = t[i]
    let cmd: string
    if (isCmd(tok)) {
      cmd = tok as string
      i++
    } else {
      // Implicit repeat of the previous command (e.g. polyline after one `L`);
      // an implicit `M` repeat becomes `L` per the SVG spec.
      cmd = prev === 'M' ? 'L' : prev === 'm' ? 'l' : prev
    }
    if (cmd === '') return total // no command context yet — bail safely
    const rel = cmd === cmd.toLowerCase()
    const ox = rel ? cx : 0
    const oy = rel ? cy : 0

    switch (cmd.toUpperCase()) {
      case 'M': {
        cx = ox + num()
        cy = oy + num()
        sx = cx
        sy = cy
        break
      }
      case 'L': {
        line(ox + num(), oy + num())
        break
      }
      case 'H': {
        line(ox + num(), cy)
        break
      }
      case 'V': {
        line(cx, oy + num())
        break
      }
      case 'C': {
        const x1 = ox + num()
        const y1 = oy + num()
        const x2 = ox + num()
        const y2 = oy + num()
        const x = ox + num()
        const y = oy + num()
        flattenCubic(x1, y1, x2, y2, x, y)
        pcx = x2
        pcy = y2
        break
      }
      case 'S': {
        // Smooth cubic: first control is the reflection of the previous one.
        const smooth = prev.toUpperCase() === 'C' || prev.toUpperCase() === 'S'
        const x1 = smooth ? 2 * cx - pcx : cx
        const y1 = smooth ? 2 * cy - pcy : cy
        const x2 = ox + num()
        const y2 = oy + num()
        const x = ox + num()
        const y = oy + num()
        flattenCubic(x1, y1, x2, y2, x, y)
        pcx = x2
        pcy = y2
        break
      }
      case 'Q': {
        const x1 = ox + num()
        const y1 = oy + num()
        const x = ox + num()
        const y = oy + num()
        flattenQuad(x1, y1, x, y)
        pcx = x1
        pcy = y1
        break
      }
      case 'T': {
        // Smooth quad: control is the reflection of the previous one.
        const smooth = prev.toUpperCase() === 'Q' || prev.toUpperCase() === 'T'
        const x1 = smooth ? 2 * cx - pcx : cx
        const y1 = smooth ? 2 * cy - pcy : cy
        const x = ox + num()
        const y = oy + num()
        flattenQuad(x1, y1, x, y)
        pcx = x1
        pcy = y1
        break
      }
      case 'A': {
        // Elliptical arc — approximate by its chord (rare in logo marks). Skip
        // the rx/ry/rotation/flags, take the endpoint.
        num() // rx
        num() // ry
        num() // x-axis-rotation
        num() // large-arc-flag
        num() // sweep-flag
        line(ox + num(), oy + num())
        break
      }
      case 'Z': {
        total += Math.hypot(sx - cx, sy - cy)
        cx = sx
        cy = sy
        break
      }
      default:
        // Unknown token — bail to avoid an infinite loop.
        return total
    }
    prev = cmd
  }

  return total
}
