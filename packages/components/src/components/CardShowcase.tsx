//! CardShowcase — a premium card/product showcase (fintech / brand ads). Three
//! tilted rows of cards slide as a seamless conveyor (top → right, middle → left,
//! bottom → right; the tilt makes those read as diagonals). Near the end the whole
//! grid ROTATES right to flat (un-tilts) while still sliding, the slide settles,
//! then the middle row parts to open a center gap where a logo pops + fades in.
//! All motion is a pure function of frame.

import { Group, Rect, Text, interpolate, useCurrentFrame, useVideoConfig } from '@onda-engine/react'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

export interface CardShowcaseProps {
  brand?: string
  network?: string
  cardNumber?: string
  heroColor?: string
  heroTextColor?: string
  tierColors?: string[]
  background?: string
  tilt?: number
  /** Slide speed in px/sec (rightward magnitude; per-row direction is applied). */
  speed?: number
  /** Center logo text revealed at the end (e.g. a brand). Empty = no logo. */
  logo?: string
  logoColor?: string
  duration?: TimeInput
}

const CARD_W = 520
const CARD_H = 326
const RADIUS = 30
const COLS = 8
const ROWH = 400
const ss = (t: number) => t * t * (3 - 2 * t)
const mod = (a: number, b: number) => ((a % b) + b) % b
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export function CardShowcase({
  brand = 'Lumen',
  network = 'VISA',
  cardNumber = '···· 3346',
  heroColor = '#3D2BE0',
  heroTextColor = '#EAEAFF',
  tierColors = ['#111114', '#F3F3F6', '#8E93A1'],
  background = '#ECECEF',
  tilt = -22,
  speed = 320,
  logo = '',
  logoColor,
  duration: durationIn = '10s',
}: CardShowcaseProps) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const theme = useTheme()
  const D = framesOf(durationIn, fps)
  const cx = width / 2
  const cy = height / 2
  const family = theme.fontFamily

  const palette = [heroColor, ...tierColors]
  const N = palette.length
  const COLW = 600
  const band = COLS * COLW
  const leftLimit = cx - band / 2

  // ── timeline ──────────────────────────────────────────────────────────────
  // slide (constant velocity, then a smooth decel to a stop), un-tilt, gap, logo.
  const tDecel = 0.6 * D
  const tStop = 0.82 * D
  const v = speed / fps
  let shift: number
  if (frame <= tDecel) shift = v * frame
  else {
    const u = Math.min((frame - tDecel) / (tStop - tDecel), 1)
    shift = v * tDecel + v * (tStop - tDecel) * (u - (u * u) / 2) // velocity → 0
  }
  // rotate the whole group right to flat (un-tilt) while it's still sliding
  const rotation = interpolate(frame, [0, 0.5 * D, 0.76 * D], [tilt, tilt, 0], {
    easing: ss,
    ...CLAMP,
  })
  const zoom = interpolate(frame, [0, 0.2 * D, D], [1.06, 1.1, 1.0], { easing: ss, ...CLAMP })
  // the middle row parts to open a center gap (after it's flat) — wide enough to
  // fully clear the logo (a centered card pushed by `gap` clears ~gap−CARD_W/2 each side)
  const gap = interpolate(frame, [0.83 * D, 0.95 * D], [0, 620], { easing: ss, ...CLAMP })
  // logo pop + fade into the gap
  const logoOp = interpolate(frame, [0.86 * D, 0.97 * D], [0, 1], CLAMP)
  const logoScale = interpolate(frame, [0.86 * D, 0.93 * D, D], [0.55, 1.08, 1.0], {
    easing: ss,
    ...CLAMP,
  })

  const rowDir = [1, -1, 1] // top → right, middle → left, bottom → right
  const cards: { x: number; y: number; ci: number; key: string }[] = []
  for (let r = 0; r < 3; r++) {
    const rowPhase = r * COLW * 0.5
    for (let j = 0; j < COLS; j++) {
      let x = leftLimit + mod(j * COLW + rowPhase + (rowDir[r] ?? 1) * shift, band)
      const y = cy + (r - 1) * ROWH
      if (r === 1) x += (x >= cx ? 1 : -1) * gap // middle row parts for the logo
      const ci = mod(j + r * 2, N)
      cards.push({ x, y, ci, key: `${r}:${j}` })
    }
  }

  const logoCol = logoColor ?? heroColor
  const LOGO = 190
  const logoX = cx - logo.length * 0.6 * LOGO * 0.5 // approx-center the wordmark

  return (
    <Group>
      <Group originX={cx} originY={cy} scaleX={zoom} scaleY={zoom} rotation={rotation}>
        <Rect x={-width} y={-height} width={width * 3} height={height * 3} fill={background} />
        {cards.map(({ x, y, ci, key }) => {
          const hero = ci === 0
          const col = palette[ci] ?? '#1B1C22'
          const isLight = !hero && /^#(f|e|d|c)/i.test(col)
          const inkBig = hero ? heroTextColor : isLight ? '#2A2A30' : '#FFFFFFEB'
          const inkMuted = hero ? heroTextColor : isLight ? '#7A7A85' : '#FFFFFF8C'
          return (
            <Group key={key} x={x} y={y}>
              <Rect
                x={-CARD_W / 2}
                y={-CARD_H / 2}
                width={CARD_W}
                height={CARD_H}
                cornerRadius={RADIUS}
                fill={col}
              />
              <Text
                x={CARD_W / 2 - 150}
                y={-CARD_H / 2 + 34}
                fontSize={38}
                fontWeight={800}
                fontFamily={family}
                color={inkBig}
              >
                {network}
              </Text>
              <Text
                x={-CARD_W / 2 + 42}
                y={-26}
                fontSize={26}
                fontWeight={600}
                fontFamily={family}
                color={inkMuted}
              >
                {cardNumber}
              </Text>
              <Text
                x={-CARD_W / 2 + 38}
                y={CARD_H / 2 - 132}
                fontSize={hero ? 112 : 96}
                fontWeight={800}
                fontFamily={family}
                color={inkBig}
              >
                {brand}
              </Text>
            </Group>
          )
        })}
      </Group>
      {logo && logoOp > 0.001 ? (
        <Group originX={cx} originY={cy} scaleX={logoScale} scaleY={logoScale} opacity={logoOp}>
          <Text
            x={logoX}
            y={cy - LOGO * 0.6}
            fontSize={LOGO}
            fontWeight={900}
            fontFamily={family}
            color={logoCol}
          >
            {logo}
          </Text>
        </Group>
      ) : null}
    </Group>
  )
}
