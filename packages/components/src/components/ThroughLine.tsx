//! ThroughLine — the continuity flagship: ONE hero shape that flows and reshapes
//! seamlessly across every beat (a Magic-Move "through-line"), never cutting. A fine
//! accent line traces the path it has travelled, and a bold word lands at each stop.
//! The shape is filled with a living fbm gradient so the colour itself feels alive.
//!
//! It's pure eased interpolation of one rounded rectangle's center/size/corner across
//! an ordered list of stops — so the motion reads as a single continuous object telling
//! a story, the opposite of a hard-cut slideshow. Backend: gradients are GPU-only → Vello.

import {
  Easing,
  Group,
  Image,
  Path,
  Rect,
  Text,
  interpolate,
  linearGradient,
  useCurrentFrame,
  useVideoConfig,
} from '@onda-engine/react'
import type { ReactElement } from 'react'
import { measureText } from '../text-metrics.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

export type ThroughTextAt = 'in' | 'above' | 'below'

export interface ThroughBeat {
  x: number
  y: number
  w: number
  h: number
  radius?: number
  title?: string
  textAt?: ThroughTextAt
}

export interface ThroughLineProps {
  beats?: ThroughBeat[]
  accent?: string
  background?: string
  titleColor?: string
  fontSize?: number
  fontFamily?: string
  uppercase?: boolean
  showPath?: boolean
  livingGradient?: boolean
  /** Logo wordmark text revealed at the end (the brand sign-off). */
  logoWordmark?: string
  /** Logo image/SVG URL revealed at the end (any shape; takes precedence over wordmark). */
  logoSrc?: string
  holdFrames?: TimeInput
  morphFrames?: TimeInput
  introFrames?: TimeInput
  /** Frames of the chip-dissolves-to-logo finish (0 = no logo finish). */
  finishFrames?: TimeInput
}

const K = 0.5522847498

