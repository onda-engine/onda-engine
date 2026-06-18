import { beatPulse } from '@onda-engine/components'
import {
  Audio,
  Center,
  Composition,
  Rect,
  Text,
  fbmGradient,
  renderFramesJSON,
  useCurrentFrame,
} from '@onda-engine/react'
// "MADE TO MOVE" — a kinetic-typography reel (16:9, 6.4s). Bold words slam on the beat
// over a fluid fBm gradient, with RGB-split + grain; engine-scored 128-BPM track.
import { createElement as h } from 'react'

const W = 1920,
  H = 1080,
  CX = 960,
  CY = 540,
  FPS = 30,
  DUR = 192
const DIR = process.cwd() + '/public'
const BEAT = DIR + '/reel-beat.wav'
const BEATS = [0, 14, 28, 42, 56, 70, 84, 98, 112, 126, 140, 154, 169, 179]
const WORDS = [
  { t: 'MADE', f: 14 },
  { t: 'TO', f: 42 },
  { t: 'MOVE', f: 70 },
]
const BG = [
  { offset: 0, color: '#160f3a' },
  { offset: 0.5, color: '#4f46e5' },
  { offset: 1, color: '#db2777' },
]

const clamp01 = (x) => Math.max(0, Math.min(1, x))
const easeOut = (t) => 1 - (1 - t) ** 3

// A big word that SLAMS in: scale 1.22→1.0 (ease-out) + opacity snap, RGB-split pulsing on the beat.
const word = (w, f) => {
  const since = f - w.f
  const e = easeOut(clamp01(since / 9))
  const s = 1.22 - 0.22 * e
  return h(
    'onda-group',
    { key: w.t, scaleX: s, scaleY: s, originX: CX, originY: CY, opacity: clamp01(since / 5) },
    h(
      Center,
      { y: CY - 150, height: 300 },
      h(
        Text,
        {
          fontSize: 360,
          fontFamily: 'Bricolage Grotesque 96pt',
          color: '#ffffff',
          chromaticAberration: 4 + 12 * beatPulse(f, BEATS, 5),
        },
        w.t,
      ),
    ),
  )
}

// The payoff wordmark.
const mark = (f) => {
  const e = easeOut(clamp01((f - 112) / 12))
  const p = beatPulse(f, BEATS, 7)
  return h(
    'onda-group',
    { opacity: e },
    h(
      'onda-group',
      { scaleX: 1 + 0.03 * p, scaleY: 1 + 0.03 * p, originX: CX, originY: CY },
      h(
        Center,
        { y: CY - 130, height: 240 },
        h(
          Text,
          {
            fontSize: 300,
            fontFamily: 'Bricolage Grotesque 96pt',
            color: '#ffffff',
            chromaticAberration: 3 + 6 * p,
          },
          'ONDA',
        ),
      ),
    ),
    h(
      Center,
      { y: CY + 150, height: 60 },
      h(
        Text,
        { fontSize: 30, fontFamily: 'Spectral', color: '#e7e3ff', letterSpacing: 12 },
        'G P U - N A T I V E   M O T I O N',
      ),
    ),
  )
}

const Reel = () => {
  const f = useCurrentFrame()
  const p = beatPulse(f, BEATS, 6)
  const active = WORDS.filter((w) => w.f <= f).pop()
  const showMark = f >= 110
  return h(
    'onda-group',
    null,
    h(Rect, {
      width: W,
      height: H,
      gradient: fbmGradient(BG, { scale: 1.1, warp: 0.6, time: (f / FPS) * 0.25 }),
    }),
    h(Rect, { width: W, height: H, fill: '#ffffff', opacity: 0.06 * p }),
    ...(!showMark && active ? [word(active, f)] : []),
    ...(showMark ? [mark(f)] : []),
    h(Audio, { src: BEAT }),
  )
}

const comp = h(
  Composition,
  {
    width: W,
    height: H,
    fps: FPS,
    durationInFrames: DUR,
    finish: {
      grain: 0.06,
      vignette: 0.32,
      contrast: 1.06,
      saturation: 1.12,
      temperature: -0.02,
      bloom: { sigma: 14, threshold: 0.78, intensity: 0.7 },
    },
  },
  h(Reel),
)
console.log(renderFramesJSON(comp))
