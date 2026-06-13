import { MaskReveal } from '@onda/components'
import {
  Composition,
  Easing,
  Group,
  Image,
  Rect,
  Sequence,
  Text,
  interpolate,
  linearGradient,
  useCurrentFrame,
} from '@onda/react'
// mask-images.comp.mjs — the two IMAGE-based reveals that read clearly: a photo
// revealed THROUGH type (track matte), and text BEHIND a person (a cutout layered
// over the type). Real assets, native render. PERSON/PERSON_W/PERSON_H overridable
// via env so an auto-segmented cutout can be swapped in.
import { createElement as h } from 'react'

const A = '/Users/rodrigosilva/.claude/jobs/0e96360d/tmp/assets'
const FJORD = `${A}/scenic2.jpg`
const PERSON = process.env.PERSON || `${A}/nwu.png`
const PERSON_W = Number(process.env.PERSON_W || 588)
const PERSON_H = Number(process.env.PERSON_H || 1828)

const ACCENT = '#6ea8ff'
const INK = '#f4f1ec'
const DIM = '#9aa3c2'

function DarkBg({ width, height }) {
  return h(Rect, { width, height, fill: '#05060d' })
}

function Label({ n, text }) {
  const f = useCurrentFrame()
  const o = interpolate(f, [3, 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return h(
    Group,
    { opacity: o },
    h(Text, { x: 84, y: 92, fontSize: 34, fontWeight: 800, color: ACCENT }, String(n)),
    h(Text, { x: 124, y: 92, fontSize: 25, fontWeight: 600, color: DIM, letterSpacing: 1 }, text),
  )
}

// 1 — TRACK MATTE: the fjord photo revealed only through the letters of ONDA,
// with a slow ken-burns push so it reads as moving footage inside the type.
function FjordMatte({ width, height }) {
  const f = useCurrentFrame()
  const s = interpolate(f, [0, 150], [1.05, 1.18], { extrapolateRight: 'clamp' })
  const img = h(Image, {
    src: FJORD,
    x: 0,
    y: 0,
    width,
    height,
    fit: 'cover',
    scaleX: s,
    scaleY: s,
    originX: width / 2,
    originY: height / 2,
  })
  const stencil = h(
    Text,
    { x: width / 2 - 350, y: height / 2 - 130, fontSize: 250, fontWeight: 900, color: '#ffffff' },
    'ONDA',
  )
  return h(Group, { matte: stencil, matteMode: 'alpha' }, img)
}

// 2 — TEXT BEHIND SUBJECT: a soft backdrop, big word, then the person cutout on
// TOP (later sibling = in front), so the type passes behind the figure. The word
// rises up into place behind them.
function BehindPerson({ width, height }) {
  const f = useCurrentFrame()
  const rise = interpolate(f, [6, 42], [80, 0], {
    easing: Easing.easeOutCubic,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const o = interpolate(f, [6, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const bg = h(Rect, {
    width,
    height,
    gradient: linearGradient(
      [0, 0],
      [width, height],
      [
        { offset: 0, color: '#10203a' },
        { offset: 1, color: '#06070f' },
      ],
    ),
  })
  const word = h(
    Group,
    { y: rise, opacity: o },
    h(
      Text,
      {
        x: width / 2 - 330,
        y: height / 2 - 60,
        fontSize: 210,
        fontWeight: 900,
        color: INK,
        letterSpacing: 4,
      },
      'BEHIND',
    ),
  )
  const ph = 620
  const pw = Math.round(PERSON_W * (ph / PERSON_H))
  const person = h(Image, {
    src: PERSON,
    x: Math.round((width - pw) / 2),
    y: height - ph,
    width: pw,
    height: ph,
    fit: 'contain',
  })
  return h(Group, {}, bg, word, person)
}

export default function maskRevealImages({ fps, width, height }) {
  const INTRO = 48
  const SEG = 150
  const TOTAL = INTRO + SEG * 2
  const seq = (from, dur, ...kids) => h(Sequence, { from, durationInFrames: dur }, ...kids)
  return h(
    Composition,
    { width, height, fps, durationInFrames: TOTAL, linear: false },
    h(DarkBg, { width, height }),
    seq(
      0,
      INTRO,
      h(MaskReveal, {
        text: 'REVEAL · WITH IMAGES',
        direction: 'left',
        fontSize: 72,
        duration: 32,
        color: INK,
        fontWeight: 800,
      }),
    ),
    seq(
      INTRO,
      SEG,
      h(FjordMatte, { width, height }),
      h(Label, { n: 1, text: 'TRACK MATTE · a photo revealed through the type' }),
    ),
    seq(
      INTRO + SEG,
      SEG,
      h(BehindPerson, { width, height }),
      h(Label, { n: 2, text: 'TEXT BEHIND SUBJECT · the person sits in front of the type' }),
    ),
  )
}
