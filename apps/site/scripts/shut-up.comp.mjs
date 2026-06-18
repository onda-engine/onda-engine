import {
  Composition,
  Easing,
  Group,
  Image,
  Text,
  interpolate,
  useCurrentFrame,
} from '@onda-engine/react'
// shut-up.comp.mjs — text BEHIND the subject: original photo as the backdrop,
// big bold type, then the auto-segmented cutout on top so the type sits behind him.
import { createElement as h } from 'react'

const A = '/Users/rodrigosilva/.claude/jobs/0e96360d/tmp/assets'
const W = 600
const H = 400

function Scene() {
  const f = useCurrentFrame()
  // type scales/fades up into place behind him
  const s = interpolate(f, [0, 18], [0.86, 1], {
    easing: Easing.easeOutCubic,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const o = interpolate(f, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return h(
    Group,
    {},
    // 1) original photo (keeps the podium + white room)
    h(Image, { src: `${A}/suit.png`, x: 0, y: 0, width: W, height: H, fit: 'cover' }),
    // 2) the big type — BEHIND him, at head/shoulder height against the white
    //    backdrop so his head visibly occludes the end (black-on-white reads;
    //    black-on-his-black-suit would vanish).
    h(
      Group,
      { opacity: o, scaleX: s, scaleY: s, originX: 170, originY: 210 },
      h(
        Text,
        { x: 20, y: 150, fontSize: 132, fontWeight: 900, color: '#0f1216', letterSpacing: -4 },
        'SHUT',
      ),
      h(
        Text,
        { x: 20, y: 292, fontSize: 132, fontWeight: 900, color: '#0f1216', letterSpacing: -4 },
        'UP',
      ),
    ),
    // 3) the cutout on top → the type passes behind the subject
    //    (suit_native_cut.png = produced by the native `onda segment` CLI, no Python)
    h(Image, { src: `${A}/suit_native_cut.png`, x: 0, y: 0, width: W, height: H, fit: 'cover' }),
  )
}

export default function shutUp({ fps }) {
  return h(
    Composition,
    { width: W, height: H, fps, durationInFrames: 40, linear: false },
    h(Scene, null),
  )
}
