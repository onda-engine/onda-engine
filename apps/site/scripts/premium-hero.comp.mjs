// premium-hero.comp.mjs — the ONDA landing hero, authored for native export.
//
// Concept: ONDA = "wave". The engine renders a dark, breathing fBm surface (the
// "expensive" gradient), a single glowing wave line undulating across it (the
// persistent motif — the thing your eye tracks through the whole film), and
// confident Bricolage Grotesque display type in two cross-faded beats. ONE slow
// camera push ties it into a continuous move, not a slideshow.
//
// Rendered natively (full quality, deterministic, no preview flicker):
//   node apps/site/scripts/render-comp.mjs --comp apps/site/scripts/premium-hero.comp.mjs \
//     --width 1920 --height 1080 --fps 30 --duration 360 --out apps/site/public/hero.mp4 \
//     --font apps/site/public/fonts/BricolageGrotesque96pt-ExtraBold.ttf \
//     --font apps/site/public/fonts/BricolageGrotesque96pt-SemiBold.ttf \
//     --font apps/site/public/fonts/BricolageGrotesque96pt-Light.ttf

import {
  Camera,
  Composition,
  Group,
  Path,
  Rect,
  Text,
  fbmGradient,
  radialGradient,
  useCurrentFrame,
  useVideoConfig,
} from '@onda-engine/react'
import { createElement as h } from 'react'

// Bricolage Grotesque 96pt — the typographic family the engine reports for every
// weight (select the weight via fontWeight). Loaded by the CLI via --font.
const FONT = 'Bricolage Grotesque 96pt'
const INK = '#f4f1ff'
const MUTED = '#938da8'
const WAVE = '#d9ccff'

// --- timing helpers ---------------------------------------------------------
const clamp01 = (x) => Math.max(0, Math.min(1, x))
// smoothstep ramp: 0 at a, 1 at b (eased in + out).
function ramp(f, a, b) {
  const t = clamp01((f - a) / (b - a))
  return t * t * (3 - 2 * t)
}
// fade in over [inA,inB], hold, fade out over [outA,outB].
function pulse(f, inA, inB, outA, outB) {
  return Math.min(ramp(f, inA, inB), 1 - ramp(f, outA, outB))
}

// A compound sine wave as SVG path data (two harmonics → organic, not mechanical).
function wavePath(W, yBase, amp, k, phase, steps) {
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * W
    const y =
      yBase + amp * Math.sin(x * k + phase) + amp * 0.4 * Math.sin(x * k * 2.3 + phase * 1.7)
    d += i === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return d
}

