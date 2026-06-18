import { measureText } from '@onda-engine/components'
import {
  Composition,
  Ellipse,
  Group,
  Img,
  Path,
  Rect,
  Text,
  interpolate,
  useCurrentFrame,
} from '@onda-engine/react'
// FLOWS AGENT — shot 2C (~21–25s): the generated AD reveal. A big hero photo card
// settles in on the right (the runner/shoe ad) with the agent prompt card floating
// over its left ("Update this image using @image0"). Light-gray world (continuous
// from 2A). Media: refs/media/sprint-hero.jpg (free, commercial-ok). (ref @21-25s.)
import { createElement as h } from 'react'

const FPS = 30
const BG = '#ECECEC'
const SANS = 'IBM Plex Sans'
const MEDIA = '/Users/rodrigosilva/dev/onda-engine/refs/media' // absolute (temp frames.json base_dir)
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const easeOut = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3)
const tw = (s, sz, w) =>
  Array.from(s).reduce(
    (a, c) => a + measureText(c, sz, { fontFamily: SANS, fontWeight: w }).width,
    0,
  )

function Shot2C({ width, height }) {
  const frame = useCurrentFrame()

  // Hero ad card (measured: x960-1877 y98-961). Settles in: scale 0.92→1 + fade.
  const HX = 960,
    HY = 98,
    HW = 917,
    HH = 863
  const hp = easeOut(frame / 18)
  const hs = 0.92 + 0.08 * hp
  const hOp = interpolate(frame, [0, 12], [0, 1], CLAMP)
  const hcx = HX + HW / 2,
    hcy = HY + HH / 2
  const hero = h(
    Group,
    { key: 'hero', opacity: hOp, scaleX: hs, scaleY: hs, originX: hcx, originY: hcy },
    h(Img, {
      src: `${MEDIA}/sprint-hero.jpg`,
      x: HX,
      y: HY,
      width: HW,
      height: HH,
      fit: 'cover',
      clip: { type: 'rect', width: HW, height: HH, cornerRadius: 22 },
      shadow: { color: '#00000033', blur: 60, offsetY: 22 },
    }),
  )

  // Floating prompt card (upper-left, overlapping the hero). Fades in just after.
  const PX = 270,
    PY = 150,
    PW = 760,
    PH = 250 // overlaps the hero's left edge (ref layering)
  const pOp = interpolate(frame, [10, 24], [0, 1], CLAMP)
  const headerW = tw('Flows Agent', 26, 600)
  const prompt = h(
    Group,
    { key: 'prompt', opacity: pOp },
    h(Rect, {
      x: PX,
      y: PY,
      width: PW,
      height: PH,
      cornerRadius: 24,
      fill: '#FFFFFF',
      shadow: { color: '#00000026', blur: 46, offsetY: 14 },
    }),
    h(
      Text,
      { x: PX + 40, y: PY + 24, fontSize: 26, fontFamily: SANS, fontWeight: 600, color: '#1A1A1A' },
      'Flows Agent',
    ),
    h(Ellipse, { x: PX + 40 + headerW + 14, y: PY + 33, width: 14, height: 14, fill: '#36C24A' }),
    // input field with the prompt + a tiny shoe thumbnail
    h(Rect, {
      x: PX + 34,
      y: PY + 78,
      width: PW - 68,
      height: 64,
      cornerRadius: 14,
      fill: '#F2F1EF',
    }),
    h(Img, {
      src: `${MEDIA}/shoe-run.jpg`,
      x: PX + 48,
      y: PY + 90,
      width: 40,
      height: 40,
      fit: 'cover',
      clip: { type: 'rect', width: 40, height: 40, cornerRadius: 8 },
    }),
    h(
      Text,
      {
        x: PX + 102,
        y: PY + 100,
        fontSize: 18,
        fontFamily: SANS,
        fontWeight: 400,
        color: '#3C3C3C',
      },
      'Update this image using @image0',
    ),
    // buttons bottom-right
    h(
      Text,
      {
        x: PX + PW - 120,
        y: PY + PH - 44,
        fontSize: 26,
        fontFamily: SANS,
        fontWeight: 400,
        color: '#9C9C9C',
      },
      '+',
    ),
    h(Ellipse, { x: PX + PW - 86, y: PY + PH - 58, width: 46, height: 46, fill: '#ECECEC' }),
    h(Path, {
      x: PX + PW - 63,
      y: PY + PH - 35,
      d: 'M 0 8 L 0 -8 M -5.5 -2.5 L 0 -8 L 5.5 -2.5',
      stroke: '#3A3A3A',
      strokeWidth: 2.4,
      strokeCap: 'round',
      strokeJoin: 'round',
    }),
  )

  return h(
    Group,
    { grain: { intensity: 0.035, size: 1.1, seed: frame } },
    h(Rect, { x: 0, y: 0, width, height, fill: BG }),
    hero,
    prompt,
  )
}

export default function flowsShot2C({ fps, durationInFrames, width, height }) {
  return h(
    Composition,
    { width, height, fps, durationInFrames, linear: true },
    h(Shot2C, { width, height }),
  )
}
