//! MatteReveal — a "film mattes" reveal: a video plays THROUGH a bold shape that
//! morphs continuously from one form to the next (oval → squircle → circle → star
//! → diamond …), drifting and breathing flowily, with a bold title cross-fading
//! over each beat. The signature "drag-and-drop / film mattes" mograph look.
//!
//! Mechanics: a white {@link Path} whose `d` is morphed per-frame ({@link morphPath},
//! flubber) is used as an ALPHA matte over a full-frame {@link VideoClip} — so the
//! footage shows only inside the shape. The shape holds, then morphs to the next;
//! a gentle rotation + scale "breathe" keeps it alive; titles cross-fade per beat.
//!
//! Backend: video + matte are GPU-only, so the host routes this to Vello.

import {
  Easing,
  Group,
  Path,
  Rect,
  Text,
  interpolate,
  morphPath,
  radialGradient,
  useCurrentFrame,
  useVideoConfig,
} from '@onda-engine/react'
import type { ReactElement } from 'react'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'
import { VideoClip } from './VideoClip.js'

export type MatteShape =
  | 'oval'
  | 'squircle'
  | 'circle'
  | 'diamond'
  | 'star'
  | 'rect'
  | 'flower'
  | 'blob'
  | 'arch'
  | 'hexagon'
  | 'plus'
  | 'leaf'

export interface MatteBeat {
  shape?: MatteShape
  title?: string
}

export interface MatteRevealProps {
  src?: string
  beats?: MatteBeat[]
  titleColor?: string
  background?: string
  fontSize?: number
  fontFamily?: string
  uppercase?: boolean
  shapeScale?: number
  /** Cinematic letterbox bars — fraction of height for each bar (0 = none, e.g. 0.07). */
  letterbox?: number
  /** Vignette strength (0..1) darkening the frame edges. */
  vignette?: number
  holdFrames?: TimeInput
  morphFrames?: TimeInput
  introFrames?: TimeInput
}

const K = 0.5522847498 // circle bezier constant

/** A bezier ellipse centered at (cx,cy). */
function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return [
    `M ${cx} ${cy - ry}`,
    `C ${cx + rx * K} ${cy - ry} ${cx + rx} ${cy - ry * K} ${cx + rx} ${cy}`,
    `C ${cx + rx} ${cy + ry * K} ${cx + rx * K} ${cy + ry} ${cx} ${cy + ry}`,
    `C ${cx - rx * K} ${cy + ry} ${cx - rx} ${cy + ry * K} ${cx - rx} ${cy}`,
    `C ${cx - rx} ${cy - ry * K} ${cx - rx * K} ${cy - ry} ${cx} ${cy - ry} Z`,
  ].join(' ')
}

/** A rounded rectangle (bezier corners) centered at (cx,cy), half-size hw×hh, radius r. */
function roundedRect(cx: number, cy: number, hw: number, hh: number, r: number): string {
  const x0 = cx - hw
  const x1 = cx + hw
  const y0 = cy - hh
  const y1 = cy + hh
  const c = r * (1 - K)
  return [
    `M ${x0 + r} ${y0}`,
    `L ${x1 - r} ${y0}`,
    `C ${x1 - c} ${y0} ${x1} ${y0 + c} ${x1} ${y0 + r}`,
    `L ${x1} ${y1 - r}`,
    `C ${x1} ${y1 - c} ${x1 - c} ${y1} ${x1 - r} ${y1}`,
    `L ${x0 + r} ${y1}`,
    `C ${x0 + c} ${y1} ${x0} ${y1 - c} ${x0} ${y1 - r}`,
    `L ${x0} ${y0 + r}`,
    `C ${x0} ${y0 + c} ${x0 + c} ${y0} ${x0 + r} ${y0} Z`,
  ].join(' ')
}

/** A closed polygon from points. */
function polygon(points: Array<[number, number]>): string {
  return `${points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ')} Z`
}

