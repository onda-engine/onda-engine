// VOICE — kinetic test (the re-direction: motion, glow, camera, continuity).
// The voice as a living luminous waveform-spectrum that never stops flowing, a
// camera pushing through it, kinetic type rising out of the flow. ~16s.
//
//   node apps/site/scripts/render-comp.mjs --comp ./apps/site/scripts/voice-kinetic-test.comp.mjs \
//     --width 1920 --height 1080 --fps 30 --duration 480 \
//     --font apps/site/public/fonts/Spectral-Medium.ttf --out /tmp/voice-kinetic.mp4
import { createElement as h } from 'react'
import {
  Composition,
  Camera,
  Group,
  Rect,
  Path,
  interpolate,
  useCurrentFrame,
} from '@onda/react'
import { MeshGradient, GrainOverlay, Vignette, KineticText } from '@onda/components'

const FPS = 30
const BASE = '#06060B'
// A vibrant warm→cool spectrum for the voice lines (ElevenLabs-coded energy).
const SPECTRUM = ['#FFB877', '#FF7DA6', '#B98CFF', '#6FD0FF']
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
const ease = (t) => t * t * (3 - 2 * t)

// A flowing voice waveform as an SVG path: layered sines (organic, not a pure tone)
// tapered to zero at both ends, scrolling by `phase`.
function wavePath(width, cy, amp, phase, idx) {
  const N = 150
  let d = ''
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const x = t * width
    const env = Math.sin(Math.PI * t) // 0 at ends → a centered burst
    const y =
      cy +
      amp *
        env *
        (0.6 * Math.sin(t * 9 + phase + idx * 0.7) +
          0.28 * Math.sin(t * 17 - phase * 1.6 + idx) +
          0.12 * Math.sin(t * 31 + phase * 2.3))
    d += (i === 0 ? 'M ' : ' L ') + x.toFixed(1) + ' ' + y.toFixed(1)
  }
  return d
}

function Voice({ width, height }) {
  const frame = useCurrentFrame()
  const cx = width / 2
  const cy = height / 2

  // The voice "wakes": amplitude swells from a near-flat line into a full wave,
  // pulses while it "speaks", then eases back toward calm — always moving.
  const wake = interpolate(frame, [0, 60], [2, 1], CLAMP) // start nearly flat
  const speak = interpolate(frame, [40, 150, 300, 430], [0.18, 1, 1, 0.5], CLAMP)
  const pulse = 1 + 0.18 * Math.sin(frame / 7) // continuous breathing energy
  const ampBase = (height * 0.16) / wake
  const phase = frame * 0.13 // the wave scrolls continuously

  // The spectrum of flowing lines, brightest in the middle of the stack.
  const lines = SPECTRUM.map((col, i) => {
    const off = i - (SPECTRUM.length - 1) / 2
    const amp = ampBase * speak * pulse * (1 - Math.abs(off) * 0.12)
    const opacity = interpolate(frame, [0, 40], [0, 0.92 - Math.abs(off) * 0.12], CLAMP)
    return h(Path, {
      key: `w${i}`,
      d: wavePath(width, cy + off * 10, amp, phase + i * 0.5, i),
      stroke: col,
      strokeWidth: 4.5,
      opacity,
    })
  })

  // The word lifts OUT of the flow on a per-glyph wave, holds, dissolves.
  const wordOp = interpolate(frame, [150, 180, 360, 400], [0, 1, 1, 0], CLAMP)
  const word = h(
    Group,
    { key: 'word', opacity: wordOp, y: -210 },
    h(KineticText, {
      text: 'VOICE',
      fontSize: 132,
      preset: 'wave',
      stagger: 4,
      durationInFrames: 26,
      delay: 150,
      align: 'center',
      color: '#F3ECFF',
      fontFamily: 'Spectral Medium',
      fontWeight: 500,
    }),
  )

  // Bloom the bright lines + word together → luminous glow.
  return h(Group, { bloom: { sigma: 22, intensity: 2.1, threshold: 0.28 } }, ...lines, word)
}

function World({ width, height }) {
  const frame = useCurrentFrame()
  // Continuous camera life: a slow push-in + a gentle drift, never still.
  const zoom = interpolate(frame, [0, 480], [1.0, 1.16], CLAMP)
  const driftX = width / 2 + 60 * Math.sin(frame / 90)
  const driftY = height / 2 + 26 * Math.sin(frame / 130 + 1)
  return h(
    Camera,
    { focusX: driftX, focusY: driftY, zoom },
    h(Voice, { width, height }),
  )
}

function KineticBody({ width, height }) {
  const frame = useCurrentFrame()
  // A flowing, vibrant-but-dark field (more alive than the somber pilot).
  const field = [
    h(Rect, { key: 'base', x: 0, y: 0, width, height, fill: BASE }),
    h(MeshGradient, {
      key: 'mesh',
      colors: ['#2A1640', '#10243F', '#3A1A2A'],
      background: BASE,
      speed: 0.5,
      opacity: 0.5,
      seed: 11,
    }),
  ]
  return [
    ...field,
    h(World, { key: 'world', width, height }),
    h(Vignette, { key: 'vig', intensity: 0.55, innerRadius: 42, color: '#000000' }),
    h(GrainOverlay, { key: 'grain', opacity: 0.05, baseFrequency: 0.9, animate: true, animateEvery: 2 }),
  ]
}

export default function kinetic({ fps, durationInFrames, width, height }) {
  return h(
    Composition,
    { width, height, fps, durationInFrames, linear: true },
    h(KineticBody, { width, height }),
  )
}
