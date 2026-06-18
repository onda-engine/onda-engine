// diff-recap.comp.mjs — the "Change one word. Not the whole video." proof frame.
//
// A DENSE, premium quarterly-recap frame (graded bg · headline · two hero stats ·
// a bar chart · brand chrome). Rendered natively by ONDA so the before/after are
// two real renders of the SAME composition — pixel-for-pixel identical except the
// ONE word that the env var changes. That density is the point: the busier the
// frame, the more striking "only the word moved".
//
// Render both:
//   RECAP_QUARTER=Q3 node apps/site/scripts/render-comp.mjs --comp apps/site/scripts/diff-recap.comp.mjs \
//     --width 1600 --height 900 --frame 0 --out /tmp/onda-gen/diff-q3.png \
//     --font apps/site/public/fonts/BricolageGrotesque96pt-ExtraBold.ttf \
//     --font apps/site/public/fonts/BricolageGrotesque96pt-Bold.ttf \
//     --font apps/site/public/fonts/BricolageGrotesque96pt-SemiBold.ttf \
//     --font apps/site/public/fonts/BricolageGrotesque96pt-Medium.ttf \
//     --font apps/site/public/fonts/BricolageGrotesque96pt-Light.ttf
//   RECAP_QUARTER=Q4 ... --out /tmp/onda-gen/diff-q4.png --no-build

import {
  Composition,
  Path,
  Rect,
  Text,
  fbmGradient,
  linearGradient,
  radialGradient,
} from '@onda-engine/react'
import { createElement as h } from 'react'

const FONT = 'Bricolage Grotesque 96pt'
const INK = '#f4f1ff'
const MUTED = '#9a93b4'
const FAINT = '#6a6488'
const ACCENT = '#a78bfa' // onda accent-soft (reads bright on dark)
const ACCENT_DEEP = '#5b21b6'
const LINE = '#ffffff'

const Q = process.env.RECAP_QUARTER || 'Q4' // the ONE thing that changes

function wavePath(W, yBase, amp, k, phase, steps) {
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * W
    const y =
      yBase + amp * Math.sin(x * k + phase) + amp * 0.4 * Math.sin(x * k * 2.3 + phase * 1.7)
    d += i === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return d
}

// A clean rising bar chart (trailing-6 series with a believable dip).
function barChart(x0, baseline, w, maxH) {
  const series = [0.34, 0.46, 0.4, 0.62, 0.8, 1.0]
  const n = series.length
  const gap = 16
  const bw = Math.round((w - gap * (n - 1)) / n)
  const out = [
    // baseline
    h(Rect, {
      key: 'chart-base',
      x: x0,
      y: baseline,
      width: w,
      height: 2,
      fill: ACCENT,
      opacity: 0.22,
    }),
  ]
  series.forEach((s, i) => {
    const bh = Math.round(s * maxH)
    const bx = x0 + i * (bw + gap)
    const top = baseline - bh
    out.push(
      h(Rect, {
        key: `bar-${i}`,
        x: bx,
        y: top,
        width: bw,
        height: bh,
        cornerRadius: 7,
        gradient: linearGradient(
          [bx, baseline],
          [bx, top],
          [
            { offset: 0, color: ACCENT_DEEP },
            { offset: 1, color: ACCENT },
          ],
        ),
        opacity: 0.5 + s * 0.5,
        ...(i === n - 1 ? { bloom: { sigma: 11, threshold: 0.6, intensity: 0.55 } } : {}),
      }),
    )
  })
  return out
}

