import { writeFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { Composition, Group, Rect, Ellipse, Text, linearGradient, renderFrame } from '@onda/react'
const OUT = '/Users/rodrigosilva/.claude/jobs/0e96360d/tmp/fx'
// Bright accents on near-black — NO per-node bloom; the FINISH carries the bloom.
const lightScene = () => h(Group, null,
  h(Rect, { width: 900, height: 500, fill: '#050507' }),
  h(Ellipse, { x: 150, y: 170, width: 150, height: 150, fill: '#ffe7c0' }),
  h(Ellipse, { x: 470, y: 150, width: 120, height: 120, fill: '#ff4d8d' }),
  h(Text, { x: 120, y: 330, fontSize: 120, color: '#ffd36b', fontWeight: 800, letterSpacing: -4 }, 'LIGHT'),
)
const flatScene = () => h(Group, null,
  h(Rect, { width: 900, height: 500, gradient: linearGradient([0,0],[900,500],[{offset:0,color:'#ff8a3d'},{offset:0.5,color:'#ffd36b'},{offset:1,color:'#fff4d6'}]) }),
  h(Ellipse, { x: 600, y: 90, width: 240, height: 240, fill: '#ffffff' }),
  h(Text, { x: 70, y: 360, fontSize: 96, color: '#3a1500', fontWeight: 800, letterSpacing: -3 }, 'GOLDEN'),
)
const cases = {
  'finish-bloom': [lightScene(), { bloom: { sigma: 16, threshold: 0.2, intensity: 2.2 }, halation: 0.6 }],
  'finish-flat-nobloom': [flatScene(), { exposure: 1.3 }],
}
for (const [name, [el, finish]] of Object.entries(cases)) {
  const comp = h(Composition, { width: 900, height: 500, fps: 30, durationInFrames: 30, finish }, el)
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify(renderFrame(comp, 14)))
}
console.log('finish carried:', JSON.stringify(JSON.parse(require('node:fs').readFileSync(`${OUT}/finish-bloom.json`)).composition.finish))