/** Rounded rectangle (bezier corners) centered at (cx,cy), half-size hw×hh, radius r. */
function roundedRect(cx: number, cy: number, hw: number, hh: number, r: number): string {
  const x0 = cx - hw
  const x1 = cx + hw
  const y0 = cy - hh
  const y1 = cy + hh
  const rr = Math.min(r, hw, hh)
  const c = rr * (1 - K)
  return [
    `M ${x0 + rr} ${y0}`,
    `L ${x1 - rr} ${y0}`,
    `C ${x1 - c} ${y0} ${x1} ${y0 + c} ${x1} ${y0 + rr}`,
    `L ${x1} ${y1 - rr}`,
    `C ${x1} ${y1 - c} ${x1 - c} ${y1} ${x1 - rr} ${y1}`,
    `L ${x0 + rr} ${y1}`,
    `C ${x0 + c} ${y1} ${x0} ${y1 - c} ${x0} ${y1 - rr}`,
    `L ${x0} ${y0 + rr}`,
    `C ${x0} ${y0 + c} ${x0 + c} ${y0} ${x0 + rr} ${y0} Z`,
  ].join(' ')
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function ThroughLine({
  beats,
  accent,
  background,
  titleColor = '#ffffff',
  fontSize,
  fontFamily: fontFamilyProp,
  uppercase = false,
  showPath = false,
  livingGradient = true,
  logoWordmark,
  logoSrc,
  holdFrames,
  morphFrames,
  introFrames,
  finishFrames,
}: ThroughLineProps) {
  const frame = useCurrentFrame()
  const { width: canvasW, height: canvasH, fps } = useVideoConfig()
  const theme = useTheme()

  const acc = accent ?? theme.accent ?? '#a78bfa'
  const bg = background ?? theme.background ?? '#0a0d17'
  const headingFamily = fontFamilyProp ?? theme.headingFamily ?? theme.fontFamily
  const titleSize = fontSize ?? Math.round(canvasH * 0.072)

  const run: ThroughBeat[] =
    Array.isArray(beats) && beats.length > 0
      ? beats
      : [
          { x: 0.5, y: 0.5, w: 0.5, h: 0.34, radius: 1, title: 'Continuity', textAt: 'in' },
          { x: 0.31, y: 0.34, w: 0.34, h: 0.22, radius: 1, title: 'One element', textAt: 'in' },
          { x: 0.5, y: 0.66, w: 0.62, h: 0.05, radius: 1, title: 'flows', textAt: 'above' },
          { x: 0.72, y: 0.44, w: 0.2, h: 0.42, radius: 1, title: 'across every', textAt: 'below' },
          { x: 0.5, y: 0.5, w: 0.52, h: 0.34, radius: 0.3, title: 'cut.', textAt: 'in' },
        ]

  const hold = framesOf(holdFrames, fps, 42)
  const morph = framesOf(morphFrames, fps, 22)
  const intro = framesOf(introFrames, fps, 16)
  // Swift, smooth move ease — fast through the middle, settles softly (no mush).
  const SWIFT = Easing.bezier(0.85, 0, 0.15, 1)
  const beatLen = hold + morph
  const n = run.length

  // Logo finish — after the tagline, the chip DISSOLVES out and the brand logo
  // (a wordmark or any image/SVG, any shape) reveals at center. Not a forced square.
  const hasLogo = Boolean(logoSrc || logoWordmark)
  const finish = hasLogo ? framesOf(finishFrames, fps, 46) : 0
  const taglineEnd = n * beatLen
  const ft = finish > 0 ? (frame - taglineEnd) / finish : -1 // 0..1 during finish, <0 before
  const chipOut =
    ft < 0
      ? 1
      : interpolate(ft, [0, 0.42], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const chipShrink =
    ft < 0
      ? 1
      : interpolate(ft, [0, 0.5], [1, 0.72], {
          easing: SWIFT,
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
  const logoOpacity =
    ft < 0
      ? 0
      : interpolate(ft, [0.22, 0.78], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
  const logoScale =
    ft < 0
      ? 0.92
      : interpolate(ft, [0.22, 0.9], [0.92, 1], {
          easing: Easing.easeOutCubic,
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })

  // Which stop are we at, and the eased progress toward the next.
  const seg = Math.min(n - 1, Math.floor(frame / beatLen))
  const local = frame - seg * beatLen
  const tMorph =
    local <= hold
      ? 0
      : interpolate(local, [hold, hold + morph], [0, 1], {
          easing: SWIFT,
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })

  const a = run[seg] ?? run[0]
  const b = run[Math.min(seg + 1, n - 1)] ?? a
  const A = a ?? { x: 0.5, y: 0.5, w: 0.4, h: 0.3 }
  const B = b ?? A

  // The hero shape's continuous geometry (canvas px), eased between stops.
  const sx = lerp(A.x, B.x, tMorph) * canvasW
  const sy = lerp(A.y, B.y, tMorph) * canvasH
  const sw = lerp(A.w, B.w, tMorph) * canvasW
  const sh = lerp(A.h, B.h, tMorph) * canvasH
  const rFrac = lerp(A.radius ?? 1, B.radius ?? 1, tMorph)
  const scr = (rFrac * Math.min(sw, sh)) / 2

  // Intro: the whole hero fades + scales up once.
  const introScale = interpolate(frame, [0, intro], [0.9, 1], {
    easing: Easing.easeOutCubic,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const introFade = interpolate(frame, [0, intro], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  // The tracing line through all stop-centers, drawn up to the current progress.
  const pathD = run
    .map(
      (p, i) => `${i === 0 ? 'M' : 'L'} ${Math.round(p.x * canvasW)} ${Math.round(p.y * canvasH)}`,
    )
    .join(' ')
  const progress = n > 1 ? (seg + tMorph) / (n - 1) : 1
  // Smooth, restrained diagonal violet gradient — tracks the shape's current bounds.
  const grad = linearGradient(
    [sx - sw / 2, sy - sh / 2],
    [sx + sw / 2, sy + sh / 2],
    [
      { offset: 0, color: '#b79bff' },
      { offset: 0.5, color: '#8b5cf6' },
      { offset: 1, color: '#6d28d9' },
    ],
  )

  // Bold word at each stop — centered with REAL text metrics (fixes the off-center).
  const titles: ReactElement[] = run.map((p, j) => {
    const start = j * beatLen
    const isLast = j === n - 1
    const op = isLast
      ? interpolate(frame, [start, start + 9, taglineEnd], [0, 1, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : interpolate(
          frame,
          [start, start + 9, start + hold, start + hold + Math.round(morph * 0.6)],
          [0, 1, 1, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
        )
    if (op <= 0.001 || !p.title) return <Group key={`t${j}`} />
    const px = p.x * canvasW
    const py = p.y * canvasH
    const ph = p.h * canvasH
    const at = p.textAt ?? 'in'
    const lines = p.title.split('\n')
    const lineH = Math.round(titleSize * 1.18)
    const blockH = lines.length * lineH
    const blockCenterY =
      at === 'above'
        ? py - ph / 2 - 26 - blockH / 2
        : at === 'below'
          ? py + ph / 2 + 26 + blockH / 2
          : py
    return (
      <Group key={`t${j}`} opacity={op}>
        {lines.map((line, li) => {
          const txt = uppercase ? line.toUpperCase() : line
          const m = measureText(txt, titleSize, {
            fontFamily: headingFamily,
            fontWeight: 700,
            letterSpacing: -1,
          })
          const slotCenterY = blockCenterY - blockH / 2 + (li + 0.5) * lineH
          return (
            <Text
              key={li}
              x={Math.round(px - m.width / 2)}
              y={Math.round(slotCenterY - titleSize * 0.6)}
              fontSize={titleSize}
              color={titleColor}
              fontFamily={headingFamily}
              fontWeight={700}
              letterSpacing={-1}
            >
              {txt}
            </Text>
          )
        })}
      </Group>
    )
  })

  // The logo finish — a wordmark OR an image/SVG (any shape), centered.
  const lcx = canvasW / 2
  const lcy = canvasH / 2
  let logoEl: ReactElement | null = null
  if (hasLogo && logoOpacity > 0.001) {
    if (logoSrc) {
      const lw = Math.round(canvasW * 0.3)
      const lh = Math.round(canvasH * 0.2)
      logoEl = (
        <Group
          opacity={logoOpacity}
          originX={lcx}
          originY={lcy}
          scaleX={logoScale}
          scaleY={logoScale}
        >
          <Image
            src={logoSrc}
            x={Math.round(lcx - lw / 2)}
            y={Math.round(lcy - lh / 2)}
            width={lw}
            height={lh}
            fit="contain"
          />
        </Group>
      )
    } else if (logoWordmark) {
      const ls = Math.round(canvasH * 0.085)
      const m = measureText(logoWordmark, ls, {
        fontFamily: headingFamily,
        fontWeight: 700,
        letterSpacing: 1,
      })
      logoEl = (
        <Group
          opacity={logoOpacity}
          originX={lcx}
          originY={lcy}
          scaleX={logoScale}
          scaleY={logoScale}
        >
          <Text
            x={Math.round(lcx - m.width / 2)}
            y={Math.round(lcy - ls * 0.6)}
            fontSize={ls}
            color={titleColor}
            fontFamily={headingFamily}
            fontWeight={700}
            letterSpacing={1}
          >
            {logoWordmark}
          </Text>
        </Group>
      )
    }
  }

  return (
    <Group>
      <Rect width={canvasW} height={canvasH} fill={bg} />
      <Group opacity={introFade}>
        {/* Tagline: the chip carries each word; it dissolves out for the logo finish. */}
        <Group
          originX={lcx}
          originY={lcy}
          scaleX={chipShrink}
          scaleY={chipShrink}
          opacity={chipOut}
        >
          {showPath ? (
            <Path
              d={pathD}
              stroke={acc}
              strokeWidth={3}
              strokeCap="round"
              strokeJoin="round"
              trimStart={0}
              trimEnd={progress}
              opacity={0.55}
            />
          ) : null}
          <Group originX={sx} originY={sy} scaleX={introScale} scaleY={introScale}>
            <Path
              d={roundedRect(sx, sy, sw / 2, sh / 2, scr)}
              gradient={livingGradient ? grad : undefined}
              fill={livingGradient ? undefined : acc}
            />
          </Group>
          {titles}
        </Group>
        {/* Brand sign-off — the user's actual logo, revealed at center. */}
        {logoEl}
      </Group>
    </Group>
  )
}
