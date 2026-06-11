//! ProductWall — a bento grid of product photos under a slow camera move: the
//! "behold the whole collection" beat. It reuses the BentoGrid auto-flow packer
//! (colSpan/rowSpan → centered pixel rects) but fills each cell with an
//! `<Image fit="cover">`, which crops to its OWN box — so NO per-tile clip Group
//! is needed, sidestepping the renderer's clip-occludes-later-siblings issue that
//! KenBurns documents. Tiles stagger in (rise + fade) like BentoGrid, then the
//! whole wall is pushed + drifted by a KenBurns-style center-pivot camera so it
//! reads as a gentle dolly across the products, not a static contact sheet.
//!
//! Backend: `<Image>` renders on both backends and the camera/entrance are plain
//! transforms — no GPU-only features, so it degrades cleanly.

import { Group, Image, Rect, interpolate, useCurrentFrame, useVideoConfig } from '@onda/react'
import { useStaggeredEntrance } from '../hooks.js'
import { STAGGER } from '../motion.js'
import { useTheme } from '../theme.js'

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export interface ProductWallProps {
  /** Product photo sources (resolved at render time by `onda render`). */
  images?: string[]
  /** Per-image `[colSpan, rowSpan]` for the bento rhythm; cycled if shorter than
   *  `images`. Omit for a uniform 1×1 grid. */
  spans?: Array<[number, number]>
  /** Grid columns (default 4). */
  columns?: number
  /** Gap between tiles in px (default 16). */
  gap?: number
  /** Overall grid width in px (default 1680). */
  width?: number
  /** Row-track height in px. Defaults to the column-track width (≈ square tiles). */
  rowHeight?: number
  /** Frames before the first tile enters (default 0). */
  delay?: number
  /** Frames between successive tiles rising in (default `STAGGER` = 4). */
  stagger?: number
  /** Tile hairline border color (default: theme `border`). */
  borderColor?: string
  /** Tile hairline border width in px (default 0 = no border). */
  borderWidth?: number
  /** Optional dark veil over every tile, 0..1, to unify a mixed set (default 0). */
  scrim?: number
  /** Camera scale at the start of the move (default 1.06). */
  cameraFrom?: number
  /** Camera scale at the end — keep the delta gentle (default 1.18). */
  cameraTo?: number
  /** Horizontal camera drift in px across the move (default -44). */
  cameraDriftX?: number
  /** Vertical camera drift in px across the move (default 26). */
  cameraDriftY?: number
  /** Frames over which the camera completes its push + drift (default 150). */
  cameraDurationInFrames?: number
}

type Cell = { x: number; y: number; w: number; h: number; index: number }

/** Slim CSS `grid-auto-flow: row` packer: place each item at the first free
 *  colSpan-wide, rowSpan-tall run, scanning rows top-to-bottom. (See BentoGrid
 *  for the fully-commented version — this is the same algorithm, geometry-only.) */
function pack(
  spans: Array<[number, number]>,
  columns: number,
  colW: number,
  rowH: number,
  gap: number,
): { cells: Cell[]; rows: number } {
  const occ: boolean[][] = []
  const ensure = (r: number) => {
    while (occ.length <= r) occ.push(new Array<boolean>(columns).fill(false))
  }
  const cells: Cell[] = []
  let cr = 0
  let cc = 0
  spans.forEach(([csRaw, rsRaw], index) => {
    const cs = Math.max(1, Math.min(csRaw, columns))
    const rs = Math.max(1, rsRaw)
    let pr = cr
    let pc = cc
    let found = false
    while (!found) {
      ensure(pr + rs - 1)
      if (pc + cs <= columns) {
        let free = true
        for (let dr = 0; dr < rs && free; dr++) {
          const row = occ[pr + dr] ?? []
          for (let dc = 0; dc < cs; dc++) {
            if (row[pc + dc]) {
              free = false
              break
            }
          }
        }
        if (free) {
          found = true
          break
        }
      }
      pc += 1
      if (pc + cs > columns) {
        pc = 0
        pr += 1
      }
    }
    for (let dr = 0; dr < rs; dr++) {
      ensure(pr + dr)
      const row = occ[pr + dr]
      if (row) for (let dc = 0; dc < cs; dc++) row[pc + dc] = true
    }
    cells.push({
      index,
      x: pc * (colW + gap),
      y: pr * (rowH + gap),
      w: cs * colW + (cs - 1) * gap,
      h: rs * rowH + (rs - 1) * gap,
    })
    cr = pr
    cc = pc + cs
    if (cc >= columns) {
      cc = 0
      cr = pr + 1
    }
  })
  return { cells, rows: occ.length }
}