function Scene() {
  const f = useCurrentFrame()
  const { width: W, height: H, durationInFrames: N, fps } = useVideoConfig()

  // The fBm surface drifts slowly — a living "expensive" gradient (native render).
  const fbmTime = (f / fps) * 0.42

  // Continuity spine #1: one slow camera push + a faint focus drift.
  const zoom = 1.0 + 0.06 * ramp(f, 0, N)
  const fx = W / 2 + Math.sin(f / 175) * W * 0.012
  const fy = H / 2 + Math.sin(f / 215) * H * 0.01

  // Continuity spine #2: the wave motif — a FIELD of layered waves (ONDA = wave),
  // present the whole film. Back layers are faint + slow (depth); the front wave is
  // the bright hero, glowing, and crests as the brand resolves (a quiet beat).
  const waveIn = ramp(f, 26, 96)
  const crest = ramp(f, 196, 286)
  const wavePhase = f * 0.045
  const baseK = (2 * Math.PI) / (W * 0.46)
  const NW = 5
  const waveField = []
  for (let w = 0; w < NW; w++) {
    const depth = w / (NW - 1) // 0 = back/faint, 1 = front/hero
    const front = w === NW - 1
    const yb = H * (0.62 + depth * 0.17)
    const amp = (7 + depth * 15 + (front ? 12 * crest : 0)) * waveIn
    const ph = wavePhase * (0.7 + depth * 0.7) + w * 1.27
    const kk = baseK * (0.92 + depth * 0.22)
    const d = wavePath(W, yb, amp, kk, ph, 120)
    const stroke = front ? WAVE : depth > 0.55 ? '#b9a8e8' : '#6a5d97'
    waveField.push(
      h(Path, {
        key: `wave${w}`,
        d,
        stroke,
        strokeWidth: 1.4 + depth * 2.3,
        strokeCap: 'round',
        opacity: (0.1 + depth * 0.82) * waveIn,
        ...(front ? { bloom: { sigma: 22, threshold: 0.3, intensity: 1.9 } } : {}),
      }),
    )
  }

  // Two beats, cross-faded: the value line, then the brand resolve.
  const b1 = pulse(f, 24, 58, 150, 184)
  const b2 = ramp(f, 190, 230)
  const b1Rise = (1 - ramp(f, 24, 84)) * 26 // ease up on entry
  const b2Rise = (1 - ramp(f, 190, 250)) * 30

  // Rough centering for the wordmark (tuned by eye for Bricolage ExtraBold).
  const wordSize = Math.round(H * 0.22)
  const wordX = Math.round(W / 2 - wordSize * 1.18)
  const subSize = Math.round(H * 0.028)
  const subText = 'The GPU-native motion engine — source-available'
  const subX = Math.round(W / 2 - subText.length * subSize * 0.245)

  return [
    // 1. The fBm surface — dark indigo → plum → dusty rose, breathing.
    h(Rect, {
      key: 'fbm',
      width: W,
      height: H,
      gradient: fbmGradient(
        [
          { offset: 0.0, color: '#050510' },
          { offset: 0.3, color: '#0d0b22' },
          { offset: 0.55, color: '#221442' },
          { offset: 0.78, color: '#3e1f55' },
          { offset: 1.0, color: '#6a2f5e' },
        ],
        { scale: 0.95, warp: 0.5, time: fbmTime },
      ),
    }),

    // 2. Camera world: the wave + type push together (the FBM + vignette stay put).
    h(
      Camera,
      { key: 'world', zoom, focusX: fx, focusY: fy, viewportWidth: W, viewportHeight: H },
      // The wave field (back→front; the front layer glows).
      waveField,

      // Beat 1 — the value line (left-aligned, off-center, two lines).
      h(
        Group,
        { key: 'b1', opacity: b1, y: b1Rise },
        h(
          Text,
          {
            x: Math.round(W * 0.11),
            y: Math.round(H * 0.4),
            fontSize: Math.round(H * 0.082),
            fontFamily: FONT,
            fontWeight: 600,
            color: INK,
          },
          'Motion graphics,',
        ),
        h(
          Text,
          {
            x: Math.round(W * 0.11),
            y: Math.round(H * 0.4 + H * 0.092),
            fontSize: Math.round(H * 0.082),
            fontFamily: FONT,
            fontWeight: 600,
            color: INK,
          },
          'without the browser.',
        ),
      ),

      // Beat 2 — the brand resolve (ONDA + subhead, centered).
      h(
        Group,
        { key: 'b2', opacity: b2, y: b2Rise },
        h(
          Text,
          {
            x: wordX,
            y: Math.round(H * 0.31),
            fontSize: wordSize,
            fontFamily: FONT,
            fontWeight: 800,
            color: INK,
          },
          'ONDA',
        ),
        h(
          Text,
          {
            x: subX,
            y: Math.round(H * 0.31 + wordSize * 1.06),
            fontSize: subSize,
            fontFamily: FONT,
            fontWeight: 300,
            color: MUTED,
          },
          subText,
        ),
      ),
    ),

    // 3. Persistent eyebrow (screen-fixed UI chrome) — present throughout.
    h(
      Text,
      {
        key: 'eyebrow',
        x: Math.round(W * 0.08),
        y: Math.round(H * 0.085),
        fontSize: Math.round(H * 0.02),
        fontFamily: FONT,
        fontWeight: 500,
        letterSpacing: 3,
        color: MUTED,
        opacity: ramp(f, 8, 32),
      },
      'ONDA · GPU-NATIVE MOTION ENGINE',
    ),

    // 4. Vignette — a radial darkening overlay (transparent center → dark edges).
    h(Rect, {
      key: 'vignette',
      width: W,
      height: H,
      gradient: radialGradient([W / 2, H / 2], Math.hypot(W, H) * 0.6, [
        { offset: 0.0, color: '#00000000' },
        { offset: 0.62, color: '#00000000' },
        { offset: 1.0, color: '#05040c9e' },
      ]),
    }),
  ]
}

export default function premiumHero({ fps, durationInFrames, width, height }) {
  return h(Composition, { width, height, fps, durationInFrames }, h(Scene, null))
}
