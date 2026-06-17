//! SplitLockup — two lines that START split to opposite corners, CONVERGE into a
//! centered, stacked, left-aligned lockup (ease-out, no overshoot), HOLD for the
//! body, then DISASSEMBLE back to the corners (the entrance reversed). The
//! signature "title that splits open and reassembles" move — a motion BEHAVIOUR
//! authored declaratively: feed it two words, the split distance, and the phase
//! timings. Default `line1` sits upper-left, `line2` lower-right; they meet stacked
//! and left-aligned in the center.
//!
//! Two things make or break it (the craft layer): the assemble eases OUT (no
//! overshoot) and the disassemble is the SAME curve reversed (ease-in), so the
//! exit reads as the entrance run backwards, not a different move.

import { Group, Text, useCurrentFrame, useVideoConfig } from '@onda/react'
import { layoutGlyphLine, lineStartX, lineTopY } from '../glyph-line.js'
import { useTextMetricsReady } from '../text-metrics.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

export interface SplitLockupProps {
  /** Top line of the lockup (default 'NEW'). */
  line1?: string
  /** Bottom line of the lockup (default 'PROJECT'). */
  line2?: string
  /** Font size in px (default 200). */
  fontSize?: number
  /** Ink color (defaults to theme `text`). */
  color?: string
  fontFamily?: string
  fontWeight?: number
  /** Tracking in px — the look wants it generous (default fontSize × 0.04). */
  letterSpacing?: number
  /** How far each line pulls HORIZONTALLY to its corner, px from center
   *  (default 26% of the frame width). */
  splitX?: number
  /** How far each line pulls VERTICALLY to its corner, px from center
   *  (default 28% of the frame height). */
  splitY?: number
  /** Vertical gap between the two stacked lines in the lockup (default fontSize × 0.12). */
  lineGap?: number
  /** Time of the assemble (split → center) move (default '0.7s'). */
  assembleFrames?: TimeInput
  /** Time of the disassemble (center → split) move (default '0.5s'). */
  disassembleFrames?: TimeInput
  /** Total clip length; defaults to the enclosing Sequence duration. */
  durationInFrames?: TimeInput
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t)
const easeOut = (t: number): number => 1 - (1 - clamp01(t)) ** 3
const easeIn = (t: number): number => clamp01(t) ** 3
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

interface Pt {
  x: number
  y: number
}

export function SplitLockup({
  line1 = 'NEW',
  line2 = 'PROJECT',
  fontSize = 200,
  color,
  fontFamily,
  fontWeight = 500,
  letterSpacing,
  splitX,
  splitY,
  lineGap,
  assembleFrames,
  disassembleFrames,
  durationInFrames,
}: SplitLockupProps) {
  const frame = useCurrentFrame()
  const { fps, width, height, durationInFrames: clipFrames } = useVideoConfig()
  const theme = useTheme()
  const ink = color ?? theme.text
  const family = fontFamily ?? theme.headingFamily ?? theme.fontFamily
  const tracking = letterSpacing ?? fontSize * 0.04

  useTextMetricsReady()
  const measure = { fontFamily: family, fontWeight }
  const widthOf = (s: string): number =>
    layoutGlyphLine(s, fontSize, measure).width + tracking * Math.max(0, s.length - 1)
  const w1 = widthOf(line1)
  const w2 = widthOf(line2)

  const total = durationInFrames != null ? framesOf(durationInFrames, fps) : clipFrames
  const assemble = Math.max(1, framesOf(assembleFrames ?? '0.7s', fps))
  const disassemble = Math.max(1, framesOf(disassembleFrames ?? '0.5s', fps))

  const cx = width / 2
  const cy = height / 2
  const gap = lineGap ?? fontSize * 0.12
  const step = fontSize + gap // vertical distance between the two line CENTERS

  // Lockup: left-aligned block, centered. Each line's CENTER position.
  const blockW = Math.max(w1, w2)
  const leftX = cx - blockW / 2
  const lock1: Pt = { x: leftX + w1 / 2, y: cy - step / 2 }
  const lock2: Pt = { x: leftX + w2 / 2, y: cy + step / 2 }

  // Split: line1 → upper-left, line2 → lower-right (line CENTERS).
  const sx = splitX ?? width * 0.26
  const sy = splitY ?? height * 0.28
  const split1: Pt = { x: cx - sx, y: cy - sy }
  const split2: Pt = { x: cx + sx, y: cy + sy }

  const positionOf = (split: Pt, lock: Pt): Pt => {
    if (frame <= assemble) {
      const e = easeOut(frame / assemble)
      return { x: lerp(split.x, lock.x, e), y: lerp(split.y, lock.y, e) }
    }
    const exitStart = total - disassemble
    if (frame >= exitStart) {
      const e = easeIn((frame - exitStart) / disassemble)
      return { x: lerp(lock.x, split.x, e), y: lerp(lock.y, split.y, e) }
    }
    return lock
  }

  const p1 = positionOf(split1, lock1)
  const p2 = positionOf(split2, lock2)

  const lineProps = {
    fontSize,
    color: ink,
    fontFamily: family,
    fontWeight,
    letterSpacing: tracking,
  }

  return (
    <Group>
      <Text x={lineStartX('center', p1.x, w1)} y={lineTopY(p1.y, fontSize)} {...lineProps}>
        {line1}
      </Text>
      <Text x={lineStartX('center', p2.x, w2)} y={lineTopY(p2.y, fontSize)} {...lineProps}>
        {line2}
      </Text>
    </Group>
  )
}
