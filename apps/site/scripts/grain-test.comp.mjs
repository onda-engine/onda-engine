import { Composition, Group, Rect, Text, linearGradient } from '@onda-engine/react'
// grain-test.comp.mjs — the grain pass on the banding-prone case: a smooth dark
// vertical gradient (the "premium dark hero") + a title. OFF, 8-bit banding stripes
// the gradient and the frame looks clean-digital; ON, grain dithers the banding and
// gives the frame a photographed texture. Toggle with GRAIN=off.
import { createElement as h } from 'react'

const ON = process.env.GRAIN !== 'off'

export default function grainTest({ fps, durationInFrames, width, height }) {
  const bg = h(Rect, {
    width,
    height,
    gradient: linearGradient(
      [0, 0],
      [0, height],
      [
        { offset: 0, color: '#05060d' },
        { offset: 1, color: '#1b1d33' },
      ],
    ),
  })
  const title = h(
    Text,
    {
      x: width / 2 - 220,
      y: height / 2 - 36,
      fontSize: 84,
      fontWeight: 800,
      color: '#f4f1ec',
      letterSpacing: 10,
    },
    'SOLENNE',
  )
  const intensity = Number(process.env.GRAIN_I ?? 0.035)
  return h(
    Composition,
    { width, height, fps, durationInFrames, linear: true },
    h(Group, ON ? { grain: { intensity, size: 1.15 } } : {}, bg, title),
  )
}
