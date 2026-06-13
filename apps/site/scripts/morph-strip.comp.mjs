import { Composition, Path, Rect, morphPath } from '@onda/react'
// morph-strip.comp.mjs — a single-frame strip of morphPath stages (the magic move):
// a circle continuously morphing into a 4-point star, sampled at 5 t-values.
import { createElement as h } from 'react'

const W = 1280
const H = 720
const GOLD = '#e8b074'
const CIRCLE = 'M -42 0 A 42 42 0 1 1 42 0 A 42 42 0 1 1 -42 0 Z'
const RULE = 'M -56 -5 L 56 -5 L 56 5 L -56 5 Z'

function Strip() {
  const stages = [0, 0.25, 0.5, 0.75, 1]
  return [
    h(Rect, { key: 'bg', width: W, height: H, fill: '#0a0a12' }),
    ...stages.map((t, i) =>
      h(Path, {
        key: `s${i}`,
        x: Math.round((W / (stages.length + 1)) * (i + 1)),
        y: Math.round(H / 2),
        d: morphPath(CIRCLE, RULE, t),
        fill: GOLD,
        opacity: 0.92,
        shadow: { color: GOLD, blur: 14 },
      }),
    ),
  ]
}

export default function morphStrip({ fps, durationInFrames, width, height }) {
  return h(Composition, { width, height, fps, durationInFrames }, h(Strip, null))
}
