//! MagicGallery — a Magic-Move media gallery. A set of media tiles KEEP THEIR
//! IDENTITY while fluidly rearranging and rescaling between layouts (grid →
//! spotlight → hero → grid), one tile promoting to focal on each beat with a
//! caption — the Apple Keynote "Magic Move" device. Tiles glide + scale; they are
//! never cut. All over the same living, cinematic fbm atmosphere as the brand
//! opener, so the library reads as one family.
//!
//! Each tile is revealed through a rounded-rect ALPHA matte (so corners stay
//! crisp through the morph) and fills with a swapped photo/video `src` or a
//! finished-looking on-brand gradient placeholder. Backend: raster media +
//! gradients are GPU-only → Vello.

import {
  Easing,
  Group,
  Image,
  Path,
  Rect,
  Text,
  fbmGradient,
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
import { VideoClip } from './VideoClip.js'

export type GalleryLayout = 'grid' | 'spotlight' | 'hero' | 'cover' | 'row'

export interface GalleryTile {
  /** Photo/video URL filling the tile (cover-fit). Omit → gradient placeholder. */
  src?: string
  /** Treat `src` as video (looping clip) rather than a still image. */
  video?: boolean
  /** Placeholder gradient [from, to] when there's no `src`. */
  gradient?: [string, string]
}

export interface MagicBeat {
  /** The arrangement at this stop. */
  layout: GalleryLayout
  /** Which tile (index) is the hero of this beat. Default: rotates by beat. */
  focal?: number
  /** Short kicker shown on a chip near the focal tile. */
  caption?: string
}

export interface MagicGalleryProps {
  media?: GalleryTile[]
  beats?: MagicBeat[]
  accent?: string
  background?: string
  glow?: boolean
  vignette?: number
  titleColor?: string
  fontFamily?: string
  uppercase?: boolean
  /** Tile corner radius as a fraction of the tile's shorter side (default 0.1). */
  cornerRadius?: number
  /** Gap between tiles, fraction of frame (default 0.024). */
  gap?: number
  holdFrames?: TimeInput
  morphFrames?: TimeInput
  introFrames?: TimeInput
}

interface Cell {
  x: number
  y: number
  w: number
  h: number
  op: number
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
const clampIdx = (i: number, n: number) => Math.max(0, Math.min(n - 1, Math.round(i)))
/** Append an 8-bit alpha to a #rrggbb hex; pass other color forms through untouched. */
const withA = (c: string, a: string) => (c.startsWith('#') && c.length === 7 ? `${c}${a}` : c)

// ── Layout solvers: each maps (n tiles, focal) → a Cell per tile in 0..1 space ──

function gridCells(n: number, gap: number, outer = 0.07): Cell[] {
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const cellW = (1 - 2 * outer - (cols - 1) * gap) / cols
  const cellH = (1 - 2 * outer - (rows - 1) * gap) / rows
  const cells: Cell[] = []
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols)
    const inRow = Math.min(cols, n - row * cols)
    const colInRow = i - row * cols
    const rowW = inRow * cellW + (inRow - 1) * gap
    const left = (1 - rowW) / 2
    cells.push({
      x: left + colInRow * (cellW + gap) + cellW / 2,
      y: outer + row * (cellH + gap) + cellH / 2,
      w: cellW,
      h: cellH,
      op: 1,
    })
  }
  return cells
}

function stripCells(
  n: number,
  f: number,
  gap: number,
  focal: Cell,
  sW: number,
  sH: number,
  sy: number,
): Cell[] {
  const m = n - 1
  const totalW = m * sW + (m - 1) * gap
  const left = (1 - totalW) / 2
  const cells: Cell[] = []
  let k = 0
  for (let i = 0; i < n; i++) {
    if (i === f) {
      cells.push(focal)
    } else {
      cells.push({ x: left + k * (sW + gap) + sW / 2, y: sy, w: sW, h: sH, op: 1 })
      k++
    }
  }
  return cells
}

function spotlightCells(n: number, f: number, gap: number): Cell[] {
  const focal: Cell = { x: 0.5, y: 0.4, w: 0.6, h: 0.62, op: 1 }
  return stripCells(n, f, gap, focal, 0.155, 0.19, 0.85)
}

