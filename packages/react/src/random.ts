//! Seeded, deterministic randomness for frame-driven motion.
//!
//! Compositions must render identically every time (same frame → same pixels),
//! so `Math.random()` is off-limits. These are pure functions of their inputs:
//! `random(seed)` for uniform values and `noise2D/3D` for smooth, organic motion
//! (jitter, drift, wobble). Same seed + coords always yield the same result.

/** Hash a seed (number or string) to a 32-bit unsigned integer. */
function hashSeed(seed: number | string): number {
  if (typeof seed === 'number') {
    // Mix the bits so nearby seeds (0, 1, 2…) diverge.
    let h = Math.imul(seed ^ (seed >>> 16), 2246822507) >>> 0
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0
    return (h ^ (h >>> 16)) >>> 0
  }
  let h = 2166136261 >>> 0
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** A deterministic value in `[0, 1)` for `seed` (mulberry32, one step). */
export function random(seed: number | string): number {
  let a = hashSeed(seed)
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Deterministic `[0, 1)` from a seed + integer coordinates (noise lattice). */
function hashUnit(s: number, ...coords: number[]): number {
  let h = (s ^ 0x9e3779b9) >>> 0
  for (const c of coords) {
    h ^= c | 0
    h = Math.imul(h, 16777619) >>> 0
    h ^= h >>> 13
  }
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
  return (h >>> 0) / 4294967296
}

/** Quintic smoothstep (Perlin's fade) — C2-continuous, so noise looks smooth. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Smooth 2D value noise in `[-1, 1]` — coherent (nearby inputs give nearby
 *  outputs), deterministic per `seed`. Scale `x`/`y` to set the frequency. */
export function noise2D(seed: number | string, x: number, y: number): number {
  const s = hashSeed(seed)
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const u = fade(fx)
  const v = fade(fy)
  const n = lerp(
    lerp(hashUnit(s, ix, iy), hashUnit(s, ix + 1, iy), u),
    lerp(hashUnit(s, ix, iy + 1), hashUnit(s, ix + 1, iy + 1), u),
    v,
  )
  return n * 2 - 1
}

/** Smooth 3D value noise in `[-1, 1]` (e.g. animate `z` over frames for drift). */
export function noise3D(seed: number | string, x: number, y: number, z: number): number {
  const s = hashSeed(seed)
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  const u = fade(x - ix)
  const v = fade(y - iy)
  const w = fade(z - iz)
  const c = (dx: number, dy: number, dz: number) => hashUnit(s, ix + dx, iy + dy, iz + dz)
  const front = lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v)
  const back = lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v)
  return lerp(front, back, w) * 2 - 1
}
