import { measureText } from '@onda/components'
import {
  AbsoluteFill,
  Composition,
  Ellipse,
  Group,
  Path,
  Rect,
  Text,
  fbmGradient,
  interpolate,
  useCurrentFrame,
} from '@onda/react'
// FLOWS AGENT — replication, shot 1 (0–6.3s). v3: title "Flows Agent" (together,
// title-case), FADE-IN TYPING (each glyph fades in as it types, with a cursor),
// bigger card matching the reference crop. Cloud palette sampled via palettegen.
import { createElement as h } from 'react'

const FPS = 30
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
const SANS = 'IBM Plex Sans'
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
// Memoized shaped char widths (don't re-measure the same glyph every frame).
const _mw = new Map()
const mw = (ch, size, weight) => {
  const k = `${ch}|${size}|${weight}`
  let v = _mw.get(k)
  if (v === undefined) {
    v = measureText(ch, size, { fontFamily: SANS, fontWeight: weight }).width
    _mw.set(k, v)
  }
  return v
}
const textWidth = (str, size, weight) =>
  Array.from(str).reduce((s, ch) => s + mw(ch, size, weight), 0)

const CLOUD = [
  { offset: 0.0, color: '#A6321A' }, // deeper saturated red-orange (less washed)
  { offset: 0.26, color: '#D9531C' },
  { offset: 0.5, color: '#E8732B' },
  { offset: 0.72, color: '#ECA163' },
  { offset: 0.88, color: '#E9D2BB' },
  { offset: 1.0, color: '#EFEFEF' },
]

// Fade-in typewriter: glyph i begins fading at start + i*charFrames, over fadeFrames;
// a caret blinks at the typed edge. `leftX` is the baseline-left anchor (or centered).
function FadeType({
  text,
  leftX,
  baselineY,
  size,
  weight = 400,
  color = '#fff',
  start = 0,
  charFrames = 2.4,
  fadeFrames = 9,
  center = false,
  canvasW = 0,
  cursor = true,
}) {
  const frame = useCurrentFrame()
  const lf = frame - start
  const chars = Array.from(text)
  const x0 = center ? Math.round((canvasW - textWidth(text, size, weight)) / 2) : leftX
  const nodes = []
  let cx = 0
  let edge = 0
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    const w = mw(ch, size, weight)
    const op = clamp((lf - i * charFrames) / fadeFrames, 0, 1)
    if (op > 0.002 && ch !== ' ') {
      nodes.push(
        h(
          Text,
          {
            key: i,
            x: x0 + cx,
            y: baselineY,
            fontSize: size,
            fontFamily: SANS,
            fontWeight: weight,
            color,
            opacity: op,
          },
          ch,
        ),
      )
    }
    if (op > 0.5) edge = cx + w
    cx += w
  }
  if (cursor && lf > 0) {
    const blink = lf % 28 < 16 ? 0.95 : 0.12
    // Render the caret as a glyph at the SAME baseline as the text so it sits
    // INLINE beside the last letter (a Rect floated above — wrong baseline).
    nodes.push(
      h(
        Text,
        {
          key: 'caret',
          x: x0 + edge + 1,
          y: baselineY,
          fontSize: size,
          fontFamily: SANS,
          fontWeight: weight,
          color,
          opacity: blink,
        },
        '|',
      ),
    )
  }
  return h(Group, { key: 'ft' }, ...nodes)
}

