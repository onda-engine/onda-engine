// FLOWS AGENT — shot 2B (~9–16s, the keynote frame): the MODEL PICKER. A vertical
// slot-machine list of AI models scrolls to land on the selected one (Veo, bold) with
// a purple icon chip + connector line. The agent "choosing the best model." Light-gray
// world (continuous). Pure ONDA. (ref @12s, native-fps read.)
import { createElement as h } from 'react'
import { Composition, Group, Rect, Ellipse, Path, Text, interpolate, useCurrentFrame } from '@onda/react'
import { measureText } from '@onda/components'

const FPS = 30
const BG = '#ECECEC'
const SANS = 'IBM Plex Sans'
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const easeOut = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 4)
const tw = (s, sz, w) => Array.from(s).reduce((a, c) => a + measureText(c, sz, { fontFamily: SANS, fontWeight: w }).width, 0)

const MODELS = ['Topaz', 'Flux', 'Runway', 'Veo', 'Seedance', 'LTX', 'Eleven v3']
const SELECTED = 3 // Veo
const ROW = 82 // measured row spacing
const SIZE = 64

function Shot2B({ width, height }) {
  const frame = useCurrentFrame()
  const cx = width / 2
  const cyc = height / 2
  const listX = 866 // names left edge (measured)

  // Slot-machine settle: the list scrolls up from +3 rows and eases onto SELECTED.
  const scroll = (1 - easeOut(frame / 40)) * ROW * 3
  // chip + selected reveal after the list lands
  const landed = easeOut((frame - 28) / 16)

  const names = MODELS.map((m, i) => {
    const y = cyc + (i - SELECTED) * ROW + scroll
    const dist = Math.abs(y - cyc)
    const sel = i === SELECTED
    const op = sel ? 1 : clamp(1 - dist / 240, 0.08, 0.4) * (0.6 + 0.4 * landed)
    return h(
      Text,
      {
        key: m, x: listX, y: Math.round(y),
        fontSize: SIZE, fontFamily: SANS,
        fontWeight: sel ? 600 : 400,
        color: sel ? '#0A0A0A' : '#9A9A9A',
        opacity: op,
      },
      m,
    )
  })

  // purple icon chip on the left at center, + connector line to "Veo"
  const chipR = 78
  const chipX = 712
  const chip = h(
    Group,
    { key: 'chip', opacity: landed },
    h(Ellipse, { x: chipX - chipR, y: cyc - chipR, width: chipR * 2, height: chipR * 2, fill: '#E5D9FB' }),
    // video-camera icon (rounded body + lens triangle), purple
    h(Rect, { x: chipX - 30, y: cyc - 20, width: 44, height: 40, cornerRadius: 9, fill: '#7C3AED' }),
    h(Path, { x: chipX + 14, y: cyc, d: 'M 0 0 L 22 -15 L 22 15 Z', fill: '#7C3AED' }),
    // connector line chip → name
    h(Rect, { x: chipX + chipR + 6, y: cyc - 1, width: listX - (chipX + chipR + 6) - 14, height: 2, fill: '#1A1A1A', opacity: 0.5 }),
  )

  return h(
    Group,
    { grain: { intensity: 0.035, size: 1.1, seed: frame } },
    h(Rect, { x: 0, y: 0, width, height, fill: BG }),
    ...names,
    chip,
  )
}

export default function flowsShot2B({ fps, durationInFrames, width, height }) {
  return h(Composition, { width, height, fps, durationInFrames, linear: true }, h(Shot2B, { width, height }))
}
