// brand-grid.comp.mjs — the "On-brand, automatically" tile.
//
// Six DIFFERENT videos (different headline + scene tint) all wearing the SAME
// brand: the coral mark, the "acme" wordmark, the type, the accent bar — identical
// on every card. Rendered natively so the brand is pixel-consistent across all six
// (the thing an AI generator can't keep straight). 4:3 to fill the tile uncropped.
//
//   node apps/site/scripts/render-comp.mjs --comp apps/site/scripts/brand-grid.comp.mjs \
//     --width 1440 --height 1080 --frame 0 --out /tmp/onda-gen/brand-grid.png \
//     --font apps/site/public/fonts/BricolageGrotesque96pt-Bold.ttf \
//     --font apps/site/public/fonts/BricolageGrotesque96pt-SemiBold.ttf \
//     --font apps/site/public/fonts/BricolageGrotesque96pt-Medium.ttf

import {
  Composition,
  Path,
  Rect,
  Text,
  fbmGradient,
  linearGradient,
  radialGradient,
} from '@onda/react'
import { createElement as h } from 'react'

const FONT = 'Bricolage Grotesque 96pt'
const INK = '#f4f1ff'
const MUTED = '#b4adc6'
const CORAL = '#ec6a4d' // the brand color — identical on every card

// Each card: a different "video" (headline + scene tint), same brand overlay.
const CARDS = [
  { head: 'Q4 recap', bg: ['#10183a', '#0a0f22'] },
  { head: 'New drop', bg: ['#261435', '#160d22'] },
  { head: 'How it works', bg: ['#0e2630', '#0a1820'] },
  { head: 'Meet the team', bg: ['#171138', '#0e0a22'] },
  { head: 'Spring sale', bg: ['#2c1820', '#180f16'] },
  { head: 'Field notes', bg: ['#1a1f2b', '#10131b'] },
]

function card(i, x, y, w, ht, head, bg) {
  return [
    // scene (the "video") — a dark tinted gradient, rounded, hairline border
    h(Rect, {
      key: `c${i}-bg`,
      x,
      y,
      width: w,
      height: ht,
      cornerRadius: 18,
      gradient: linearGradient(
        [x, y],
        [x, y + ht],
        [
          { offset: 0, color: bg[0] },
          { offset: 1, color: bg[1] },
        ],
      ),
      stroke: '#ffffff',
      strokeWidth: 1,
      strokeOpacity: 0.08,
    }),
    // play affordance (centered) — reads "video"
    h(Rect, {
      key: `c${i}-pc`,
      x: x + w / 2 - 33,
      y: y + ht * 0.4 - 33,
      width: 66,
      height: 66,
      cornerRadius: 33,
      fill: '#ffffff12',
      stroke: '#ffffff',
      strokeWidth: 2,
      strokeOpacity: 0.45,
    }),
    h(Path, {
      key: `c${i}-pt`,
      d: `M ${x + w / 2 - 8} ${y + ht * 0.4 - 14} L ${x + w / 2 + 18} ${y + ht * 0.4} L ${x + w / 2 - 8} ${y + ht * 0.4 + 14} Z`,
      fill: '#ffffffd9',
    }),
    // brand mark — coral square + "acme" wordmark (IDENTICAL on every card)
    h(Rect, {
      key: `c${i}-mark`,
      x: x + 26,
      y: y + 28,
      width: 18,
      height: 18,
      cornerRadius: 5,
      fill: CORAL,
    }),
    h(
      Text,
      {
        key: `c${i}-wm`,
        x: x + 54,
        y: y + 27,
        fontSize: 22,
        fontFamily: FONT,
        fontWeight: 600,
        color: INK,
      },
      'acme',
    ),
    // duration chip (top-right) — reads "video"
    h(
      Text,
      {
        key: `c${i}-dur`,
        x: x + w - 76,
        y: y + 30,
        fontSize: 17,
        fontFamily: FONT,
        fontWeight: 500,
        letterSpacing: 1,
        color: MUTED,
      },
      '0:15',
    ),
    // coral accent bar (brand element, consistent) + headline (the varying content)
    h(Rect, {
      key: `c${i}-acc`,
      x: x + 28,
      y: y + ht - 84,
      width: 46,
      height: 4,
      cornerRadius: 2,
      fill: CORAL,
    }),
    h(
      Text,
      {
        key: `c${i}-head`,
        x: x + 26,
        y: y + ht - 66,
        fontSize: 32,
        fontFamily: FONT,
        fontWeight: 700,
        color: INK,
      },
      head,
    ),
  ]
}

function Scene() {
  const W = 1440
  const H = 1080
  const margin = 70
  const gap = 36
  const cols = 3
  const rows = 2
  const cw = Math.round((W - 2 * margin - (cols - 1) * gap) / cols)
  const ch = Math.round((H - 2 * margin - (rows - 1) * gap) / rows)

  const grid = []
  CARDS.forEach((c, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = margin + col * (cw + gap)
    const y = margin + row * (ch + gap)
    grid.push(...card(i, x, y, cw, ch, c.head, c.bg))
  })

  return [
    // premium graded backdrop (shows in the gaps/margins)
    h(Rect, {
      key: 'bg',
      width: W,
      height: H,
      gradient: fbmGradient(
        [
          { offset: 0.0, color: '#08070f' },
          { offset: 0.5, color: '#0d0b1c' },
          { offset: 1.0, color: '#141026' },
        ],
        { scale: 0.85, warp: 0.4, time: 2.0 },
      ),
    }),
    ...grid,
    // vignette
    h(Rect, {
      key: 'vig',
      width: W,
      height: H,
      gradient: radialGradient([W / 2, H / 2], Math.hypot(W, H) * 0.62, [
        { offset: 0.0, color: '#00000000' },
        { offset: 0.62, color: '#00000000' },
        { offset: 1.0, color: '#04030aa0' },
      ]),
    }),
  ]
}

export default function brandGrid({ fps, durationInFrames, width, height }) {
  return h(Composition, { width, height, fps, durationInFrames }, h(Scene, null))
}