export function ProductWall({
  images = [],
  spans,
  columns = 4,
  gap = 16,
  width = 1680,
  rowHeight,
  delay = 0,
  stagger = STAGGER,
  borderColor,
  borderWidth = 0,
  scrim = 0,
  cameraFrom = 1.06,
  cameraTo = 1.18,
  cameraDriftX = -44,
  cameraDriftY = 26,
  cameraDurationInFrames = 150,
}: ProductWallProps) {
  const frame = useCurrentFrame()
  const { width: canvasW, height: canvasH } = useVideoConfig()
  const theme = useTheme()
  const at = useStaggeredEntrance({ type: 'rise', delay, increment: stagger })

  const cols = Math.max(1, Math.round(columns))
  const colW = (width - (cols - 1) * gap) / cols
  const rowH = rowHeight ?? colW

  // One [colSpan, rowSpan] per image (cycled), default uniform 1×1.
  const spanList: Array<[number, number]> = images.map((_, i) =>
    spans && spans.length > 0 ? (spans[i % spans.length] as [number, number]) : [1, 1],
  )
  const { cells, rows } = pack(spanList, cols, colW, rowH, gap)

  const gridW = cells.length > 0 ? Math.max(...cells.map((c) => c.x + c.w)) : width
  const gridH = rows > 0 ? rows * rowH + (rows - 1) * gap : 0
  const originX = Math.round((canvasW - gridW) / 2)
  const originY = Math.round((canvasH - gridH) / 2)

  // KenBurns-style camera: linear push + diagonal drift, scaled about the canvas
  // center (engine scale pivots on local origin → translate-in / scale / back).
  const span = cameraDurationInFrames > 0 ? cameraDurationInFrames : 1
  const p = interpolate(frame - delay, [0, span], [0, 1], CLAMP)
  const scale = interpolate(p, [0, 1], [cameraFrom, cameraTo], CLAMP)
  const driftX = interpolate(p, [0, 1], [0, cameraDriftX], CLAMP)
  const driftY = interpolate(p, [0, 1], [0, cameraDriftY], CLAMP)
  const cx = canvasW / 2
  const cy = canvasH / 2

  const border = borderColor ?? theme.border

  return (
    <Group x={cx + driftX} y={cy + driftY}>
      <Group scaleX={scale} scaleY={scale}>
        <Group x={-cx} y={-cy}>
          <Group x={originX} y={originY}>
            {cells.map((cell) => {
              const e = at(cell.index)
              const src = images[cell.index]
              if (!src) return null
              return (
                <Group key={cell.index} x={cell.x} y={cell.y}>
                  {/* Inner Group carries the entrance (opacity + rise) — safe over
                      siblings (opacity, not clip; the BentoGrid pattern). */}
                  <Group y={e.y} opacity={e.opacity}>
                    {/* `fit="cover"` crops the photo to this w×h box, so the tile
                        never bleeds into its neighbors — no clip Group required. */}
                    <Image src={src} width={cell.w} height={cell.h} fit="cover" />
                    {scrim > 0 ? (
                      <Rect width={cell.w} height={cell.h} fill="#000000" opacity={scrim} />
                    ) : null}
                    {borderWidth > 0 ? (
                      <Rect
                        width={cell.w}
                        height={cell.h}
                        fill="#00000000"
                        stroke={border}
                        strokeWidth={borderWidth}
                      />
                    ) : null}
                  </Group>
                </Group>
              )
            })}
          </Group>
        </Group>
      </Group>
    </Group>
  )
}
