//! Keyframe sampling — the per-channel interpolation + cubic-bezier easing shared
//! by the `Keyframes` component (this package), the cinema EXPORT choreography
//! (@onda-engine/cinema), and the Studio live-preview renderer. ONE implementation, so
//! preview == export by construction (no twin to drift). Pure math, no React.

export type Ease =
  | 'linear'
  | 'ease'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | [number, number, number, number]

/** One position keyframe. `ease` is the TEMPORAL curve of the segment ENDING at this
 *  key (speed). `ti`/`to` are SPATIAL bezier tangents — handle offsets RELATIVE to
 *  this key's (x,y): `to` shapes the path LEAVING this key, `ti` the path ARRIVING.
 *  Both absent ⇒ a straight segment (legacy behaviour, unchanged). */
export interface PosKey {
  at: number
  x: number
  y: number
  ease?: Ease
  ti?: [number, number]
  to?: [number, number]
}
/** One scalar keyframe (opacity 0–1, scale, rotation°). */
export interface ValKey {
  at: number
  v: number
  ease?: Ease
}

export interface KeyframeTracks {
  position?: PosKey[]
  opacity?: ValKey[]
  scale?: ValKey[]
  /** Non-uniform horizontal scale — wins over `scale` when present. */
  scaleX?: ValKey[]
  /** Non-uniform vertical scale — wins over `scale` when present. */
  scaleY?: ValKey[]
  rotation?: ValKey[]
}

export interface SampledKeyframes {
  x: number
  y: number
  opacity: number
  scale: number
  scaleX: number
  scaleY: number
  rotation: number
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
      // Clamp t to [0,1] — Newton can overshoot past the curve for certain handles,
      // and sampleY() then EXTRAPOLATES the cubic to a wild value (a 1-frame spike).
      t = t < 0 ? 0 : t > 1 ? 1 : t
    }
    return t
  }
  return (x: number) => sampleY(solveX(x < 0 ? 0 : x > 1 ? 1 : x))
}

const FN_CACHE = new Map<string, (t: number) => number>()
function easeFn(e?: Ease): (t: number) => number {
  const p: [number, number, number, number] = (Array.isArray(e) ? e : NAMED[e ?? 'linear']) ?? [
    0, 0, 1, 1,
  ]
  const key = p.join(',')
  let f = FN_CACHE.get(key)
  if (!f) {
    f = makeBezier(p)
    FN_CACHE.set(key, f)
  }
  return f
}

/** Sample one channel of a track at `frame` — clamps to the end keys; between two
 *  keys, eases `t` by the LATER key's `ease` (the segment's curve). */
export function sampleTrack<T extends { at: number; ease?: Ease }>(
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

/** Sample the position track at `frame` as a 2-D point. Straight (independent x/y
 *  lerp) unless a segment carries a SPATIAL tangent (`a.to` or `b.ti`), in which case
 *  the path follows a cubic bezier P0=a, P1=a+a.to, P2=b+b.ti, P3=b — evaluated at the
 *  TEMPORALLY-eased parameter, so curve shape (tangents) and speed (ease) stay
 *  independent, exactly like After Effects / Jitter / Lottie. */
export function samplePosition(
  track: PosKey[] | undefined,
  frame: number,
): { x: number; y: number } {
  if (!track || track.length === 0) return { x: 0, y: 0 }
  const first = track[0] as PosKey
  const last = track[track.length - 1] as PosKey
  if (frame <= first.at) return { x: first.x, y: first.y }
  if (frame >= last.at) return { x: last.x, y: last.y }
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i] as PosKey
    const b = track[i + 1] as PosKey
    if (frame >= a.at && frame < b.at) {
      const e = easeFn(b.ease)((frame - a.at) / (b.at - a.at))
      if (a.to || b.ti) {
        const p1x = a.x + (a.to?.[0] ?? 0)
        const p1y = a.y + (a.to?.[1] ?? 0)
        const p2x = b.x + (b.ti?.[0] ?? 0)
        const p2y = b.y + (b.ti?.[1] ?? 0)
        const m = 1 - e
        const c0 = m * m * m
        const c1 = 3 * m * m * e
        const c2 = 3 * m * e * e
        const c3 = e * e * e
        return {
          x: c0 * a.x + c1 * p1x + c2 * p2x + c3 * b.x,
          y: c0 * a.y + c1 * p1y + c2 * p2y + c3 * b.y,
        }
      }
      return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }
    }
  }
  return { x: last.x, y: last.y }
}

/** Sample every channel at `frame`. Absent channels return their neutral default
 *  (position offset 0, opacity 1, scale 1, rotation 0). */
export function sampleKeyframes(tracks: KeyframeTracks, frame: number): SampledKeyframes {
  const pos = samplePosition(tracks.position, frame)
  const scale = sampleTrack(tracks.scale, frame, (k) => k.v, 1)
  return {
    x: pos.x,
    y: pos.y,
    opacity: sampleTrack(tracks.opacity, frame, (k) => k.v, 1),
    scale,
    // Non-uniform: a dedicated scaleX/scaleY track wins; else fall back to the
    // uniform `scale` (so existing uniform-scale tracks are unchanged).
    scaleX: tracks.scaleX ? sampleTrack(tracks.scaleX, frame, (k) => k.v, 1) : scale,
    scaleY: tracks.scaleY ? sampleTrack(tracks.scaleY, frame, (k) => k.v, 1) : scale,
    rotation: sampleTrack(tracks.rotation, frame, (k) => k.v, 0),
  }
}

/** True if `params` carries any keyframe track — lets a renderer/editor detect a
 *  `pattern:"keyframes"` animation. */
export function hasKeyframeTracks(params: Record<string, unknown> | undefined): boolean {
  if (!params) return false
  return (['position', 'opacity', 'scale', 'scaleX', 'scaleY', 'rotation'] as const).some((k) => {
    const v = params[k]
    return Array.isArray(v) && v.length > 0
  })
}