function heroCells(n: number, f: number, gap: number): Cell[] {
  const focal: Cell = { x: 0.31, y: 0.5, w: 0.5, h: 0.8, op: 1 }
  const m = n - 1
  const colH = 0.84
  const tileH = (colH - (m - 1) * gap) / Math.max(m, 1)
  const top = (1 - colH) / 2
  const cells: Cell[] = []
  let k = 0
  for (let i = 0; i < n; i++) {
    if (i === f) cells.push(focal)
    else {
      cells.push({ x: 0.79, y: top + k * (tileH + gap) + tileH / 2, w: 0.34, h: tileH, op: 1 })
      k++
    }
  }
  return cells
}

function rowCells(n: number, gap: number, outer = 0.06): Cell[] {
  const w = (1 - 2 * outer - (n - 1) * gap) / n
  const cells: Cell[] = []
  for (let i = 0; i < n; i++) {
    cells.push({ x: outer + i * (w + gap) + w / 2, y: 0.5, w, h: 0.52, op: 1 })
  }
  return cells
}

function coverCells(n: number, f: number): Cell[] {
  const cells: Cell[] = []
  for (let i = 0; i < n; i++) {
    // Non-focal tiles collapse into the focal centre and fade — never a hard cut.
    cells.push(
      i === f ? { x: 0.5, y: 0.5, w: 1, h: 1, op: 1 } : { x: 0.5, y: 0.5, w: 0.6, h: 0.6, op: 0 },
    )
  }
  return cells
}

function solveLayout(layout: GalleryLayout, n: number, focal: number, gap: number): Cell[] {
  const f = clampIdx(focal, n)
  switch (layout) {
    case 'spotlight':
      return spotlightCells(n, f, gap)
    case 'hero':
      return heroCells(n, f, gap)
    case 'cover':
      return coverCells(n, f)
    case 'row':
      return rowCells(n, gap)
    default:
      return gridCells(n, gap)
  }
}

const TILE_GRADS: [string, string][] = [
  ['#7c3aed', '#3b1d6e'],
  ['#a78bfa', '#6d28d9'],
  ['#fb6514', '#7c3aed'],
  ['#ec4899', '#7c3aed'],
  ['#6d28d9', '#1e1b4b'],
  ['#f59e0b', '#b91c1c'],
]

