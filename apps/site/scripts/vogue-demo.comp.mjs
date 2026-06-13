// vogue-demo.comp.mjs — text-behind-subject demo: VOGUE masthead behind the
// model, magazine-style. Three layers: original photo → masthead type → the
// onda-segment cutout back on top (so the letters pass behind her).
import { writeFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { Composition, Group, Image, Text, renderFrame } from '@onda/react'

const W = 768
const H = 1376
const PHOTO = '/Users/rodrigosilva/.claude/image-cache/d9cf3d78-ddff-4c69-b77e-eb2e47215ae4/1.png'
const CUTOUT = '/tmp/vogue-cutout.png'

const scene = h(
  Group,
  null,
  // 1) the original photo, untouched — backdrop AND subject.
  h(Image, { src: PHOTO, x: 0, y: 0, width: W, height: H, fit: 'cover' }),
  // 2) the masthead — hot pink pulled from the tennis balls, Didot like the
  //    real thing, spanning the width so her head covers the lower middle.
  h(Text, {
    x: 24,
    y: 78,
    fontSize: 186,
    fontFamily: 'Didot',
    fontWeight: 700,
    letterSpacing: 0,
    color: '#ee3d8f',
  }, 'VOGUE'),
  // 3) the cutout — re-covers the letters exactly where she is.
  h(Image, { src: CUTOUT, x: 0, y: 0, width: W, height: H, fit: 'cover' }),
)

const comp = h(Composition, { width: W, height: H, fps: 30, durationInFrames: 30 }, scene)
writeFileSync('/tmp/vogue.json', JSON.stringify(renderFrame(comp, 0)))
console.log('scene → /tmp/vogue.json')
