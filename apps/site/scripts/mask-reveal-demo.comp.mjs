import { MaskReveal } from '@onda-engine/components'
import {
  Composition,
  Easing,
  Group,
  Rect,
  Sequence,
  Text,
  clipRect,
  interpolate,
  linearGradient,
  useCurrentFrame,
} from '@onda-engine/react'
// mask-reveal-demo.comp.mjs — four text MASK / REVEAL techniques in one video,
// the moves motion designers reach for (clip wipe, mask-up, track matte, animated
// clip). Pure @onda-engine/react + @onda-engine/components — proof the engine does this today.
//
//   node apps/site/scripts/render-comp.mjs --comp apps/site/scripts/mask-reveal-demo.comp.mjs \
//        --out /tmp/onda-mask-reveal.mp4 --width 1280 --height 720 --fps 30 --backend vello --no-build
import { createElement as h } from 'react'

const ACCENT = '#6ea8ff'
const INK = '#f4f1ec'
const DIM = '#8a93b2'

// Full-frame premium dark backdrop (one world across every example).
function Bg({ width, height }) {
  return h(Rect, {
    width,
    height,
    gradient: linearGradient(
      [0, 0],
      [0, height],
      [
        { offset: 0, color: '#070b1a' },
        { offset: 1, color: '#161a33' },
      ],
    ),
  })
}

// Top caption: an accent number + the technique name, fades in.
function Label({ n, text }) {
  const f = useCurrentFrame()
  const o = interpolate(f, [2, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return h(
    Group,
    { opacity: o },
    h(Text, { x: 84, y: 96, fontSize: 34, fontWeight: 800, color: ACCENT }, String(n)),
    h(Text, { x: 124, y: 96, fontSize: 26, fontWeight: 600, color: DIM, letterSpacing: 1 }, text),
  )
}

// Intro subtitle under the masked title.
function Subtitle({ width, height }) {
  const f = useCurrentFrame()
  const o = interpolate(f, [22, 40], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return h(
    Group,
    { opacity: o },
    h(
      Text,
      {
        x: width / 2 - 215,
        y: height / 2 + 86,
        fontSize: 28,
        fontWeight: 500,
        color: DIM,
        letterSpacing: 4,
      },
      'FOUR WAYS  ·  ONE ENGINE',
    ),
  )
}

// Example 3 — TRACK MATTE: a vibrant gradient flows THROUGH the letters (the
// "media-through-type" move). content = a moving gradient; matte = giant type.
function MatteDemo({ width, height }) {
  const f = useCurrentFrame()
  const shift = interpolate(f, [0, 95], [0, -width], { extrapolateRight: 'clamp' })
  const grad = h(
    Group,
    { x: shift },
    h(Rect, {
      x: 0,
      y: 0,
      width: width * 2,
      height,
      gradient: linearGradient(
        [0, 0],
        [width * 2, 0],
        [
          { offset: 0, color: '#ff6b6b' },
          { offset: 0.33, color: '#feca57' },
          { offset: 0.66, color: '#48dbfb' },
          { offset: 1, color: '#ff9ff3' },
        ],
      ),
    }),
  )
  const stencil = h(
    Text,
    { x: width / 2 - 255, y: height / 2 - 95, fontSize: 230, fontWeight: 900, color: '#ffffff' },
    'ONDA',
  )
  return h(Group, { matte: stencil, matteMode: 'alpha' }, grad)
}

// Example 4 — ANIMATED CLIP with a line riding the reveal edge (the AE trick:
// a clip rect grows 0→full while a bright line sits on the moving edge).
function LineReveal({ width, height }) {
  const f = useCurrentFrame()
  const boxW = 560
  const boxH = 210
  const p = interpolate(f, [8, 48], [0, 1], {
    easing: Easing.easeInOutCubic,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const w = Math.max(1, Math.round(boxW * p))
  const ox = Math.round((width - boxW) / 2)
  const oy = Math.round((height - boxH) / 2)
  const txt = h(Text, { x: 0, y: 40, fontSize: 150, fontWeight: 800, color: INK }, 'DRAW')
  const clipped = h(Group, { clip: clipRect(w, boxH) }, txt)
  const line =
    p < 0.995 ? h(Rect, { x: w - 3, y: -8, width: 6, height: boxH + 16, fill: ACCENT }) : null
  return h(Group, { x: ox, y: oy }, clipped, line)
}

export default function maskRevealDemo({ fps, width, height }) {
  const INTRO = 55
  const SEG = 95
  const TOTAL = INTRO + SEG * 4
  const seq = (from, dur, ...kids) => h(Sequence, { from, durationInFrames: dur }, ...kids)

  return h(
    Composition,
    { width, height, fps, durationInFrames: TOTAL, linear: false },
    h(Bg, { width, height }),
    // Intro — the title reveals itself with a mask (meta).
    seq(
      0,
      INTRO,
      h(MaskReveal, {
        text: 'MASK & REVEAL',
        direction: 'left',
        fontSize: 96,
        duration: 32,
        color: INK,
        fontWeight: 800,
      }),
      h(Subtitle, { width, height }),
    ),
    // 1 — hard-edge clip wipe (left)
    seq(
      INTRO,
      SEG,
      h(Label, { n: 1, text: 'MASK REVEAL · hard-edge clip wipe' }),
      h(MaskReveal, {
        text: 'REVEAL',
        direction: 'left',
        fontSize: 158,
        duration: 40,
        color: INK,
        fontWeight: 800,
      }),
    ),
    // 2 — mask up (rise from behind the mask)
    seq(
      INTRO + SEG,
      SEG,
      h(Label, { n: 2, text: 'MASK UP · text rises from behind the mask' }),
      h(MaskReveal, {
        text: 'RISING',
        direction: 'bottom',
        fontSize: 158,
        duration: 42,
        color: INK,
        fontWeight: 800,
      }),
    ),
    // 3 — track matte (image through type)
    seq(
      INTRO + SEG * 2,
      SEG,
      h(Label, { n: 3, text: 'TRACK MATTE · image revealed through type' }),
      h(MatteDemo, { width, height }),
    ),
    // 4 — animated clip + a line drawing the text in
    seq(
      INTRO + SEG * 3,
      SEG,
      h(Label, { n: 4, text: 'ANIMATED CLIP · a line draws the text in' }),
      h(LineReveal, { width, height }),
    ),
  )
}