/** A 4-pointed star (X / sparkle energy) centered at (cx,cy). */
function star4(cx: number, cy: number, rOuter: number, rInner: number, rot = Math.PI / 4): string {
  const pts: Array<[number, number]> = []
  for (let i = 0; i < 8; i++) {
    const a = rot + (i * Math.PI) / 4
    const r = i % 2 === 0 ? rOuter : rInner
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return polygon(pts)
}

/** A smooth closed polygon sampled from a polar radius function — buttery to morph. */
function radial(cx: number, cy: number, fn: (a: number) => number, n = 84): string {
  const pts: Array<[number, number]> = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    const r = fn(a)
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return polygon(pts)
}

/** A regular n-gon (pointy-top), radius r. */
function ngon(cx: number, cy: number, r: number, n: number): string {
  const pts: Array<[number, number]> = []
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return polygon(pts)
}

/** A chunky plus / cross (12-vertex polygon), arm half-length L, half-thickness th. */
function plus(cx: number, cy: number, L: number, th: number): string {
  const p: Array<[number, number]> = [
    [-th, -L],
    [th, -L],
    [th, -th],
    [L, -th],
    [L, th],
    [th, th],
    [th, L],
    [-th, L],
    [-th, th],
    [-L, th],
    [-L, -th],
    [-th, -th],
  ]
  return polygon(p.map(([x, y]) => [cx + x, cy + y]))
}

/** A rounded-top "portal/window" arch (flat base, arched top) — bezier only. */
function arch(cx: number, cy: number, hw: number, hh: number): string {
  const x0 = cx - hw
  const x1 = cx + hw
  const yb = cy + hh
  const yt = cy - hh + hw // where the side walls meet the top arc
  return [
    `M ${x0} ${yb}`,
    `L ${x0} ${yt}`,
    `C ${x0} ${yt - hw * K} ${cx - hw * K} ${yt - hw} ${cx} ${yt - hw}`,
    `C ${cx + hw * K} ${yt - hw} ${x1} ${yt - hw * K} ${x1} ${yt}`,
    `L ${x1} ${yb}`,
    'Z',
  ].join(' ')
}

/** A vertical leaf / lens, pointed at top & bottom. */
function leaf(cx: number, cy: number, rx: number, ry: number): string {
  return [
    `M ${cx} ${cy - ry}`,
    `C ${cx + rx * 1.3} ${cy - ry * 0.25} ${cx + rx * 1.3} ${cy + ry * 0.25} ${cx} ${cy + ry}`,
    `C ${cx - rx * 1.3} ${cy + ry * 0.25} ${cx - rx * 1.3} ${cy - ry * 0.25} ${cx} ${cy - ry} Z`,
  ].join(' ')
}

export function MatteReveal({
  src = '',
  beats,
  titleColor = '#ffffff',
  background,
  fontSize,
  fontFamily: fontFamilyProp,
  uppercase = true,
  shapeScale = 1,
  letterbox = 0,
  vignette = 0,
  holdFrames,
  morphFrames,
  introFrames,
}: MatteRevealProps) {
  const frame = useCurrentFrame()
  const { width: canvasW, height: canvasH, fps } = useVideoConfig()
  const theme = useTheme()

  const headingFamily = fontFamilyProp ?? theme.headingFamily ?? theme.fontFamily
  const bg = background ?? '#000000'
  const titleSize = fontSize ?? Math.round(Math.min(canvasW, canvasH) * 0.14)

  const cx = canvasW / 2
  const cy = canvasH / 2
  const S = Math.min(canvasW, canvasH) * 0.42 * shapeScale

  // Shape library — each a SINGLE closed path (flubber morphs them cleanly).
  const SHAPES: Record<MatteShape, string> = {
    oval: ellipse(cx, cy, S * 0.66, S * 1.04),
    circle: ellipse(cx, cy, S * 0.96, S * 0.96),
    squircle: roundedRect(cx, cy, S * 1.02, S * 0.92, S * 0.52),
    rect: roundedRect(cx, cy, S * 1.18, S * 0.78, S * 0.14),
    diamond: polygon([
      [cx, cy - S * 1.18],
      [cx + S * 1.05, cy],
      [cx, cy + S * 1.18],
      [cx - S * 1.05, cy],
    ]),
    star: star4(cx, cy, S * 1.28, S * 0.5),
    // Unique shapes — organic + architectural + geometric.
    flower: radial(cx, cy, (a) => S * (0.66 + 0.34 * Math.cos(4 * a))),
    blob: radial(
      cx,
      cy,
      (a) => S * (0.94 + 0.17 * Math.sin(3 * a + 0.7) + 0.1 * Math.cos(5 * a - 0.4)),
    ),
    arch: arch(cx, cy, S * 0.82, S * 1.0),
    hexagon: ngon(cx, cy, S * 1.12, 6),
    plus: plus(cx, cy, S * 1.22, S * 0.46),
    leaf: leaf(cx, cy, S * 0.72, S * 1.12),
  }

  const run: MatteBeat[] =
    Array.isArray(beats) && beats.length > 0
      ? beats
      : [
          { shape: 'arch', title: 'Film Mattes' },
          { shape: 'flower', title: 'Drop a clip' },
          { shape: 'blob', title: 'Any shape' },
          { shape: 'leaf', title: 'Flowing' },
          { shape: 'hexagon', title: '4K · 60fps' },
        ]

  const hold = framesOf(holdFrames, fps, 40)
  const morph = framesOf(morphFrames, fps, 26)
  const intro = framesOf(introFrames, fps, 16)
  const beatLen = hold + morph
  const total = Math.max(1, (Array.isArray(beats) && beats.length ? beats.length : 5) * beatLen)
  // Slow cinematic push on the footage (Ken Burns) — life under the morphing shape.
  const vidZoom =
    1 +
    interpolate(frame, [0, total], [0, 0.12], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })

  // Which beat are we in, and the local morph progress.
  const seg = Math.min(run.length - 1, Math.floor(frame / beatLen))
  const local = frame - seg * beatLen
  const fromShape = run[seg]?.shape ?? 'oval'
  const toShape = run[Math.min(seg + 1, run.length - 1)]?.shape ?? fromShape
  const morphT =
    local <= hold
      ? 0
      : interpolate(local, [hold, hold + morph], [0, 1], {
          easing: Easing.easeInOutCubic,
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
  const d = morphPath(SHAPES[fromShape], SHAPES[toShape], morphT)

  // Flowy life: a slow breathe + a gentle rocking rotation, plus an intro scale-in.
  const t = frame / fps
  const breathe = 1 + Math.sin(t * 1.1) * 0.018
  const rock = Math.sin(t * 0.7) * 2.2 // degrees
  const introScale = interpolate(frame, [0, intro], [0.86, 1], {
    easing: Easing.easeOutCubic,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const introFade = interpolate(frame, [0, intro], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const matteScale = breathe * introScale

  const matteEl = (
    <Group originX={cx} originY={cy} rotation={rock} scaleX={matteScale} scaleY={matteScale}>
      <Path d={d} fill="#ffffff" />
    </Group>
  )

  // Per-beat title opacity — a trapezoid over its hold, fading out across its morph,
  // so adjacent titles cross-fade.
  const titleOpacity = (j: number): number => {
    const start = j * beatLen
    return interpolate(
      frame,
      [start, start + 10, start + hold, start + hold + Math.round(morph * 0.7)],
      [0, 1, 1, 0],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
    )
  }

  const titles: ReactElement[] = run.map((b, j) => {
    const op = titleOpacity(j)
    if (op <= 0.001 || !b.title) return <Group key={`t${j}`} />
    const lines = b.title.split('\n')
    const lineH = Math.round(titleSize * 1.02)
    const blockTop = cy - (lines.length * lineH) / 2 + Math.round(titleSize * 0.34)
    return (
      <Group key={`t${j}`} opacity={op}>
        {lines.map((line, li) => {
          const text = uppercase ? line.toUpperCase() : line
          const estW = text.length * titleSize * 0.56
          return (
            <Text
              key={li}
              x={Math.round(cx - estW / 2)}
              y={blockTop + li * lineH}
              fontSize={titleSize}
              color={titleColor}
              fontFamily={headingFamily}
              fontWeight={800}
              letterSpacing={-1}
            >
              {text}
            </Text>
          )
        })}
      </Group>
    )
  })

  const vigA = Math.round(Math.max(0, Math.min(1, vignette)) * 255)
    .toString(16)
    .padStart(2, '0')
  const barH = Math.round(canvasH * Math.max(0, Math.min(0.2, letterbox)))

  return (
    <Group>
      {/* Backdrop. */}
      <Rect width={canvasW} height={canvasH} fill={bg} />
      {/* Video revealed through the morphing shape. */}
      <Group opacity={introFade} matte={matteEl} matteMode="alpha">
        <Group originX={cx} originY={cy} scaleX={vidZoom} scaleY={vidZoom}>
          <VideoClip
            src={src}
            width={canvasW}
            height={canvasH}
            fit="cover"
            fadeIn={0}
            fadeOut={0}
            loop
          />
        </Group>
      </Group>
      {/* Cinematic vignette — darkened edges (over the footage, under the type). */}
      {vignette > 0 ? (
        <Rect
          width={canvasW}
          height={canvasH}
          gradient={radialGradient([cx, cy], Math.hypot(cx, cy), [
            { offset: 0, color: '#00000000' },
            { offset: 0.6, color: '#00000000' },
            { offset: 1, color: `#000000${vigA}` },
          ])}
        />
      ) : null}
      {/* Bold titles, cross-fading over the shape. */}
      {titles}
      {/* Cinematic letterbox bars (topmost). */}
      {barH > 0 ? (
        <Group>
          <Rect x={0} y={0} width={canvasW} height={barH} fill="#000000" />
          <Rect x={0} y={canvasH - barH} width={canvasW} height={barH} fill="#000000" />
        </Group>
      ) : null}
    </Group>
  )
}
