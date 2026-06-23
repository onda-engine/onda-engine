//! BrandFlow — a premium brand opener: a single window of FOOTAGE flows and
//! reshapes across the frame (Magic-Move continuity), big editorial type lands on
//! each beat as a counterpoint, all over a living radial-glow atmosphere with a
//! vignette — then the window dissolves and the logo reveals with a flourish.
//!
//! The footage is revealed through a morphing rounded-rect ALPHA matte, so the same
//! clip reads as one continuous object telling a story. Backend: video + gradients
//! are GPU-only → Vello.

import {
  Easing,
  Group,
  Image,
  Path,
  Rect,
  Text,
  fbmGradient,
  interpolate,
  radialGradient,
  useCurrentFrame,
  useVideoConfig,
} from '@onda-engine/react'
import type { ReactElement } from 'react'
import { measureText } from '../text-metrics.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'
import { VideoClip } from './VideoClip.js'

export type FlowWordAt = 'left' | 'right' | 'over'

export interface FlowBeat {
  x: number
  y: number
  w: number
  h: number
  radius?: number
  word?: string
  wordAt?: FlowWordAt
}

export interface BrandFlowProps {
  videoSrc?: string
  beats?: FlowBeat[]
  headlineSize?: number
  accent?: string
  background?: string
  glow?: boolean
  vignette?: number
  titleColor?: string
  fontFamily?: string
  uppercase?: boolean
  logoWordmark?: string
  logoSrc?: string
  holdFrames?: TimeInput
  morphFrames?: TimeInput
  introFrames?: TimeInput
  finishFrames?: TimeInput
}

const K = 0.5522847498

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