function Shot1({ width, height }) {
  const frame = useCurrentFrame()
  const t = frame / FPS

  const field = h(Rect, {
    key: 'cloud',
    x: 0,
    y: 0,
    width,
    height,
    gradient: fbmGradient(CLOUD, { scale: 0.42, warp: 0.6, time: t * 0.06 }),
  })

  // Title "Flows Agent" — TYPES in (typewriter ~2f/char) + a cursor, held; the card
  // then grows out of the cursor gap and COVERS it (ref @0.3–1.9s, native-fps read).
  const TSIZE = 52
  const title = h(
    Group,
    { key: 'title' },
    h(FadeType, {
      text: 'Flows Agent',
      size: TSIZE,
      weight: 400,
      color: '#FBF7F2',
      start: 8,
      charFrames: 2,
      fadeFrames: 3,
      center: true,
      canvasW: width,
      baselineY: Math.round(530 - TSIZE * 0.55),
      cursor: true,
    }),
  )

  // Prompt card — BORN as a small rounded square at the cursor gap (center) and
  // grows SQUARE→WIDE (height fills fast, width keeps going), covering the title.
  const GROW = 50 // t≈1.68s — the box is born at the cursor gap
  const easeOut = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3)
  const easeInOut = (x) => {
    const c = clamp(x, 0, 1)
    return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2
  }
  // MEASURED from the reference (element detection): 898×253, centred at (960,530).
  const CW = 898
  const CH = 253
  const cxC = width / 2
  const cyC = 530
  // Width eases IN (slow start) so the box stays a small square before it stretches
  // wide; height eases OUT (fills first). Square → wide, from the centre gap.
  const W = 80 + (CW - 80) * easeInOut((frame - GROW) / 30)
  const Hh = 80 + (CH - 80) * easeOut((frame - GROW) / 15)
  const BX = Math.round(cxC - W / 2)
  const BY = Math.round(cyC - Hh / 2)
  const cardOp = interpolate(frame, [GROW, GROW + 6], [0, 1], CLAMP)
  const contentOp = interpolate(frame, [GROW + 26, GROW + 36], [0, 1], CLAMP)
  const CX = Math.round(cxC - CW / 2) // 511
  const CY = Math.round(cyC - CH / 2) // 404
  const headerW = textWidth('Flows Agent', 28, 600)
  const TYPE_START = GROW + 40
  // measured spacing: pad-left 54, pad-right 18, field below header, buttons bottom-right
  const FX = CX + 54
  const FW = CW - 54 - 18
  const FY = CY + 74 // measured: field top at card-top+74
  const FH = 72 // measured: field height 72 (text then centres via FY+FH/2)
  const card = h(
    Group,
    { key: 'card', opacity: cardOp },
    h(Rect, {
      x: BX,
      y: BY,
      width: W,
      height: Hh,
      cornerRadius: Math.min(26, Hh / 2),
      fill: '#FFFFFF',
      shadow: { color: '#00000026', blur: 50, offsetY: 16 },
    }),
    h(
      Group,
      { opacity: contentOp },
      // header (measured: top +28, left +54) + green status dot right of it
      h(
        Text,
        {
          x: CX + 54,
          y: CY + 24,
          fontSize: 28,
          fontFamily: SANS,
          fontWeight: 600,
          color: '#1A1A1A',
        },
        'Flows Agent',
      ),
      h(Ellipse, { x: CX + 54 + headerW + 12, y: CY + 33, width: 15, height: 15, fill: '#36C24A' }),
      // input field (measured pads) + text vertically centred in it
      h(Rect, { x: FX, y: FY, width: FW, height: FH, cornerRadius: 16, fill: '#F2F1EF' }),
      h(FadeType, {
        text: '10-second product ad for these running shoes.',
        leftX: FX + 22,
        baselineY: FY + FH / 2 - 10,
        size: 19,
        weight: 400,
        color: '#3C3C3C',
        start: TYPE_START,
        charFrames: 1.7,
        fadeFrames: 8,
        cursor: true,
      }),
      // buttons bottom-right (measured: arrow right edge 43px from card edge, centre y ~CY+196)
      h(
        Text,
        {
          x: CX + CW - 126,
          y: CY + 184,
          fontSize: 28,
          fontFamily: SANS,
          fontWeight: 400,
          color: '#9C9C9C',
        },
        '+',
      ),
      h(Ellipse, { x: CX + CW - 93, y: CY + 171, width: 50, height: 50, fill: '#ECECEC' }),
      h(Path, {
        x: CX + CW - 68,
        y: CY + 196,
        d: 'M 0 9 L 0 -9 M -6 -3 L 0 -9 L 6 -3',
        stroke: '#3A3A3A',
        strokeWidth: 2.6,
        strokeCap: 'round',
        strokeJoin: 'round',
      }),
    ),
  )

  return h(Group, { grain: { intensity: 0.05, size: 1.1, seed: frame } }, field, title, card)
}

export default function flowsShot1({ fps, durationInFrames, width, height }) {
  return h(
    Composition,
    { width, height, fps, durationInFrames, linear: true },
    h(Shot1, { width, height }),
  )
}
