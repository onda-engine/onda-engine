// parallax-demo.comp.mjs — photo-parallax "lite": ONE flat photo split into
// subject + background by onda-segment, separating under a slow push-in.
// Background = original scaled up + soft blur (the subject-shaped hole stays
// hidden behind the cutout at these amplitudes — no inpainting needed).
import { writeFileSync } from 'node:fs'
import {
  Composition,
  Group,
  Image,
  Text,
  interpolate,
  renderFramesJSON,
  useCurrentFrame,
} from '@onda/react'
import { createElement as h } from 'react'

const W = 768
const H = 1376
const FPS = 30
const DUR = 90 // 3s
const PHOTO = '/Users/rodrigosilva/.claude/image-cache/d9cf3d78-ddff-4c69-b77e-eb2e47215ae4/1.png'
const CUTOUT = '/tmp/vogue-cutout.png'

const ease = (f, from, to) => {
  const t = Math.min(1, Math.max(0, f / (DUR - 1)))
  const s = t * t * (3 - 2 * t) // smoothstep — gentle in/out
  return from + (to - from) * s
}

function Scene() {
  const f = useCurrentFrame()
  // Background plate: starts pre-scaled (hides the hole), grows the LEAST.
  const bg = ease(f, 1.07, 1.1)
  // Masthead lives BETWEEN the planes — drifts faster than bg, slower than her.
  const mid = ease(f, 1.02, 1.08)
  const midOpacity = ease(f, 0, 1)
  // The subject grows the MOST = reads nearest the lens.
  const fg = ease(f, 1.08, 1.16)
  const cx = W / 2
  const cy = H * 0.42 // push toward her face, not the frame centre
  return h(
    Group,
    null,
    h(
      Group,
      { scaleX: bg, scaleY: bg, originX: cx, originY: cy },
      h(Image, { src: PHOTO, x: 0, y: 0, width: W, height: H, fit: 'cover', blur: 2.2 }),
    ),
    h(
      Group,
      { scaleX: mid, scaleY: mid, originX: cx, originY: cy, opacity: midOpacity },
      h(
        Text,
        {
          x: 24,
          y: 78,
          fontSize: 186,
          fontFamily: 'Didot',
          fontWeight: 700,
          letterSpacing: 0,
          color: '#ee3d8f',
        },
        'VOGUE',
      ),
    ),
    h(
      Group,
      { scaleX: fg, scaleY: fg, originX: cx, originY: cy },
      h(Image, { src: CUTOUT, x: 0, y: 0, width: W, height: H, fit: 'cover' }),
    ),
  )
}

const comp = h(
  Composition,
  { width: W, height: H, fps: FPS, durationInFrames: DUR },
  h(Scene, null),
)
writeFileSync('/tmp/parallax-frames.json', renderFramesJSON(comp))
console.log('frames → /tmp/parallax-frames.json')
