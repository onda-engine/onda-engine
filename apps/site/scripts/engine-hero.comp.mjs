// engine-hero.comp.mjs — the full-bleed landing film. TEXTLESS by design: the
// page's HTML supplies the words; this film supplies the world behind them.
//
// Story (24s seamless loop @ 30fps = 720 frames):
//   calm      (0–4s)   the wave field breathing — the brand at idle
//   structure (4–10s)  nodes ignite along the crests; the scene graph rises
//   energy    (8–16s)  light pulses travel the graph's edges
//   burst     (12–19s) frames spark off the wave — throughput made visible
//   resolve   (19–24s) everything falls away; wave phase-aligns with frame 0
//
// Grading rules: rose on near-black indigo (the ENGINE's skin); the upper-left
// two-thirds stays calm and dark so the page headline floats over it; one
// continuous camera breath (push → return) ties the beats together.
//
// Render (iterate single frames first, then the full export):
//   node apps/site/scripts/render-comp.mjs --comp apps/site/scripts/engine-hero.comp.mjs \
//     --width 1920 --height 1080 --fps 30 --duration 720 --frame 200
//   node apps/site/scripts/render-comp.mjs --comp apps/site/scripts/engine-hero.comp.mjs \
//     --width 1920 --height 1080 --fps 30 --duration 720 --motion-blur 2 \
//     --out /tmp/hero-film-raw.mp4
//   # then compress for the web:
//   ffmpeg -i /tmp/hero-film-raw.mp4 -c:v libx264 -crf 24 -preset slow \
//     -pix_fmt yuv420p -movflags +faststart -an apps/site/public/hero-film.mp4

import {
  Camera,
  Composition,
  Ellipse,
  Group,
  Path,
  Rect,
  fbmGradient,
  radialGradient,
  useCurrentFrame,
  useVideoConfig,
} from '@onda-engine/react'
import { createElement as h } from 'react'

const TAU = Math.PI * 2

// Palette — engine rose over near-black indigo.
const ROSE_FRONT = '#e89aab'
const ROSE_BRIGHT = '#f6cdd7'
const WAVE_COLORS = ['#33202c', '#4a2737', '#613043', '#7d3c50', '#a44f63', ROSE_FRONT]

// --- timing helpers ---------------------------------------------------------
const clamp01 = (x) => Math.max(0, Math.min(1, x))
function ramp(f, a, b) {
  const t = clamp01((f - a) / (b - a))
  return t * t * (3 - 2 * t)
}
function pulse(f, inA, inB, outA, outB) {
  return Math.min(ramp(f, inA, inB), 1 - ramp(f, outA, outB))
}
// Deterministic per-index "random" (stable across frames — no Math.random).
const hash = (i) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

// --- the wave ----------------------------------------------------------------
// One shared formula so the graph can anchor nodes EXACTLY on the front wave.
// Phases advance an integer number of cycles over the loop → seamless.
function waveParams(layer, W, H, lp) {
  const depth = layer / (WAVE_COLORS.length - 1)
  const cycles = 2 + layer // integer cycles per loop, per layer
  return {
    depth,
    yBase: H * (0.64 + depth * 0.22),
    amp: 12 + depth * 30,
    k: (TAU / (W * 0.46)) * (0.9 + depth * 0.24),
    phase: TAU * cycles * lp + layer * 1.27,
  }
}
function waveY(x, p, extraAmp = 0) {
  const a = p.amp + extraAmp
  return (
    p.yBase + a * Math.sin(x * p.k + p.phase) + a * 0.4 * Math.sin(x * p.k * 2.3 + p.phase * 1.7)
  )
}
function wavePathD(W, p, extraAmp, steps = 140) {
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * W
    const y = waveY(x, p, extraAmp)
    d += i === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return d
}