function Scene() {
  const W = 1600
  const H = 900
  return [
    // 1. Graded backdrop — deep navy → indigo → plum, breathing fBm.
    h(Rect, {
      key: 'bg',
      width: W,
      height: H,
      gradient: fbmGradient(
        [
          { offset: 0.0, color: '#070611' },
          { offset: 0.35, color: '#0d0b22' },
          { offset: 0.62, color: '#1a1138' },
          { offset: 0.85, color: '#241641' },
          { offset: 1.0, color: '#2c1a42' },
        ],
        { scale: 0.9, warp: 0.45, time: 3.1 },
      ),
    }),
    // faint brand wave low in the frame (continuity with the hero)
    h(Path, {
      key: 'wave',
      d: wavePath(W, H * 0.9, 16, (2 * Math.PI) / (W * 0.5), 0.6, 120),
      stroke: ACCENT,
      strokeWidth: 2,
      strokeCap: 'round',
      opacity: 0.16,
    }),

    // 2. Top chrome — eyebrow + FY chip + keyline.
    h(
      Text,
      {
        key: 'eyebrow',
        x: 120,
        y: 92,
        fontSize: 22,
        fontFamily: FONT,
        fontWeight: 500,
        letterSpacing: 4,
        color: MUTED,
      },
      'ONDA — QUARTERLY REVIEW',
    ),
    h(Rect, {
      key: 'chip',
      x: 1336,
      y: 80,
      width: 144,
      height: 42,
      cornerRadius: 21,
      fill: '#00000000',
      stroke: '#ffffff',
      strokeWidth: 1,
      strokeOpacity: 0.16,
    }),
    h(
      Text,
      {
        key: 'chip-t',
        x: 1364,
        y: 92,
        fontSize: 20,
        fontFamily: FONT,
        fontWeight: 500,
        letterSpacing: 2,
        color: MUTED,
      },
      'FY 2025',
    ),
    h(Rect, { key: 'kl-top', x: 120, y: 150, width: 1360, height: 1, fill: LINE, opacity: 0.07 }),

    // 3. Headline (the ONE word changes) + subtitle.
    h(
      Text,
      {
        key: 'head',
        x: 118,
        y: 226,
        fontSize: 140,
        fontFamily: FONT,
        fontWeight: 800,
        color: INK,
      },
      `${Q} recap`,
    ),
    h(
      Text,
      {
        key: 'sub',
        x: 124,
        y: 392,
        fontSize: 38,
        fontFamily: FONT,
        fontWeight: 300,
        color: MUTED,
      },
      'three quarters in',
    ),

    // 4. Two hero stats (identical in both renders — your data stays put).
    h(
      Text,
      { key: 's1', x: 120, y: 566, fontSize: 92, fontFamily: FONT, fontWeight: 700, color: ACCENT },
      '+42%',
    ),
    h(
      Text,
      {
        key: 's1l',
        x: 124,
        y: 676,
        fontSize: 23,
        fontFamily: FONT,
        fontWeight: 500,
        letterSpacing: 1,
        color: MUTED,
      },
      'net revenue retention',
    ),
    h(
      Text,
      { key: 's2', x: 492, y: 566, fontSize: 92, fontFamily: FONT, fontWeight: 700, color: INK },
      '$1.2M',
    ),
    h(
      Text,
      {
        key: 's2l',
        x: 496,
        y: 676,
        fontSize: 23,
        fontFamily: FONT,
        fontWeight: 500,
        letterSpacing: 1,
        color: MUTED,
      },
      'recurring revenue',
    ),

    // 5. Bar chart (upper right).
    h(
      Text,
      {
        key: 'chart-l',
        x: 946,
        y: 232,
        fontSize: 21,
        fontFamily: FONT,
        fontWeight: 500,
        letterSpacing: 3,
        color: FAINT,
      },
      'ARR · TRAILING 6 MO',
    ),
    ...barChart(946, 560, 536, 286),

    // 6. Footer chrome.
    h(Rect, { key: 'kl-bot', x: 120, y: 812, width: 1360, height: 1, fill: LINE, opacity: 0.07 }),
    h(
      Text,
      {
        key: 'foot',
        x: 120,
        y: 838,
        fontSize: 19,
        fontFamily: FONT,
        fontWeight: 500,
        letterSpacing: 2,
        color: FAINT,
      },
      'RENDERED NATIVELY · ONDA VELLO',
    ),
    h(
      Text,
      {
        key: 'foot-r',
        x: 1410,
        y: 838,
        fontSize: 19,
        fontFamily: FONT,
        fontWeight: 500,
        letterSpacing: 2,
        color: FAINT,
      },
      '01 / 01',
    ),

    // 7. Vignette.
    h(Rect, {
      key: 'vignette',
      width: W,
      height: H,
      gradient: radialGradient([W / 2, H / 2], Math.hypot(W, H) * 0.62, [
        { offset: 0.0, color: '#00000000' },
        { offset: 0.6, color: '#00000000' },
        { offset: 1.0, color: '#05040cb0' },
      ]),
    }),
  ]
}

export default function diffRecap({ fps, durationInFrames, width, height }) {
  return h(Composition, { width, height, fps, durationInFrames }, h(Scene, null))
}
