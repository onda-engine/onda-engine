//! LiquidLogo — a liquid logo sting. Accent droplets drift in and FUSE into one
//! glossy pool (the engine's real `goo` metaball effect), then the liquid STREAMS
//! OUT ALONG A LINE-MARK — it literally becomes the brand wave — glosses up, and the
//! wordmark settles beneath it.
//!
//! Continuity by design: the same liquid that coalesces is the liquid that draws the
//! mark, so there's an unbroken through-line from drops → brand. The mark defaults to
//! the Onda wave but is any `markPath`; brands with an image mark use `logoSrc`
//! (it surfaces from the pool instead). Backend: goo + gradients are GPU-only → Vello.

import {
  Easing,
  Group,
  Image,
  Path,
  Rect,
  Text,
  interpolate,
  linearGradient,
  radialGradient,
  useCurrentFrame,
  useVideoConfig,
} from '@onda-engine/react'
import type { ReactElement } from 'react'
import { measureText } from '../text-metrics.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

export interface LiquidLogoProps {
  /** Wordmark that settles beneath the mark (the lockup). */
  logoWordmark?: string
  /** Image/SVG mark that surfaces from the pool instead of the wave (any shape). */
  logoSrc?: string
  /** The line-mark the liquid streams into (a stroked path in a 0..48 × 0..12 box,
   *  like the Onda wave). Ignored when `logoSrc` is set. */
  markPath?: string
  /** Liquid + mark color (default violet). */
  accent?: string
  /** Base backdrop color (default near-black). */
  background?: string
  /** Wordmark color (default white). */
  titleColor?: string
  fontFamily?: string
  uppercase?: boolean
  /** How many droplets coalesce (default 6). */
  dropCount?: number
  glow?: boolean
  vignette?: number
  /** Frames the droplets drift in + fuse into the pool. */
  gatherFrames?: TimeInput
  /** Frames the pool streams out along the mark (the liquid → brand morph). */
  flowFrames?: TimeInput
  /** Frames the finished lockup holds. */
  holdFrames?: TimeInput
}

const K = 0.5522847498
/** The Onda wave, normalized to the 48×12 mark box. */
const ONDA_WAVE = 'M 2 6 C 7 1 13 1 17 6 C 21 11 27 11 31 6 C 35 1 41 1 46 6'

/** A circle as a 4-bezier path (so a goo'd group of them fuses into metaballs). */
function circlePath(cx: number, cy: number, r: number): string {
  const k = r * K
  return [
    `M ${cx - r} ${cy}`,
    `C ${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r}`,
    `C ${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy}`,
    `C ${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r}`,
    `C ${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} Z`,
  ].join(' ')
}

/** Re-fit a mark authored in a 48×12 box to (cx,cy) at width W, amplitude A. */
function fitMark(path: string, cx: number, cy: number, w: number, a: number): string {
  const sx = (vx: number) => cx - w / 2 + ((vx - 2) / 44) * w
  const sy = (vy: number) => cy + ((vy - 6) / 5) * a
  return path.replace(
    /-?\d+(?:\.\d+)?/g,
    (() => {
      let isX = true
      return (tok: string) => {
        const v = Number.parseFloat(tok)
        const out = isX ? sx(v) : sy(v)
        isX = !isX
        return out.toFixed(2)
      }
    })(),
  )
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const withA = (c: string, a: string) => (c.startsWith('#') && c.length === 7 ? `${c}${a}` : c)

/** RGB triple from a #rrggbb hex. */
function rgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}
/** Mix a #rrggbb hex toward a target hex by t (0..1); other color forms pass through. */
function mix(hex: string, target: string, t: number): string {
  if (!(hex.startsWith('#') && hex.length === 7)) return hex
  const [r1, g1, b1] = rgb(hex)
  const [r2, g2, b2] = rgb(target)
  const h = (a: number, b: number) =>
    Math.round(a + (b - a) * t)
      .toString(16)
      .padStart(2, '0')
  return `#${h(r1, r2)}${h(g1, g2)}${h(b1, b2)}`
}

