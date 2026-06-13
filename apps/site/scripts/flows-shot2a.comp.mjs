import { AudioClip } from '@onda/components'
import { fontMetrics, glyphLayout, measureText } from '@onda/components'
import { Composition, Group, Rect, Text, useCurrentFrame } from '@onda/react'
// FLOWS AGENT — shot 2A (6.3–9s): the huge "capabilities" line scrolling horizontally
// as it types, on light-gray, with a HEAT gradient (yellow/orange near the cursor →
// dark gray as letters scroll left). Pure ONDA. (ref @6.3-9s, native-fps read.)
import { createElement as h } from 'react'

const FPS = 30
const BG = '#ECECEC'
const SANS = 'IBM Plex Sans'
const SIZE = 290
const WEIGHT = 400
const LINE = 'test 3 colorways in 2 settings, voiceover in English'
const CHARS_PER_SEC = 17
// The reference hard-cuts into an already-running scroll (~0.65s head-start).
const PREROLL_FRAMES = 20

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// Font metrics: measured ONCE from the engine, not guessed.
const FM = fontMetrics(SIZE, { fontFamily: SANS, fontWeight: WEIGHT })
// Glyph layout for the full line: kerning-accurate advances.
const GLYPHS = glyphLayout(LINE, SIZE, { fontFamily: SANS, fontWeight: WEIGHT })
// Build a map from char index → {x_from_start, advance} for O(1) per-frame lookup.
const CHAR_X = GLYPHS.map((g) => ({ x: g.x, adv: g.advance }))
// HEAT gradient: distance d (px) left of the cursor → color. 0=yellow, warm, →gray.
function heat(d) {
  const stops = [
    [0, [245, 200, 66]], // #F5C842 yellow at the cursor
    [120, [232, 115, 43]], // #E8732B orange
    [300, [150, 90, 70]], // muted brown-orange
    [520, [58, 58, 58]], // #3A3A3A dark gray (cooled)
  ]
  const t = clamp(d, 0, 520)
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [d0, c0] = stops[i - 1],
        [d1, c1] = stops[i]
      const f = (t - d0) / (d1 - d0)
      const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * f))
      return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
    }
  }
  return '#3a3a3a'
}

function Shot2A({ width, height }) {
  const frame = useCurrentFrame()
  // Use engine-measured cap metrics to center text exactly — no guessing.
  // capTop = distance from Text y to top of capitals; capHeight = cap height.
  // Center of caps at height/2: y = height/2 - capTop - capHeight/2
  const cyText = Math.round(height * 0.45 - FM.capTop - FM.capHeight / 2)
  const cursorX = Math.round(width * 0.62)

  const nChars = clamp(Math.round(((frame + PREROLL_FRAMES) / FPS) * CHARS_PER_SEC), 0, LINE.length)
  // Use measureText on the actual substring so the cursor sits flush regardless
  // of any kern-pair difference between CHAR_X (full-string) and the rendered slice.
  const substr = LINE.slice(0, nChars)
  const total =
    nChars > 0 ? measureText(substr, SIZE, { fontFamily: SANS, fontWeight: WEIGHT }).width : 0
  const startX = cursorX - total

  // CHAR_X for heat coloring: distance each char's right edge is from the cursor.
  // These come from full-string shaping, close enough for visual heat distances.
  const charXScale =
    nChars > 0 && CHAR_X[nChars - 1] ? total / (CHAR_X[nChars - 1].x + CHAR_X[nChars - 1].adv) : 1

  const runs = []
  for (let i = 0; i < nChars; i++) {
    const rightEdge = startX + (CHAR_X[i].x + CHAR_X[i].adv) * charXScale
    const dist = cursorX - rightEdge
    runs.push({ text: LINE[i], color: heat(dist) })
  }
  const nodes = [
    h(
      Text,
      {
        key: 'line',
        x: Math.round(startX),
        y: cyText,
        fontSize: SIZE,
        fontFamily: SANS,
        fontWeight: WEIGHT,
        color: '#3a3a3a',
        runs,
      },
      '',
    ),
  ]
  // Cursor: full line height — cap top to descender bottom.
  // ascent - capTop + descent = 232 - 29 + 58 = 261px (matches reference proportions).
  const cursorH = Math.round(FM.ascent - FM.capTop + FM.descent)
  const cursorY = cyText + Math.round(FM.capTop)
  const blink = frame % 28 < 16 ? 0.95 : 0.15
  nodes.push(
    h(Rect, {
      key: 'caret',
      x: Math.round(cursorX) + 2,
      y: cursorY,
      width: 10,
      height: cursorH,
      fill: '#F08030',
      opacity: blink,
    }),
  )

  return h(
    Group,
    { grain: { intensity: 0.035, size: 1.1, seed: frame } },
    h(Rect, { x: 0, y: 0, width, height, fill: BG }),
    ...nodes,
    h(AudioClip, {
      key: 'audio',
      src: '/Users/rodrigosilva/dev/onda-engine/refs/shot2a-audio.aac',
      volume: 1,
    }),
  )
}

export default function flowsShot2A({ fps, durationInFrames, width, height }) {
  return h(
    Composition,
    { width, height, fps, durationInFrames, linear: true },
    h(Shot2A, { width, height }),
  )
}
