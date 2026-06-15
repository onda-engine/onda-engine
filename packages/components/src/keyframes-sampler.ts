//! Keyframe sampling — the per-channel interpolation + cubic-bezier easing shared
//! by the `Keyframes` component (this package), the cinema EXPORT choreography
//! (@onda/cinema), and the Studio live-preview renderer. ONE implementation, so
//! preview == export by construction (no twin to drift). Pure math, no React.

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

export interface KeyframeTracks {
  position?: PosKey[]
  opacity?: ValKey[]
  scale?: ValKey[]
  rotation?: ValKey[]
}

export interface SampledKeyframes {
  x: number
  y: number
  opacity: number
  scale: number
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
  const p: [number, number, number, number] = (Array.isArray(e) ? e : NAMED[e ?? 'linear']) ?? [0, 0, 1, 1]
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

/** Sample every channel at `frame`. Absent channels return their neutral default
 *  (position offset 0, opacity 1, scale 1, rotation 0). */
export function sampleKeyframes(tracks: KeyframeTracks, frame: number): SampledKeyframes {
  return {
    x: sampleTrack(tracks.position, frame, (k) => k.x, 0),
    y: sampleTrack(tracks.position, frame, (k) => k.y, 0),
    opacity: sampleTrack(tracks.opacity, frame, (k) => k.v, 1),
    scale: sampleTrack(tracks.scale, frame, (k) => k.v, 1),
    rotation: sampleTrack(tracks.rotation, frame, (k) => k.v, 0),
  }
}

/** True if `params` carries any keyframe track — lets a renderer/editor detect a
 *  `pattern:"keyframes"` animation. */
export function hasKeyframeTracks(params: Record<string, unknown> | undefined): boolean {
  if (!params) return false
  return (['position', 'opacity', 'scale', 'rotation'] as const).some((k) => {
    const v = params[k]
    return Array.isArray(v) && v.length > 0
  })
}
