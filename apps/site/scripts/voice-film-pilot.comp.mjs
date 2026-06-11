// THE LONG NOTE — pilot (opening ~75s, Chapter 1 + into Chapter 2).
// Soft dark gradient-field; words-on-screen as narration; cut to an implied breath
// tempo (no audio). Built from techspecs/voice-film-the-long-note.md.
//
// Render (native export is the hero deliverable):
//   node apps/site/scripts/render-comp.mjs --comp ./apps/site/scripts/voice-film-pilot.comp.mjs \
//     --width 1920 --height 1080 --fps 30 --duration 2250 --motion-blur 8 \
//     --font apps/site/public/fonts/Spectral-Light.ttf \
//     --font apps/site/public/fonts/Spectral-Regular.ttf \
//     --font apps/site/public/fonts/Spectral-Medium.ttf --out /tmp/long-note-pilot.mp4
import { createElement as h } from 'react'
import {
  Composition,
  Sequence,
  AbsoluteFill,
  Group,
  Text,
  Rect,
  interpolate,
  useCurrentFrame,
} from '@onda/react'
import { MeshGradient, GrainOverlay, Vignette, Spotlight } from '@onda/components'

const FPS = 30
// --- Palette (from the treatment) ---
const BASE = '#08070C' // near-black room
const COLD = ['#141A36', '#221C44'] // Ch1 deep blue-violet blobs
const WARM = ['#3A2A1E', '#4A3220'] // amber warmth rising into Ch2
const TYPE = '#EDE6DA' // bone-white spoken word (never pure #fff)
const AMBER = '#C9A26B' // the single reactive light on "here."
const SERIF_L = 'Spectral Light' // 300 — whisper / fragile
const SERIF = 'Spectral' // 400 — body of the narration
const SERIF_M = 'Spectral Medium' // 500 — the rare load-bearing word

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
const sec = (s) => Math.round(s * FPS)

// A breath-cadence line: focus-pull IN (blur→sharp + small rise) → breathing HOLD
// → fade OUT on the exhale. Centered by the layout pass (AbsoluteFill); the motion
// rides a nested Group so the layout child isn't translated.
function Line({
  text,
  size = 56,
  family = SERIF,
  color = TYPE,
  ls = 0,
  tIn = 24,
  hold = 150,
  tOut = 26,
  fromBlur = 10,
  rise = 9,
}) {
  const f = useCurrentFrame()
  const holdEnd = tIn + hold
  const outEnd = holdEnd + tOut
  const opacity = interpolate(f, [0, tIn, holdEnd, outEnd], [0, 1, 1, 0], CLAMP)
  const blur = interpolate(f, [0, tIn], [fromBlur, 0], CLAMP)
  const y = interpolate(f, [0, tIn], [rise, 0], CLAMP)
  // micro-motion so a held line is never frozen: a ~0.6% breath + 1px drift.
  const breath = 1 + 0.006 * Math.sin((f / FPS) * ((Math.PI * 2) / 8))
  const drift = interpolate(f, [tIn, outEnd], [0, -1.5], CLAMP)
  return h(
    AbsoluteFill,
    { justify: 'center', align: 'center' },
    h(
      Group,
      { y: y + drift, blur, opacity, scaleX: breath, scaleY: breath },
      h(Text, { fontSize: size, color, fontFamily: family, fontWeight: 400, letterSpacing: ls }, text),
    ),
  )
}

// place(line, startSeconds) → a Sequence that scopes the line's local frame.
function place(node, startS, lifeFrames) {
  return h(Sequence, { from: sec(startS), durationInFrames: lifeFrames, key: `s${startS}` }, node)
}

function PilotBody({ width, height }) {
  const frame = useCurrentFrame()

  // The field warms from cold blue-violet toward amber as Ch1 exhales into Ch2.
  const warm = interpolate(frame, [sec(50), sec(66)], [0, 0.24], CLAMP)

  const field = [
    h(Rect, { key: 'base', x: 0, y: 0, width, height, fill: BASE }),
    h(MeshGradient, { key: 'cold', colors: COLD, background: BASE, speed: 0.15, opacity: 0.5, seed: 7 }),
    h(Group, { key: 'warm', opacity: warm }, h(MeshGradient, { colors: WARM, background: BASE, speed: 0.12, opacity: 1, seed: 3 })),
  ]

  // Ch1 — "Before The Word" → into Ch2's first two lines (the pilot ends mid-Ch2).
  const lines = [
    place(h(Line, { text: 'Before your name.', size: 38, family: SERIF_L, ls: 1.2 }), 6, sec(7)),
    place(h(Line, { text: "Before a single word you'd keep.", size: 38, family: SERIF_L, ls: 1.0 }), 12.5, sec(8)),
    place(h(Line, { text: 'There was a sound you made', size: 46, family: SERIF }), 20.5, sec(8.5)),
    place(h(Line, { text: 'that meant only:', size: 46, family: SERIF, hold: 120 }), 29, sec(6)),
    place(h(Line, { text: 'here.', size: 72, family: SERIF_M, hold: 130 }), 35.5, sec(7.5)),
    place(h(Line, { text: "I'm here.", size: 72, family: SERIF_M, hold: 120 }), 43.5, sec(7)),
    place(h(Line, { text: 'Then one day the sound had edges.', size: 50, family: SERIF }), 57.5, sec(8)),
    place(h(Line, { text: 'A shape your mouth had been practicing in the dark.', size: 50, family: SERIF, hold: 150 }), 65.5, sec(9)),
  ]

  // The single reactive light: one soft amber bloom behind "here.", then it recedes.
  const pulseFrom = sec(35.5)
  const pulseLife = sec(8)
  const spotlight = h(
    Sequence,
    { from: pulseFrom, durationInFrames: pulseLife, key: 'spot' },
    h(SpotlightPulse, null),
  )

  return [
    ...field,
    ...lines,
    spotlight,
    h(Vignette, { key: 'vig', intensity: 0.62, innerRadius: 38, color: '#000000' }),
    h(GrainOverlay, { key: 'grain', opacity: 0.06, baseFrequency: 0.9, numOctaves: 1, animate: true, animateEvery: 2 }),
  ]
}

// A bloom that rises and recedes (Spotlight only reveals; the opacity envelope pulses).
function SpotlightPulse() {
  const f = useCurrentFrame()
  const op = interpolate(f, [0, 36, 96, 200], [0, 0.9, 0.55, 0], CLAMP)
  return h(
    Group,
    { opacity: op },
    h(Spotlight, { x: 0.5, y: 0.5, radius: 30, softness: 88, color: AMBER, durationInFrames: 40 }),
  )
}

export default function pilot({ fps, durationInFrames, width, height }) {
  return h(
    Composition,
    { width, height, fps, durationInFrames, linear: true },
    h(PilotBody, { width, height }),
  )
}
