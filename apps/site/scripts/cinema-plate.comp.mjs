// cinema-plate.comp.mjs — the cinematic-compositing exemplar (v1, existing tools).
//
// Takes ONE raw golden-hour still (apps/site/public/cinema/plate.jpg, a CC0 stand-in
// for AI-generated media) and DIRECTS it into a premium title card: a corrective
// grade, a focus-pull entrance, a slow Ken Burns push, bloom on the sun flare, a
// Bricolage title in the dark negative space, and a vignette. Proves "ONDA lands
// media beautifully." v1 runs in the engine's current (gamma) pipeline — the linear
// + light-wrap keystone will sharpen the bloom/integration next (the before/after).
//
//   node apps/site/scripts/render-comp.mjs --comp apps/site/scripts/cinema-plate.comp.mjs \
//     --width 1080 --height 1920 --fps 30 --duration 210 --out apps/site/public/cinema/plate-film.mp4 \
//     --font apps/site/public/fonts/BricolageGrotesque96pt-ExtraBold.ttf \
//     --font apps/site/public/fonts/BricolageGrotesque96pt-Light.ttf

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Camera,
  Composition,
  Group,
  Image,
  Path,
  Rect,
  Text,
  morphPath,
  radialGradient,
  useCurrentFrame,
  useVideoConfig,
} from '@onda-engine/react'
import { createElement as h } from 'react'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLATE = path.resolve(HERE, '../public/cinema/plate.jpg')

const FONT = 'Bricolage Grotesque 96pt'
const INK = '#f6efe2'
const MUTED = '#c2b29a'
const DIM = '#8c7f6c'
const GOLD = '#e8b074'

// The morph ornament: a diamond that magic-moves into a hairline rule (the
// "fleuron unfolds into an underline" — demonstrates morphPath, centered at origin).
const DIAMOND = 'M 0 -10 L 10 0 L 0 10 L -10 0 Z'
const RULE = 'M -104 -1.5 L 104 -1.5 L 104 1.5 L -104 1.5 Z'

const clamp01 = (x) => Math.max(0, Math.min(1, x))
function ramp(f, a, b) {
  const t = clamp01((f - a) / (b - a))
  return t * t * (3 - 2 * t)
}