function Scene() {
  const f = useCurrentFrame()
  const { width: W, height: H, durationInFrames: N } = useVideoConfig()
  const lp = f / N // loop progress, 0..1

  // --- beats ---
  const graphIn = pulse(f, 120, 200, 470, 560) // the scene graph's lifetime
  const energy = pulse(f, 250, 310, 460, 540) // pulses on the edges
  const burst = pulse(f, 360, 410, 510, 590) // frame sparks
  const frontSwell = 10 * burst // the hero wave crests during the burst

  // --- camera: one breath. sin(π·lp)² is 0 at both ends → loop-perfect. ---
  const breath = Math.sin(Math.PI * lp) ** 2
  const zoom = 1 + 0.075 * breath
  const fx = W * (0.56 + 0.025 * Math.sin(TAU * lp))
  const fy = H * (0.6 - 0.02 * Math.cos(TAU * lp))

  // --- background: breathing fBm, palindromic time → loops exactly ---
  const fbmTime = 1.6 + 0.7 * Math.sin(TAU * lp)

  // --- the wave field ---
  const field = []
  for (let w = 0; w < WAVE_COLORS.length; w++) {
    const p = waveParams(w, W, H, lp)
    const front = w === WAVE_COLORS.length - 1
    field.push(
      h(Path, {
        key: `wave${w}`,
        d: wavePathD(W, p, front ? frontSwell : 0),
        stroke: WAVE_COLORS[w],
        strokeWidth: 1.3 + p.depth * 2.4,
        strokeCap: 'round',
        opacity: 0.14 + p.depth * 0.8,
        ...(front ? { bloom: { sigma: 24, threshold: 0.26, intensity: 2.1 } } : {}),
      }),
    )
  }

  // --- the scene graph: nodes rise off the front wave's crests ---------------
  const frontP = waveParams(WAVE_COLORS.length - 1, W, H, lp)
  const NODES = 9
  const nodes = []
  for (let i = 0; i < NODES; i++) {
    const nx = W * (0.16 + i * 0.085)
    const anchorY = waveY(nx, frontP, frontSwell)
    // staggered entrance, right-to-left feels like the wave "ignites"
    const nIn = pulse(f, 124 + i * 9, 188 + i * 9, 466 + i * 5, 548 + i * 5)
    const rise = (52 + hash(i) * 168) * nIn
    nodes.push({ x: nx, y: anchorY - rise, vis: nIn, anchorY })
  }
  const graph = []
  // stems: each node tethered to its crest
  for (let i = 0; i < NODES; i++) {
    const n = nodes[i]
    if (n.vis <= 0.01) continue
    graph.push(
      h(Path, {
        key: `stem${i}`,
        d: `M ${n.x.toFixed(1)} ${n.anchorY.toFixed(1)} L ${n.x.toFixed(1)} ${n.y.toFixed(1)}`,
        stroke: '#7d3c50',
        strokeWidth: 1,
        opacity: 0.4 * n.vis,
      }),
    )
  }
  // edges: chain + a few cross-links
  const links = []
  for (let i = 0; i < NODES - 1; i++) links.push([i, i + 1])
  for (let i = 0; i < NODES - 2; i += 2) links.push([i, i + 2])
  for (let e = 0; e < links.length; e++) {
    const [a, b] = links[e]
    const va = nodes[a]
    const vb = nodes[b]
    const vis = Math.min(va.vis, vb.vis)
    if (vis <= 0.01) continue
    graph.push(
      h(Path, {
        key: `edge${e}`,
        d: `M ${va.x.toFixed(1)} ${va.y.toFixed(1)} L ${vb.x.toFixed(1)} ${vb.y.toFixed(1)}`,
        stroke: '#a44f63',
        strokeWidth: 1.1,
        opacity: 0.55 * vis,
      }),
    )
    // energy beat: a bright pulse travels each edge on its own cadence
    if (energy > 0.01) {
      const t = (f / 24 + e * 0.37) % 1
      const px = va.x + (vb.x - va.x) * t
      const py = va.y + (vb.y - va.y) * t
      graph.push(
        h(Ellipse, {
          key: `pulse${e}`,
          x: px - 4.5,
          y: py - 4.5,
          width: 9,
          height: 9,
          fill: ROSE_BRIGHT,
          opacity: energy * Math.sin(Math.PI * t) * 0.95,
        }),
      )
    }
  }
  // the nodes themselves (over the edges)
  for (let i = 0; i < NODES; i++) {
    const n = nodes[i]
    if (n.vis <= 0.01) continue
    const r = 3.4 + hash(i + 9) * 2.4
    graph.push(
      h(Ellipse, {
        key: `node${i}`,
        x: n.x - r,
        y: n.y - r,
        width: r * 2,
        height: r * 2,
        fill: ROSE_BRIGHT,
        opacity: 0.95 * n.vis,
      }),
    )
  }

  // --- the burst: outlined mini-frames (16:9) spark off the crests ----------
  const sparks = []
  if (burst > 0.01) {
    const SPARKS = 11
    for (let s = 0; s < SPARKS; s++) {
      const birth = 366 + ((s * 29) % 150)
      const life = 64
      const t = (f - birth) / life
      if (t < 0 || t > 1) continue
      const e = 1 - (1 - t) ** 2 // ease-out flight
      const sx0 = W * (0.5 + hash(s + 31) * 0.4)
      const sy0 = waveY(sx0, frontP, frontSwell)
      const sx = sx0 + e * (90 + hash(s + 7) * 240)
      const sy = sy0 - e * (260 + hash(s + 17) * 220)
      const scale = 0.55 + e * 0.45
      const sw = 56 * scale
      const sh = 33 * scale
      sparks.push(
        h(Rect, {
          key: `spark${s}`,
          x: sx - sw / 2,
          y: sy - sh / 2,
          width: sw,
          height: sh,
          stroke: ROSE_BRIGHT,
          strokeWidth: 1.4,
          cornerRadius: 3,
          opacity: (1 - e) * burst * 0.9,
        }),
      )
    }
  }

  return h(
    Group,
    { grain: { intensity: 0.045, size: 1.15 } },
    // 1. breathing fBm depths — kept DARK (this sits behind the headline)
    h(Rect, {
      key: 'fbm',
      width: W,
      height: H,
      gradient: fbmGradient(
        [
          { offset: 0.0, color: '#030207' },
          { offset: 0.45, color: '#07040f' },
          { offset: 0.72, color: '#110a1d' },
          { offset: 0.9, color: '#1f1026' },
          { offset: 1.0, color: '#33182c' },
        ],
        { scale: 0.9, warp: 0.45, time: fbmTime },
      ),
    }),

    // 2. the camera world: wave + graph + sparks breathe together
    h(
      Camera,
      { key: 'world', zoom, focusX: fx, focusY: fy, viewportWidth: W, viewportHeight: H },
      field,
      graph,
      sparks,
    ),

    // 3. vignette — heavier than usual: this is a text backdrop first
    h(Rect, {
      key: 'vignette',
      width: W,
      height: H,
      gradient: radialGradient([W * 0.52, H * 0.55], Math.hypot(W, H) * 0.62, [
        { offset: 0.0, color: '#00000000' },
        { offset: 0.55, color: '#00000014' },
        { offset: 1.0, color: '#030208c9' },
      ]),
    }),
  )
}

export default function engineHero({ fps, durationInFrames, width, height }) {
  return h(Composition, { width, height, fps, durationInFrames }, h(Scene, null))
}