export function BrandFlow({
  videoSrc = '',
  beats,
  headlineSize,
  accent,
  background,
  glow = true,
  vignette = 0.5,
  titleColor = '#ffffff',
  fontFamily: fontFamilyProp,
  uppercase = true,
  logoWordmark,
  logoSrc,
  holdFrames,
  morphFrames,
  introFrames,
  finishFrames,
}: BrandFlowProps) {
  const frame = useCurrentFrame()
  const { width: cw, height: ch, fps } = useVideoConfig()
  const theme = useTheme()

  const acc = accent ?? theme.accent ?? '#7c3aed'
  const bg = background ?? '#07060e'
  const headingFamily = fontFamilyProp ?? theme.headingFamily ?? theme.fontFamily
  const hSize = headlineSize ?? Math.round(ch * 0.155)

  const run: FlowBeat[] =
    Array.isArray(beats) && beats.length > 0
      ? beats
      : [
          { x: 0.64, y: 0.5, w: 0.4, h: 0.6, radius: 0.5, word: 'Make', wordAt: 'left' },
          { x: 0.36, y: 0.5, w: 0.46, h: 0.5, radius: 0.4, word: 'ideas', wordAt: 'right' },
          { x: 0.6, y: 0.5, w: 0.42, h: 0.62, radius: 0.55, word: 'move.', wordAt: 'left' },
        ]

  const hold = framesOf(holdFrames, fps, 40)
  const morph = framesOf(morphFrames, fps, 24)
  const intro = framesOf(introFrames, fps, 20)
  const SWIFT = Easing.bezier(0.85, 0, 0.15, 1)
  const beatLen = hold + morph
  const n = run.length
  const taglineEnd = n * beatLen

  // Logo finish.
  const hasLogo = Boolean(logoSrc || logoWordmark)
  const finish = hasLogo ? framesOf(finishFrames, fps, 50) : 0
  const ft = finish > 0 ? (frame - taglineEnd) / finish : -1
  const winOut =
    ft < 0
      ? 1
      : interpolate(ft, [0, 0.4], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const winShrink =
    ft < 0
      ? 1
      : interpolate(ft, [0, 0.5], [1, 0.8], {
          easing: SWIFT,
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
  const logoOpacity =
    ft < 0
      ? 0
      : interpolate(ft, [0.25, 0.7], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
  const logoScale =
    ft < 0
      ? 0.85
      : interpolate(ft, [0.25, 0.95], [0.85, 1], {
          easing: Easing.easeOutBack,
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })

  // Window geometry, eased between stops.
  const seg = Math.min(n - 1, Math.floor(frame / beatLen))
  const local = frame - seg * beatLen
  const tM =
    local <= hold
      ? 0
      : interpolate(local, [hold, hold + morph], [0, 1], {
          easing: SWIFT,
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
  const A = run[seg] ?? run[0] ?? { x: 0.5, y: 0.5, w: 0.4, h: 0.5 }
  const B = run[Math.min(seg + 1, n - 1)] ?? A
  const sx = lerp(A.x, B.x, tM) * cw
  const sy = lerp(A.y, B.y, tM) * ch
  const sw = lerp(A.w, B.w, tM) * cw
  const sh = lerp(A.h, B.h, tM) * ch
  const scr = (lerp(A.radius ?? 0.5, B.radius ?? 0.5, tM) * Math.min(sw, sh)) / 2
  const windowD = roundedRect(sx, sy, sw / 2, sh / 2, scr)

  const introFade = interpolate(frame, [0, intro], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const introScale = interpolate(frame, [0, intro], [0.92, 1], {
    easing: Easing.easeOutCubic,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const t = frame / fps

  // ── Cinematic atmosphere: a living fbm color-field, a soft key light, a warm
  // fill, and a deep vignette — moody and layered, not a flat blob ─────────
  const gx = cw * (0.34 + 0.1 * Math.sin(t * 0.22))
  const gy = ch * (0.34 + 0.08 * Math.cos(t * 0.18))
  const haze = fbmGradient(
    [
      { offset: 0, color: '#2a1550' },
      { offset: 0.45, color: '#0c0a1c' },
      { offset: 0.72, color: '#2c1038' },
      { offset: 1, color: '#06040c' },
    ],
    { scale: 0.55, warp: 0.6, time: t * 0.05 },
  )
  const keyGlow = radialGradient([gx, gy], cw * 0.74, [
    { offset: 0, color: '#8b5cf661' },
    { offset: 0.5, color: '#3b1d6e1c' },
    { offset: 1, color: '#06040c00' },
  ])
  const warmGlow = radialGradient([cw * (0.78 - 0.06 * Math.sin(t * 0.2)), ch * 0.72], cw * 0.44, [
    { offset: 0, color: '#fb651426' },
    { offset: 1, color: '#06040c00' },
  ])
  const vig = radialGradient([cw / 2, ch / 2], Math.hypot(cw / 2, ch / 2), [
    { offset: 0, color: '#00000000' },
    { offset: 0.58, color: '#00000000' },
    {
      offset: 1,
      color: `#000000${Math.round(Math.max(0, Math.min(1, vignette)) * 255)
        .toString(16)
        .padStart(2, '0')}`,
    },
  ])

  // ── Big editorial words, centered with real metrics ─────────────────────
  const words: ReactElement[] = run.map((p, j) => {
    const start = j * beatLen
    const isLast = j === n - 1
    const op = isLast
      ? interpolate(frame, [start, start + 10, taglineEnd], [0, 1, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : interpolate(
          frame,
          [start, start + 10, start + hold, start + hold + Math.round(morph * 0.6)],
          [0, 1, 1, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
        )
    if (op <= 0.001 || !p.word) return <Group key={`w${j}`} />
    const wx = p.x * cw
    const ww = p.w * cw
    const at = p.wordAt ?? (p.x > 0.5 ? 'left' : 'right')
    const cx = at === 'over' ? wx : at === 'right' ? (wx + ww / 2 + cw) / 2 : (wx - ww / 2) / 2
    const txt = uppercase ? p.word.toUpperCase() : p.word
    const m = measureText(txt, hSize, {
      fontFamily: headingFamily,
      fontWeight: 800,
      letterSpacing: -2,
    })
    // Slide a touch on entrance for life.
    const slide = interpolate(frame, [start, start + 14], [at === 'right' ? 36 : -36, 0], {
      easing: Easing.easeOutCubic,
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
    return (
      <Group key={`w${j}`} opacity={op}>
        <Text
          x={Math.round(cx - m.width / 2 + slide)}
          y={Math.round(ch / 2 - hSize * 0.6)}
          fontSize={hSize}
          color={titleColor}
          fontFamily={headingFamily}
          fontWeight={800}
          letterSpacing={-2}
        >
          {txt}
        </Text>
      </Group>
    )
  })

  // ── Logo finish (wordmark or image), centered, with a glow pulse ────────
  let logoEl: ReactElement | null = null
  if (hasLogo && logoOpacity > 0.001) {
    const lcx = cw / 2
    const lcy = ch / 2
    const pulse = (
      <Rect
        width={cw}
        height={ch}
        gradient={radialGradient([lcx, lcy], cw * 0.34, [
          { offset: 0, color: '#7c3aed66' },
          { offset: 1, color: '#07060e00' },
        ])}
        opacity={logoOpacity * 0.9}
      />
    )
    let mark: ReactElement
    if (logoSrc) {
      const lw = Math.round(cw * 0.3)
      const lh = Math.round(ch * 0.2)
      mark = (
        <Image
          src={logoSrc}
          x={Math.round(lcx - lw / 2)}
          y={Math.round(lcy - lh / 2)}
          width={lw}
          height={lh}
          fit="contain"
        />
      )
    } else {
      const ls = Math.round(ch * 0.1)
      const m = measureText(logoWordmark ?? '', ls, {
        fontFamily: headingFamily,
        fontWeight: 700,
        letterSpacing: 1,
      })
      mark = (
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
      )
    }
    logoEl = (
      <Group>
        {pulse}
        <Group
          opacity={logoOpacity}
          originX={lcx}
          originY={lcy}
          scaleX={logoScale}
          scaleY={logoScale}
        >
          {mark}
        </Group>
      </Group>
    )
  }

  return (
    <Group>
      {/* Cinematic atmosphere — base, a living fbm color-field, key + warm light. */}
      <Rect width={cw} height={ch} fill={bg} />
      {glow ? <Rect width={cw} height={ch} gradient={haze} opacity={0.9} /> : null}
      {glow ? <Rect width={cw} height={ch} gradient={keyGlow} /> : null}
      {glow ? <Rect width={cw} height={ch} gradient={warmGlow} /> : null}
      <Group opacity={introFade}>
        {/* The footage window — flows + reshapes; dissolves for the logo. */}
        <Group
          originX={cw / 2}
          originY={ch / 2}
          scaleX={winShrink * introScale}
          scaleY={winShrink * introScale}
          opacity={winOut}
        >
          <Group matte={<Path d={windowD} fill="#ffffff" />} matteMode="alpha">
            <VideoClip
              src={videoSrc}
              width={cw}
              height={ch}
              fit="cover"
              fadeIn={0}
              fadeOut={0}
              loop
            />
          </Group>
          <Path d={windowD} fill="#00000000" stroke={acc} strokeWidth={2.5} opacity={0.55} />
        </Group>
        {/* Big editorial type — fades out with the window for the logo handoff. */}
        <Group opacity={winOut}>{words}</Group>
        {/* Logo sign-off. */}
        {logoEl}
      </Group>
      {/* Vignette on top of everything but the type stays bright enough. */}
      {vignette > 0 ? <Rect width={cw} height={ch} gradient={vig} /> : null}
    </Group>
  )
}