export function MagicGallery({
  media,
  beats,
  accent,
  background,
  glow = true,
  vignette = 0.55,
  titleColor = '#ffffff',
  fontFamily: fontFamilyProp,
  uppercase = true,
  cornerRadius = 0.1,
  gap = 0.024,
  holdFrames,
  morphFrames,
  introFrames,
}: MagicGalleryProps) {
  const frame = useCurrentFrame()
  const { width: cw, height: ch, fps } = useVideoConfig()
  const theme = useTheme()

  const acc = accent ?? theme.accent ?? '#7c3aed'
  const bg = background ?? '#0a0a11'
  const headingFamily = fontFamilyProp ?? theme.headingFamily ?? theme.fontFamily

  const tiles: GalleryTile[] =
    Array.isArray(media) && media.length > 0 ? media : [{}, {}, {}, {}, {}]
  const n = tiles.length

  const run: MagicBeat[] =
    Array.isArray(beats) && beats.length > 0
      ? beats
      : [
          { layout: 'grid' },
          { layout: 'spotlight', focal: 0, caption: 'Your work, up close' },
          { layout: 'hero', focal: 2, caption: 'Tell the story' },
          { layout: 'spotlight', focal: Math.min(4, n - 1), caption: 'Every detail' },
          { layout: 'grid' },
        ]
  const nb = run.length

  const hold = framesOf(holdFrames, fps, 30)
  const morph = framesOf(morphFrames, fps, 26)
  const intro = framesOf(introFrames, fps, 22)
  const SWIFT = Easing.bezier(0.83, 0, 0.17, 1)
  const beatLen = hold + morph

  // Resolve each beat to concrete cells, rotating the focal by default.
  const layouts: Cell[][] = run.map((b, j) => solveLayout(b.layout, n, b.focal ?? j % n, gap))

  // Which beat we're holding / morphing between.
  const seg = Math.min(nb - 1, Math.floor(frame / beatLen))
  const local = frame - seg * beatLen
  const tM =
    local <= hold
      ? 0
      : interpolate(local, [hold, hold + morph], [0, 1], {
          easing: SWIFT,
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
  const segB = Math.min(seg + 1, nb - 1)

  const introFade = interpolate(frame, [0, intro], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const introScale = interpolate(frame, [0, intro], [0.94, 1], {
    easing: Easing.easeOutCubic,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const t = frame / fps

  // ── Studio backdrop — a NEUTRAL graphite sweep (deliberately distinct from the
  // opener's violet haze) so the colourful tiles pop against it, lit by one soft
  // central light pool. The only coloured light is the focal key-glow below. ────
  const haze = fbmGradient(
    [
      { offset: 0, color: '#191826' },
      { offset: 0.5, color: '#0c0c14' },
      { offset: 0.8, color: '#15131f' },
      { offset: 1, color: '#08080e' },
    ],
    { scale: 0.5, warp: 0.5, time: t * 0.04 },
  )
  const sweep = radialGradient([cw * 0.5, ch * (0.34 + 0.02 * Math.sin(t * 0.2))], cw * 0.72, [
    { offset: 0, color: '#34314e66' },
    { offset: 0.6, color: '#1a18281f' },
    { offset: 1, color: '#08080e00' },
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

  // ── Tiles: keep identity, tween rect + opacity between the two beats. Depth is
  // AREA-DRIVEN — the biggest tile reads as the lit, floating focal; smaller tiles
  // recede (darker, softly defocused, lower elevation). Layout-agnostic, so the
  // hierarchy ramps in naturally as a grid morphs into a spotlight. ─────────────
  const rects = tiles.map((tile, i) => {
    const A = layouts[seg]?.[i] ?? { x: 0.5, y: 0.5, w: 0.3, h: 0.3, op: 1 }
    const B = layouts[segB]?.[i] ?? A
    return {
      tile,
      cxF: lerp(A.x, B.x, tM),
      cyF: lerp(A.y, B.y, tM),
      wF: lerp(A.w, B.w, tM),
      hF: lerp(A.h, B.h, tM),
      op: lerp(A.op, B.op, tM) * introFade,
    }
  })
  const areas = rects.map((r) => (r.op > 0.01 ? r.wF * r.hF : 0))
  const maxArea = Math.max(...areas, 0.0001)
  const secondArea = [...areas].sort((a, b) => b - a)[1] ?? 0
  const emphasis = maxArea > 0 ? 1 - secondArea / maxArea : 0 // 0 in a grid, ~1 in a spotlight
  const big = rects[areas.indexOf(maxArea)]

  const tileEls: ReactElement[] = rects.map((r, i) => {
    if (r.op <= 0.001) return <Group key={`t${i}`} />
    const rel = (r.wF * r.hF) / maxArea // 1 = focal, <1 = receding
    const tw = r.wF * cw
    const th = r.hF * ch
    const left = r.cxF * cw - tw / 2
    const top = r.cyF * ch - th / 2
    // Proportional corner radius → every tile is equally (generously) rounded,
    // big focal included, and the corners ease smoothly during the morph.
    const rad = Math.min(tw, th) * cornerRadius
    const d = roundedRect(tw / 2, th / 2, tw / 2, th / 2, rad)
    // Border inset ~1px so a centred stroke lands fully INSIDE the fill — an
    // edge-centred stroke spills its outer half past the matte → the halo border.
    const dInset = roundedRect(tw / 2, th / 2, tw / 2 - 1, th / 2 - 1, Math.max(0, rad - 1))

    // Elevation: the bigger a tile, the higher it floats (deeper, softer, offset shadow).
    const shOff = lerp(7, 24, rel)
    const shSigma = lerp(12, 34, rel)
    const shOp = lerp(0.26, 0.52, rel)
    const shadowD = roundedRect(tw / 2, th / 2 + shOff, tw / 2, th / 2, rad)
    // Supporting tiles recede into the dark (kept crisp — no edge-softening blur).
    const recede = (1 - rel) * 0.42

    const pair = r.tile.gradient ?? TILE_GRADS[i % TILE_GRADS.length] ?? ['#7c3aed', '#3b1d6e']
    const content = r.tile.src ? (
      r.tile.video ? (
        <VideoClip
          src={r.tile.src}
          width={tw}
          height={th}
          fit="cover"
          fadeIn={0}
          fadeOut={0}
          loop
        />
      ) : (
        <Image src={r.tile.src} width={tw} height={th} fit="cover" />
      )
    ) : (
      <Rect
        width={tw}
        height={th}
        gradient={linearGradient(
          [0, 0],
          [tw, th],
          [
            { offset: 0, color: pair[0] },
            { offset: 1, color: pair[1] },
          ],
        )}
      />
    )

    return (
      <Group key={`t${i}`} opacity={r.op}>
        {/* Drop shadow — depth / elevation. */}
        <Group x={left} y={top}>
          <Path d={shadowD} fill="#000000" opacity={shOp} blur={shSigma} />
        </Group>
        {/* The tile — media revealed through a rounded-rect alpha matte (crisp edge). */}
        <Group x={left} y={top}>
          <Group matte={<Path d={d} fill="#ffffff" />} matteMode="alpha">
            {content}
          </Group>
          {/* Recede scrim — supporting tiles sit back into the dark. */}
          {recede > 0.01 ? <Path d={d} fill="#05040b" opacity={recede} /> : null}
          {/* One crisp INSET hairline — hugs the fill, never spills a halo past the edge. */}
          <Path d={dInset} fill="#00000000" stroke="#ffffff" strokeWidth={1} opacity={0.16} />
        </Group>
      </Group>
    )
  })

  // ── Caption chip near the focal of the current beat ─────────────────────────
  let captionEl: ReactElement | null = null
  const capBeat = run[seg]
  const capText = capBeat?.caption
  if (capText) {
    const cOp =
      interpolate(local, [6, 16, hold, hold + Math.round(morph * 0.45)], [0, 1, 1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }) * introFade
    if (cOp > 0.001) {
      const fr = layouts[seg]?.[clampIdx(capBeat.focal ?? seg % n, n)] ?? {
        x: 0.5,
        y: 0.5,
        w: 0.6,
        h: 0.6,
        op: 1,
      }
      const capSize = Math.round(ch * 0.026)
      const txt = uppercase ? capText.toUpperCase() : capText
      const m = measureText(txt, capSize, {
        fontFamily: headingFamily,
        fontWeight: 700,
        letterSpacing: 2,
      })
      const padX = 20
      const chipW = m.width + padX * 2
      const chipH = capSize + 18
      const capX = fr.x * cw
      // Sit the chip just INSIDE the focal's bottom edge — legible on any media,
      // and never colliding with a spotlight strip below the focal.
      const capY = (fr.y + fr.h / 2) * ch - chipH / 2 - 0.022 * ch
      captionEl = (
        <Group opacity={cOp}>
          <Rect
            x={Math.round(capX - chipW / 2)}
            y={Math.round(capY - chipH / 2)}
            width={Math.round(chipW)}
            height={chipH}
            cornerRadius={chipH / 2}
            fill="#00000000"
            stroke={withA(acc, '99')}
            strokeWidth={1}
            backdropBlur={{ sigma: 14, tint: '#0b0918cc', brightness: 0.92, saturation: 1.15 }}
          />
          <Text
            x={Math.round(capX - m.width / 2)}
            y={Math.round(capY - capSize * 0.6)}
            fontSize={capSize}
            color={titleColor}
            fontFamily={headingFamily}
            fontWeight={700}
            letterSpacing={2}
          >
            {txt}
          </Text>
        </Group>
      )
    }
  }

  return (
    <Group>
      {/* Neutral studio backdrop. */}
      <Rect width={cw} height={ch} fill={bg} />
      {glow ? <Rect width={cw} height={ch} gradient={haze} opacity={0.95} /> : null}
      {glow ? <Rect width={cw} height={ch} gradient={sweep} /> : null}
      {/* Focal key-light — a soft accent bloom that tracks the hero tile. */}
      {glow && emphasis > 0.02 && big ? (
        <Rect
          width={cw}
          height={ch}
          gradient={radialGradient(
            [big.cxF * cw, big.cyF * ch],
            Math.max(big.wF * cw, big.hF * ch) * 0.72,
            [
              { offset: 0, color: withA(acc, '33') },
              { offset: 0.55, color: withA(acc, '10') },
              { offset: 1, color: '#0a0a1100' },
            ],
          )}
          opacity={emphasis}
        />
      ) : null}
      {/* The magic-moving tiles. */}
      <Group originX={cw / 2} originY={ch / 2} scaleX={introScale} scaleY={introScale}>
        {tileEls}
      </Group>
      {captionEl}
      {/* Vignette on top. */}
      <Rect width={cw} height={ch} gradient={vig} />
    </Group>
  )
}
