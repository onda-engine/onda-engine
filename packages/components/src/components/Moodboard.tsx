//! Moodboard — a seeded scatter-grid of image tiles arranged AROUND a central
//! exclusion zone (where a title lockup sits). Given N images it auto-distributes
//! them on a coarse grid, skips the cells over the center, and jitters each tile's
//! position/size/aspect deterministically (seeded → same layout every render). Each
//! tile CASCADES in — fade + upward drift + slight scale-up — on a VISIBLE stagger,
//! holds, then exits on the mirrored stagger. The portfolio/moodboard spread.
//!
//! The two craft rules baked in: the stagger is visible (tiles never land at once),
//! and the exit is the entrance reversed (same curve). Pair it with a centered
//! title (e.g. <SplitLockup>) sitting in the exclusion zone.

import { Group, Image, useCurrentFrame, useVideoConfig } from '@onda/react'
import { type TimeInput, framesOf } from '../time.js'

export interface MoodboardProps {
  /** Tile image sources (resolved at render). Distributed around the center. */
  images?: string[]
  /** Layout seed — same seed → same scatter (deterministic). */
  seed?: number
  /** Coarse grid the tiles snap to (before jitter). */
  columns?: number
  rows?: number
  /** Central exclusion rect (no tiles), as fractions of the canvas — sized to the
   *  title that sits there. */
  exclusionWidth?: number
  exclusionHeight?: number
  /** Frames between successive tiles ENTERING — keep it visible (default 3). */
  stagger?: TimeInput
  /** Per-tile entrance duration (default '0.5s'). */
  tileEnter?: TimeInput
  /** Frames between successive tiles EXITING (default 2). */
  exitStagger?: TimeInput
  /** Per-tile exit duration (default '0.4s'). */
  tileExit?: TimeInput
  /** Total clip length; defaults to the enclosing Sequence duration. */
  durationInFrames?: TimeInput
  /** Entrance start scale (default 0.9). */
  scaleFrom?: number
  /** Entrance drift distance in px (tiles rise into place). */
  driftPx?: number
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t)
const easeOut = (t: number): number => 1 - (1 - clamp01(t)) ** 3
const easeIn = (t: number): number => clamp01(t) ** 3
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const ASPECTS = [1.4, 1.0, 0.78, 1.18]

interface Tile {
  cx: number
  cy: number
  w: number
  h: number
  src: string
}

export function Moodboard({
  images = [],
  seed = 7,
  columns = 5,
  rows = 4,
  exclusionWidth = 0.46,
  exclusionHeight = 0.4,
  stagger,
  tileEnter,
  exitStagger,
  tileExit,
  durationInFrames,
  scaleFrom = 0.9,
  driftPx = 36,
}: MoodboardProps) {
  const frame = useCurrentFrame()
  const { fps, width, height, durationInFrames: clipFrames } = useVideoConfig()
  if (images.length === 0) return null

  const total = durationInFrames != null ? framesOf(durationInFrames, fps) : clipFrames
  const stag = Math.max(1, framesOf(stagger ?? 3, fps))
  const enterDur = Math.max(1, framesOf(tileEnter ?? '0.5s', fps))
  const exitStag = Math.max(1, framesOf(exitStagger ?? 2, fps))
  const exitDur = Math.max(1, framesOf(tileExit ?? '0.4s', fps))

  // Seeded PRNG (mulberry32) — deterministic scatter.
  let s = (seed >>> 0) || 1
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const cellW = width / columns
  const cellH = height / rows
  const exLeft = width / 2 - (width * exclusionWidth) / 2
  const exRight = width / 2 + (width * exclusionWidth) / 2
  const exTop = height / 2 - (height * exclusionHeight) / 2
  const exBottom = height / 2 + (height * exclusionHeight) / 2

  const tiles: Tile[] = []
  let idx = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const ccx = (c + 0.5) * cellW
      const ccy = (r + 0.5) * cellH
      if (ccx > exLeft && ccx < exRight && ccy > exTop && ccy < exBottom) continue
      const sizeF = 0.66 + rnd() * 0.26
      const aspect = ASPECTS[Math.floor(rnd() * ASPECTS.length)] ?? 1
      const base = Math.min(cellW, cellH) * sizeF
      tiles.push({
        cx: ccx + (rnd() - 0.5) * cellW * 0.22,
        cy: ccy + (rnd() - 0.5) * cellH * 0.22,
        w: base * Math.sqrt(aspect),
        h: base / Math.sqrt(aspect),
        src: images[idx % images.length] as string,
      })
      idx++
    }
  }

  const n = tiles.length
  // Exit window sits at the end; the LAST tile finishes exactly at `total`.
  const exitStart = total - (exitDur + (n - 1) * exitStag)

  return (
    <Group>
      {tiles.map((t, i) => {
        const enterP = easeOut((frame - i * stag) / enterDur)
        const exitTileStart = exitStart + i * exitStag
        const exitP = easeIn((frame - exitTileStart) / exitDur)
        const inO = clamp01(enterP)
        const outO = clamp01(exitP)
        const opacity = inO * (1 - outO)
        if (opacity <= 0.002) return null
        const scale = lerp(scaleFrom, 1, inO) * lerp(1, 0.96, outO)
        const dy = (1 - inO) * driftPx - outO * driftPx * 0.5
        return (
          <Group key={`${i}-${t.src}`} x={t.cx} y={t.cy + dy} opacity={opacity}>
            <Group scaleX={scale} scaleY={scale}>
              <Group x={-t.w / 2} y={-t.h / 2}>
                <Image src={t.src} width={t.w} height={t.h} fit="cover" />
              </Group>
            </Group>
          </Group>
        )
      })}
    </Group>
  )
}
