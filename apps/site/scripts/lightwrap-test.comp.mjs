import { Composition, Path, Rect, fbmGradient } from '@onda-engine/react'
// lightwrap-test.comp.mjs — a synthetic proof for the LightWrap effect: a bright,
// colorful fBm backdrop with a dark subject cut-out over it. With light-wrap ON the
// subject's edges pick up the background light (reads "shot in"); OFF it's a flat
// dark silhouette pasted on top. Toggle with LW=off in the environment.
import { createElement as h } from 'react'

const ON = process.env.LW !== 'off'
const R = 300 // subject radius
const CIRCLE = `M ${-R} 0 A ${R} ${R} 0 1 1 ${R} 0 A ${R} ${R} 0 1 1 ${-R} 0 Z`

export default function lightwrapTest({ fps, durationInFrames, width, height }) {
  const bg = h(Rect, {
    width,
    height,
    gradient: fbmGradient(
      [
        { offset: 0, color: '#ff7a18' },
        { offset: 0.5, color: '#ff2d8e' },
        { offset: 1, color: '#22d3ee' },
      ],
      { scale: 0.9, warp: 0.55 },
    ),
  })
  const subject = h(Path, {
    x: width / 2,
    y: height / 2,
    d: CIRCLE,
    fill: '#0a0a12',
    ...(ON ? { lightWrap: { sigma: 30, strength: 1 } } : {}),
  })
  return h(Composition, { width, height, fps, durationInFrames, linear: true }, bg, subject)
}
