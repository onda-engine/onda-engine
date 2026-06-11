// AURA — a cinematic fragrance teaser (1080×1920, 9s). Real media + custom fonts + 3D
// + beat-synced motion + the cinematic finish, assembled by the ONDA engine.
// Render: node scripts/aura.comp.mjs > frames.json ; onda export-frames frames.json out.mp4 --font ... --backend vello
import {
  createElement as h,
} from 'react'
import {
  Audio, Composition, Ellipse, Image, Rect, Scene3D, Center, Text,
  radialGradient, renderFramesJSON, useCurrentFrame,
} from '@onda/react'
const W = 1080, H = 1920, CX = 540, FPS = 30, DUR = 270
const DIR = process.cwd() + '/public'
const PLATE = DIR + '/aura/plate.jpg', GLOW = DIR + '/aura/glow.jpg', NOIR = DIR + '/aura/noir.jpg', EMBER = DIR + '/aura/ember.jpg'
const AUDIO = DIR + '/aura-amb.wav'   // warm ambient pad + synthesized SFX (whoosh / chimes / impact)

const win = (f, a, b, c, d) => (f < a ? 0 : f < b ? (f - a) / (b - a) : f < c ? 1 : f < d ? 1 - (f - c) / (d - c) : 0)
const lerp = (f, a, b, va, vb) => { const t = Math.max(0, Math.min(1, (f - a) / (b - a))); return va + (vb - va) * t }
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

// 1 — COLD OPEN (0–46): a single serif line breathes in over black.
const ColdOpen = (f) => {
  const o = win(f, 0, 16, 32, 46)
  if (o <= 0) return null
  return h('onda-group', { opacity: o },
    h(Center, { y: 900, height: 80 },
      h(Text, { fontSize: 28, fontFamily: 'Spectral', color: '#b59a6e', letterSpacing: 12 }, 'F O R   T H E   S E N S E S')))
}

// 2 — PORTRAIT (40–152): the hero plate, graded, with a slow Ken-Burns push; wordmark fades in.
const Portrait = (f) => {
  const o = win(f, 40, 56, 138, 152)
  if (o <= 0) return null
  const s = lerp(f, 40, 152, 1.04, 1.12)
  const t = win(f, 72, 96, 138, 152)
  return h('onda-group', { opacity: o },
    h(Image, { src: PLATE, width: W, height: H, fit: 'cover', scaleX: s, scaleY: s, originX: CX, originY: 960,
      grade: { exposure: -0.12, contrast: 1.12, saturation: 1.08, temperature: 0.16 } }),
    h('onda-group', { opacity: t },
      h(Center, { y: 1500, height: 90 }, h(Text, { fontSize: 60, fontFamily: 'Bricolage Grotesque 96pt', color: '#f3ecdb' }, 'AURA')),
      h(Center, { y: 1606, height: 60 }, h(Text, { fontSize: 25, fontFamily: 'Spectral', color: '#d2c4ab', letterSpacing: 6 }, 'T H E   N E W   F R A G R A N C E'))))
}

// 3 — SENSORY FLASHES (144–206): atmospheric textures, each with a slow zoom; the word
// fades in gently and the audio's chime sparkles on it (ambient mood, not a beat punch).
const FSEG = [
  { img: GLOW, word: 'WARMTH', a: 144, b: 168 },
  { img: EMBER, word: 'LIGHT', a: 168, b: 186 },
  { img: NOIR, word: 'MEMORY', a: 186, b: 206 },
]
const Flashes = (f) => {
  const o = win(f, 144, 152, 196, 206)
  if (o <= 0) return null
  const seg = f < 168 ? FSEG[0] : f < 186 ? FSEG[1] : FSEG[2]
  const wword = win(f, seg.a + 2, seg.a + 11, seg.b - 8, seg.b)
  const sc = lerp(f, seg.a, seg.b, 1.04, 1.12)
  return h('onda-group', { opacity: o },
    h(Image, { src: seg.img, width: W, height: H, fit: 'cover', scaleX: sc, scaleY: sc, originX: CX, originY: 960,
      grade: { exposure: -0.28, contrast: 1.18, saturation: 0.72, temperature: 0.42 } }),
    h(Rect, { width: W, height: H, fill: '#1a0e04', opacity: 0.4 }),
    h('onda-group', { opacity: wword },
      h(Center, { y: 880, height: 160 },
        h(Text, { fontSize: 96, fontFamily: 'Bricolage Grotesque 96pt', color: '#f3e6cf' }, seg.word))))
}

// 4 — LOGO REVEAL + END-CARD (196–270): the 3D wordmark turns to face you, the aura grows, the card settles.
const Reveal = (f) => {
  const o = win(f, 196, 210, 99999, 99999)
  if (o <= 0) return null
  const yaw = 26 * (1 - ease(Math.min(1, Math.max(0, (f - 200) / 34))))
  const halo = win(f, 200, 232, 99999, 99999)
  const tag = win(f, 236, 254, 99999, 99999)
  return h('onda-group', { opacity: o },
    h(Rect, { width: W, height: H, gradient: radialGradient([CX, 920], 980,
      [{ offset: 0, color: '#2b2114' }, { offset: 0.5, color: '#130d0a' }, { offset: 1, color: '#070608' }]) }),
    h(Ellipse, { width: 1100, height: 760, x: CX - 550, y: 540, fill: '#43300f', blur: 170, opacity: 0.32 * halo }),
    h(Rect, { width: 84, height: 1.5, x: CX - 42, y: 670, fill: '#8a6c44', opacity: tag }),
    h(Scene3D, { camera: { position: [CX, 920, -2600], fov: 34 } },
      h(Text, { fontSize: 230, fontFamily: 'Bricolage Grotesque 96pt', color: '#f1e9d8', position3d: [CX, 920, 0], rotation3d: [7, yaw, 0], extrude: 30 }, 'AURA')),
    h('onda-group', { opacity: tag },
      h(Center, { y: 1130, height: 60 }, h(Text, { fontSize: 30, fontFamily: 'Spectral', color: '#b69a72', letterSpacing: 10 }, 'E A U   D E   P A R F U M'))))
}

const Movie = () => {
  const f = useCurrentFrame()
  return h('onda-group', null,
    h(Rect, { width: W, height: H, fill: '#000000' }),
    ColdOpen(f), Portrait(f), Flashes(f), Reveal(f),
    h(Audio, { src: AUDIO }))
}

const comp = h(Composition, { width: W, height: H, fps: FPS, durationInFrames: DUR,
  finish: { bloom: { sigma: 13, threshold: 0.7, intensity: 0.95 }, halation: 0.28, temperature: 0.16, contrast: 1.1, saturation: 1.05, vignette: 0.4, grain: 0.05 } },
  h(Movie))
console.log(renderFramesJSON(comp))