export function LiquidLogo({
  logoWordmark = 'Onda Studio',
  logoSrc,
  markPath = ONDA_WAVE,
  accent,
  background,
  titleColor = '#ffffff',
  fontFamily: fontFamilyProp,
  uppercase = false,
  dropCount = 6,
  glow = true,
  vignette = 0.5,
  gatherFrames,
  flowFrames,
  holdFrames,
}: LiquidLogoProps) {
  const frame = useCurrentFrame()
  const { width: cw, height: ch, fps } = useVideoConfig()
  const theme = useTheme()

  const acc = accent ?? theme.accent ?? '#7c3aed'
  const bg = background ?? '#08080a'
  const headingFamily = fontFamilyProp ?? theme.headingFamily ?? theme.fontFamily

  const gather = framesOf(gatherFrames, fps, 26)
  const flow = framesOf(flowFrames, fps, 22)
  // Two authored curves, not one default. DRIFT (gentle ease-in-out) lets the drops
  // drift in + converge so the metaball spread reads; EASE_OUT (house expo-decel)
  // draws the mark on fast then feathers — confident, never the generic Material ease.
  const DRIFT = Easing.bezier(0.45, 0, 0.25, 1)
  const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1)

  const minDim = Math.min(cw, ch)
  const cx = cw / 2
  const cy = ch * 0.5
  const markCy = cy - ch * 0.05 // leave room for the wordmark below
  const n = Math.max(2, Math.round(dropCount))
  const hasImg = Boolean(logoSrc)

  const flowStart = gather
  const flowEnd = gather + flow

  // The pool drains as the liquid streams into the mark.
  const drain = interpolate(frame, [flowStart, flowEnd], [1, 0], {
    easing: Easing.bezier(0.5, 0, 0.7, 1),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  // ── Liquid pool: droplets drift to the mark's centre, then drain into it. ────
  const poolR = minDim * 0.18
  const blobPaths: string[] = []
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + 0.6
    const delay = (i % 3) * 3
    const gp = interpolate(frame, [delay, delay + gather], [0, 1], {
      easing: DRIFT,
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
    const dist = lerp(minDim * 0.5, minDim * (0.025 + 0.03 * Math.sin(i * 1.7)), gp)
    const bx = cx + Math.cos(ang) * dist
    const by = markCy + Math.sin(ang) * dist * 0.82
    const baseR = minDim * (0.105 + 0.03 * Math.cos(i * 2.1))
    const r = Math.max(0, baseR * drain)
    if (r >= 0.5) blobPaths.push(circlePath(bx, by, r))
  }
  const anchorR =
    minDim *
    0.095 *
    interpolate(frame, [6, gather * 0.7], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }) *
    drain
  if (anchorR > 0.5) blobPaths.unshift(circlePath(cx, markCy, anchorR))
  const gooSigma = minDim * 0.022

  // Volume gradient — accent-driven liquid glass: light sheen on top → accent → deep
  // bottom, for a lit 3-D droplet. (The 2D 'chrome' finish was dropped — flat banded
  // silver can't read as real metal without reflections/fresnel; that's a Scene3D job.)
  const liquidGrad = linearGradient(
    [cx, markCy - poolR * 1.2],
    [cx, markCy + poolR * 1.2],
    [
      { offset: 0, color: mix(acc, '#ffffff', 0.55) },
      { offset: 0.4, color: mix(acc, '#ffffff', 0.12) },
      { offset: 0.72, color: acc },
      { offset: 1, color: mix(acc, '#000000', 0.42) },
    ],
  )
  const markStroke = acc
  const bloomCfg = { sigma: minDim * 0.014, threshold: 0.6, intensity: 0.5 }

  // ── The mark the liquid streams into (the Onda wave by default). ────────────
  const markW = cw * 0.34
  const markA = ch * 0.075
  const markSW = ch * 0.05
  const markD = fitMark(markPath, cx, markCy, markW, markA)
  // Draw the stroke ON from its centre outward as the liquid flows.
  const trimS = interpolate(frame, [flowStart, flowEnd], [0.5, 0], {
    easing: EASE_OUT,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const trimE = interpolate(frame, [flowStart, flowEnd], [0.5, 1], {
    easing: EASE_OUT,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const markVisible = !hasImg && frame >= flowStart - 1
  // Shine settles to a constant by flowEnd+6 and then HOLDS — nothing drifts during
  // the hold, so the lockup gets a dead-still beat to read.
  const shineOp = interpolate(frame, [flowEnd - 6, flowEnd + 6], [0, 0.42], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  // ── Image mark fallback: surfaces from the pool. ────────────────────────────
  let imgEl: ReactElement | null = null
  if (hasImg && logoSrc) {
    const op = interpolate(frame, [flowStart, flowStart + flow * 0.6], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
    const sc = interpolate(frame, [flowStart, flowEnd], [0.84, 1], {
      easing: Easing.easeOutBack,
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
    const rise = interpolate(frame, [flowStart, flowEnd], [minDim * 0.03, 0], {
      easing: Easing.easeOutCubic,
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
    if (op > 0.001) {
      const lw = Math.round(cw * 0.3)
      const lh = Math.round(ch * 0.2)
      imgEl = (
        <Group opacity={op} originX={cx} originY={markCy} scaleX={sc} scaleY={sc}>
          <Image
            src={logoSrc}
            x={Math.round(cx - lw / 2)}
            y={Math.round(markCy - rise - lh / 2)}
            width={lw}
            height={lh}
            fit="contain"
          />
        </Group>
      )
    }
  }

  // ── Wordmark, settling beneath the mark. ────────────────────────────────────
  let wordEl: ReactElement | null = null
  if (logoWordmark) {
    const wmOp = interpolate(frame, [flowEnd - 4, flowEnd + 10], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
    const wmRise = interpolate(frame, [flowEnd - 4, flowEnd + 12], [ch * 0.02, 0], {
      easing: Easing.easeOutCubic,
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
    if (wmOp > 0.001) {
      const ws = Math.round(ch * 0.078)
      const txt = uppercase ? logoWordmark.toUpperCase() : logoWordmark
      const m = measureText(txt, ws, {
        fontFamily: headingFamily,
        fontWeight: 600,
        letterSpacing: 0.5,
      })
      const wy = markCy + ch * 0.135 - wmRise
      wordEl = (
        <Group opacity={wmOp}>
          <Text
            x={Math.round(cx - m.width / 2)}
            y={Math.round(wy - ws * 0.6)}
            fontSize={ws}
            color={titleColor}
            fontFamily={headingFamily}
            fontWeight={600}
            letterSpacing={0.5}
          >
            {txt}
          </Text>
        </Group>
      )
    }
  }

  // ── Atmosphere: the liquid lights the room. ─────────────────────────────────
  const ambient = interpolate(frame, [gather * 0.3, flowStart, flowEnd], [0.04, 0.46, 0.34], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const glowGrad = radialGradient([cx, markCy], minDim * 0.6, [
    { offset: 0, color: withA(acc, '4d') },
    { offset: 0.5, color: withA(acc, '1a') },
    { offset: 1, color: `${bg}00` },
  ])
  const vig = radialGradient([cw / 2, ch / 2], Math.hypot(cw / 2, ch / 2), [
    { offset: 0, color: '#00000000' },
    { offset: 0.6, color: '#00000000' },
    {
      offset: 1,
      color: `#000000${Math.round(Math.max(0, Math.min(1, vignette)) * 255)
        .toString(16)
        .padStart(2, '0')}`,
    },
  ])
  // ONE earned warm specular glint catching the wet surface as the mark resolves.
  const glintOp = interpolate(frame, [flowEnd - 2, flowEnd + 8], [0, 0.4], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const glintGrad = radialGradient([cx + markW * 0.24, markCy - markA * 0.8], minDim * 0.045, [
    { offset: 0, color: '#ffe2bedd' },
    { offset: 0.5, color: '#ffd9a83a' },
    { offset: 1, color: '#ffd9a800' },
  ])

  return (
    // A subtle grade unifies the whole frame (contrast + a touch of saturation).
    <Group grade={{ contrast: 1.06, saturation: 1.04 }}>
      {/* Atmosphere — grain lives HERE only, dithering the dark gradient without
          touching the crisp mark + wordmark. */}
      <Group grain={{ intensity: 0.028, size: 1.3, seed: frame }}>
        <Rect width={cw} height={ch} fill={bg} />
        {glow ? <Rect width={cw} height={ch} gradient={glowGrad} opacity={ambient} /> : null}
      </Group>
      {/* Liquid glass — the pool + the mark are ONE goo'd body, so the pool fuses into
          the mark as it streams out. Volume gradient + bloom = a lit, wet droplet. */}
      <Group bloom={bloomCfg}>
        <Group goo={{ sigma: gooSigma, threshold: 0.5 }}>
          {blobPaths.map((d, i) => (
            <Path key={`b${i}`} d={d} gradient={liquidGrad} />
          ))}
          {markVisible ? (
            <Path
              d={markD}
              stroke={markStroke}
              strokeWidth={markSW}
              strokeCap="round"
              strokeJoin="round"
              trimStart={trimS}
              trimEnd={trimE}
            />
          ) : null}
        </Group>
      </Group>
      {/* Wet shine running along the mark + one warm specular glint. */}
      {markVisible ? (
        <Path
          d={markD}
          stroke="#ffffff"
          strokeWidth={markSW * 0.32}
          strokeCap="round"
          strokeJoin="round"
          trimStart={trimS}
          trimEnd={trimE}
          opacity={shineOp}
          blendMode="screen"
        />
      ) : null}
      {markVisible ? (
        <Rect width={cw} height={ch} gradient={glintGrad} opacity={glintOp} blendMode="screen" />
      ) : null}
      {imgEl}
      {wordEl}
      <Rect width={cw} height={ch} gradient={vig} />
    </Group>
  )
}