function Scene() {
  const f = useCurrentFrame()
  const { width: W, height: H, durationInFrames: N } = useVideoConfig()

  // Focus-pull entrance: the plate racks from soft to sharp.
  const focus = (1 - ramp(f, 0, 50)) * 30

  // Slow Ken Burns push (a still gains motion) + a faint vertical drift.
  const zoom = 1.04 + 0.06 * ramp(f, 0, N)
  const fy = H / 2 + (1 - ramp(f, 0, N)) * H * 0.015

  // Title beats (after the focus resolves).
  // Staged title reveal: SOLENNE rises → a gold ornament unfolds (morphs) from a
  // diamond into a hairline rule → the subtitle + credit settle under it.
  const wordIn = ramp(f, 52, 88)
  const wordRise = (1 - ramp(f, 52, 100)) * 26
  const ornIn = ramp(f, 74, 96)
  const ornD = morphPath(DIAMOND, RULE, ramp(f, 98, 126))
  const subIn = ramp(f, 116, 146)
  const credIn = ramp(f, 150, 182)

  // Rough centering (tuned by eye for Bricolage; verified by render).
  const wordSize = Math.round(W * 0.15)
  const wordX = Math.round(W / 2 - wordSize * 1.62)
  const wordY = Math.round(H * 0.62)
  const ornY = Math.round(wordY + wordSize * 1.2)
  const subSize = Math.round(W * 0.03)
  const subText = 'Eau de Parfum · Summer ’26'
  const subX = Math.round(W / 2 - subText.length * subSize * 0.27)
  const subY = Math.round(wordY + wordSize * 1.56)
  const credText = 'Composed in ONDA — directed from a single still.'
  const credSize = Math.round(W * 0.0205)
  const credX = Math.round(W / 2 - credText.length * credSize * 0.255)

  // Film grain (onda-noise overlay) — per-frame seed so it shimmers AND survives
  // motion-blur averaging (round(f) is constant across a frame's sub-frames).
  const gnw = Math.max(2, Math.round(W * 0.91))
  const gnh = Math.max(2, Math.round(H * 0.91))
  const gSeed = Math.round(f)

  return [
    // The directed plate: corrective grade + bloom + focus-pull, inside a slow push.
    h(
      Camera,
      { key: 'cam', zoom, focusX: W / 2, focusY: fy, viewportWidth: W, viewportHeight: H },
      h(Image, {
        key: 'plate',
        src: PLATE,
        x: 0,
        y: 0,
        width: W,
        height: H,
        fit: 'cover',
        blur: focus,
        // Corrective grade: tame the stock saturation, add contrast + a touch of
        // warmth — kills the "stock photo" read, nudges toward a graded look.
        grade: { saturation: 0.9, contrast: 1.06, exposure: -0.03, temperature: 0.03 },
        // Bloom the bright sun-flare highlights (flat-ish in gamma; real in linear).
        bloom: { sigma: 22, threshold: 0.72, intensity: 1.25 },
      }),
    ),

    // Vignette — pull focus to the subject, deepen the lower negative space.
    h(Rect, {
      key: 'vignette',
      width: W,
      height: H,
      gradient: radialGradient([W / 2, H * 0.42], Math.hypot(W, H) * 0.62, [
        { offset: 0.0, color: '#00000000' },
        { offset: 0.55, color: '#00000000' },
        { offset: 1.0, color: '#0a0704bf' },
      ]),
    }),

    // Title block in the dark lower third.
    h(
      Group,
      { key: 'title', y: wordRise },
      h(
        Text,
        {
          x: wordX,
          y: wordY,
          fontSize: wordSize,
          fontFamily: FONT,
          fontWeight: 800,
          letterSpacing: 2,
          color: INK,
          opacity: wordIn,
        },
        'SOLENNE',
      ),
      // The morph ornament: a gold diamond that magic-moves into a hairline rule,
      // with a soft glow so it reads against the dark plate.
      h(Path, {
        x: W / 2,
        y: ornY,
        d: ornD,
        fill: GOLD,
        opacity: ornIn,
        shadow: { color: GOLD, blur: 9 },
      }),
      h(
        Text,
        {
          x: subX,
          y: subY,
          fontSize: subSize,
          fontFamily: FONT,
          fontWeight: 300,
          letterSpacing: 1,
          color: MUTED,
          opacity: subIn,
        },
        subText,
      ),
    ),

    // Quiet credit at the very bottom — ties the demo back to the engine.
    h(
      Text,
      {
        key: 'credit',
        x: credX,
        y: Math.round(H * 0.93),
        fontSize: credSize,
        fontFamily: FONT,
        fontWeight: 300,
        letterSpacing: 1,
        color: DIM,
        opacity: credIn,
      },
      credText,
    ),

    // Film grain over everything — onda-noise, overlay-blended (modulates, not
    // washes), shimmering. Unifies the plate + graphics under one texture.
    h(Image, {
      key: 'grain',
      src: `onda-noise://w=${gnw}&h=${gnh}&seed=${gSeed}&intensity=0.06&mono=1`,
      x: 0,
      y: 0,
      width: W,
      height: H,
      fit: 'fill',
      blendMode: 'overlay',
    }),
  ]
}

export default function cinemaPlate({ fps, durationInFrames, width, height }) {
  // linear: the cinematic finish — bloom composites in linear light + ACES tone-map,
  // so the sun-flare reads as real light bleed (smooth roll-off) instead of a flat
  // clipped overlay, and the plate gets a filmic highlight curve. GPU/export only.
  return h(Composition, { width, height, fps, durationInFrames, linear: true }, h(Scene, null))
}
