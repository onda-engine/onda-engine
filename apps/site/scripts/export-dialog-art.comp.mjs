// export-dialog-art.comp.mjs — brand artwork for ONDA Studio's export dialog,
// rendered by the engine itself (the export dialog's art IS an export).
// 2:3 portrait (1024×1536), violet aurora over near-black, finished with bloom
// + grain. Regenerate: node apps/site/scripts/export-dialog-art.comp.mjs &&
//   target/release/onda render /tmp/export-dialog-art.json /tmp/export-dialog-art.png --backend vello
import { writeFileSync } from 'node:fs'
import {
  Composition,
  Ellipse,
  Group,
  Image,
  Rect,
  linearGradient,
  renderFrame,
} from '@onda-engine/react'
import { createElement as h } from 'react'

const W = 1024
const H = 1536

const scene = h(
  Group,
  null,
  // Base: deep near-black, slightly lifted at the top (never pure #000).
  h(Rect, {
    width: W,
    height: H,
    gradient: linearGradient(
      [0, 0],
      [0, H],
      [
        { offset: 0, color: '#0c0a14' },
        { offset: 0.45, color: '#08070d' },
        { offset: 1, color: '#050507' },
      ],
    ),
  }),
  // The aurora — three soft violet bodies drifting across the upper half,
  // heavily blurred so they read as volumetric light, not shapes.
  h(
    Group,
    { blur: 90 },
    h(Ellipse, { x: -180, y: 240, width: 900, height: 460, fill: '#4c1d95', opacity: 0.85 }),
  ),
  h(
    Group,
    { blur: 70 },
    h(Ellipse, { x: 320, y: 420, width: 820, height: 380, fill: '#7c3aed', opacity: 0.7 }),
  ),
  h(
    Group,
    { blur: 60 },
    h(Ellipse, { x: 120, y: 560, width: 560, height: 240, fill: '#a78bfa', opacity: 0.45 }),
  ),
  // A thin bright crest line where the wave breaks — the "horizon glow".
  h(
    Group,
    { blur: 18 },
    h(Rect, {
      x: -60,
      y: 700,
      width: W + 120,
      height: 10,
      fill: '#c4b5fd',
      opacity: 0.55,
      rotation: -7,
    }),
  ),
  // Faint second crest, lower and dimmer — depth.
  h(
    Group,
    { blur: 26 },
    h(Rect, {
      x: -60,
      y: 960,
      width: W + 120,
      height: 8,
      fill: '#7c3aed',
      opacity: 0.3,
      rotation: -4,
    }),
  ),
  // Fine mono grain over everything, overlay blend, very restrained.
  h(Image, {
    src: `onda-noise://w=${W}&h=${H}&seed=7&intensity=0.05&mono=1`,
    x: 0,
    y: 0,
    width: W,
    height: H,
    blendMode: 'overlay',
  }),
)

const comp = h(
  Composition,
  {
    width: W,
    height: H,
    fps: 30,
    durationInFrames: 30,
    // The finish carries the glow: bloom lifts the crest + aurora cores,
    // vignette seats the corners, a touch of halation for the cinematic read.
    finish: {
      bloom: { sigma: 22, threshold: 0.32, intensity: 1.6 },
      halation: 0.35,
      vignette: 0.28,
    },
  },
  scene,
)

writeFileSync('/tmp/export-dialog-art.json', JSON.stringify(renderFrame(comp, 14)))
console.log('scene JSON → /tmp/export-dialog-art.json')
