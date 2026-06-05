//! BentoGrid — a data-driven bento layout: a grid of glass cards with varying
//! column/row spans, each rising + fading in on the house spring, staggered
//! left-to-right so the grid assembles as one calm cascade. Ported from ondajs
//! (`bento-grid`).
//!
//! The engine has no CSS grid (and no auto-flow), so this reproduces CSS grid
//! `grid-auto-flow: row` placement by hand: a fixed column-track width, a
//! derived row-track height, and a left-to-right / top-to-bottom packer that
//! finds the first free run of `colSpan` cells on each row (skipping cells
//! occupied by an earlier `rowSpan>1` item). Every cell is then positioned by an
//! EXPLICIT pixel x/y inside one self-centering `<Group>` (like `BarChart`) —
//! NOT a `<Flex>` — so the per-frame entrance translate never triggers a layout
//! reflow. Because the cards are absolutely placed (not Flex children), the
//! entrance TRANSLATE is applied on a nested inner `<Group>` and is layout-safe.
//!
//! Glass: this card uses a translucent dark fill (`#0e0e128c` ≈
//! rgba(14,14,18,0.55)) + a subtle 1px stroke + a faint top "sheen" gradient.
//! NOTE: the engine now ships real frosted glass via the `backdropBlur` node
//! prop (blurs what's BEHIND the node) — a follow-up can opt this Surface into it
//! for true glass instead of the flat translucent approximation.
//!
//! Backend caveat: the sheen uses a `linearGradient`, which renders only on the
//! Vello/GPU backend; the CPU reference collapses it to its first (transparent)
//! stop, so the sheen simply vanishes there — the card still reads correctly.

import { Group, Rect, Text, linearGradient, useVideoConfig } from '@onda/react'
import { useStaggeredEntrance } from '../hooks.js'
import { STAGGER } from '../motion.js'
import { useTheme } from '../theme.js'

/** A single bento cell. Spans default to 1×1; `accent` earns the rose tint. */
export interface BentoItem {
  /** Cell title (display font). */
  title: string
  /** Optional headline figure shown large above the title (e.g. `'98%'`). */
  value?: string
  /** Optional caption beneath the title. */
  caption?: string
  /** Columns this cell spans. Clamped to the grid's `columns` (default 1). */
  colSpan?: number
  /** Rows this cell spans (default 1). */
  rowSpan?: number
  /** Marks the one earned-accent cell — rose value + accent border. */
  accent?: boolean
}

export interface BentoGridProps {
  /** The cells, laid out left-to-right, top-to-bottom. Spans drive the rhythm. */
  items?: BentoItem[]
  /** Number of grid columns (default 3). */
  columns?: number
  /** Gap between cells in px (default 24). */
  gap?: number
  /** Overall grid width in px (default 960). */
  width?: number
  /** Row-track height in px. Defaults to the column-track width (≈ square cells). */
  rowHeight?: number
  /** Inner padding of each cell in px (default 34). */
  padding?: number
  /** Frames before the first cell enters (default 0). */
  delay?: number
  /** Frames between successive cells rising in. House stagger is 4. */
  stagger?: number
  /** Base title font size in px (default 30). */
  fontSize?: number
  /** Title color (default: theme `text`). */
  color?: string
  /** Caption color (default: theme `textMuted`). */
  captionColor?: string
  /** Accent color for the earned `accent` cell (default: theme `accent`). */
  accentColor?: string
  /** Card fill — translucent dark, approximating glass (default: theme `surface`). */
  cardColor?: string
  /** Card border color (default: theme `border`). */
  borderColor?: string
  /** Display font family for titles and values (default: theme `headingFamily ?? fontFamily`). */
  fontFamily?: string
  /** Body font family for captions (default: theme `fontFamily`). */
  captionFontFamily?: string
}

const DEFAULT_ITEMS: BentoItem[] = [
  {
    title: 'Motion identity',
    caption: 'One consistent feel across every component.',
    colSpan: 2,
    rowSpan: 1,
    accent: false,
  },
  {
    title: 'Render',
    value: '4K',
    caption: 'Deterministic, frame-perfect.',
    colSpan: 1,
    rowSpan: 1,
  },
  {
    title: 'Components',
    value: '40+',
    caption: 'Copied into your project.',
    colSpan: 1,
    rowSpan: 1,
  },
  { title: 'Spring physics', caption: 'No overshoot. Calm by default.', colSpan: 2, rowSpan: 1 },
]

/** A placed cell: its item plus the resolved pixel rectangle and grid index. */
type PlacedCell = {
  item: BentoItem
  index: number
  x: number
  y: number
  w: number
  h: number
}

/** Approximate average glyph advance as a fraction of font size (proportional
 *  display fonts). Used only to greedily word-wrap the caption — the engine
 *  measures text at render, but a pure frame→scene function can't read those
 *  measurements back, so this estimate stands in (matches the `Marquee` port). */
const AVG_CHAR_W = 0.55

/** Greedy word-wrap into lines that each fit `maxWidth` at the given font size.
 *  A single over-long word is kept on its own line rather than split. */
function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0)
  if (words.length === 0) return []
  const charPx = fontSize * AVG_CHAR_W
  const maxChars = Math.max(1, Math.floor(maxWidth / charPx))
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`
    if (candidate.length <= maxChars || current.length === 0) {
      current = candidate
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current.length > 0) lines.push(current)
  return lines
}

/**
 * Pack the items into pixel rectangles, replicating CSS `grid-auto-flow: row`:
 * scan rows top-to-bottom; within each row, find the first column where a run of
 * `colSpan` free cells fits; reserve `colSpan × rowSpan` cells. An occupancy map
 * (per row, per column) tracks cells claimed by earlier multi-row items.
 */
function packCells(
  items: BentoItem[],
  columns: number,
  colWidth: number,
  rowHeight: number,
  gap: number,
): { cells: PlacedCell[]; rows: number } {
  const occupied: boolean[][] = []
  const ensureRow = (r: number) => {
    while (occupied.length <= r) occupied.push(new Array<boolean>(columns).fill(false))
  }
  const cells: PlacedCell[] = []
  let cursorRow = 0
  let cursorCol = 0

  items.forEach((item, index) => {
    const colSpan = Math.max(1, Math.min(item.colSpan ?? 1, columns))
    const rowSpan = Math.max(1, item.rowSpan ?? 1)

    // Find the first (row, col) where a colSpan-wide, rowSpan-tall block is free,
    // scanning from the running cursor onward (auto-flow is monotonic).
    let placedRow = cursorRow
    let placedCol = cursorCol
    let found = false
    while (!found) {
      ensureRow(placedRow + rowSpan - 1)
      if (placedCol + colSpan <= columns) {
        let free = true
        for (let dr = 0; dr < rowSpan && free; dr++) {
          const row = occupied[placedRow + dr] ?? []
          for (let dc = 0; dc < colSpan; dc++) {
            if (row[placedCol + dc] === true) {
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
      placedCol += 1
      if (placedCol + colSpan > columns) {
        placedCol = 0
        placedRow += 1
      }
    }

    // Reserve the block.
    for (let dr = 0; dr < rowSpan; dr++) {
      ensureRow(placedRow + dr)
      const row = occupied[placedRow + dr]
      if (row) {
        for (let dc = 0; dc < colSpan; dc++) row[placedCol + dc] = true
      }
    }

    cells.push({
      item,
      index,
      x: placedCol * (colWidth + gap),
      y: placedRow * (rowHeight + gap),
      w: colSpan * colWidth + (colSpan - 1) * gap,
      h: rowSpan * rowHeight + (rowSpan - 1) * gap,
    })

    // Advance the cursor just past this block on its first row.
    cursorRow = placedRow
    cursorCol = placedCol + colSpan
    if (cursorCol >= columns) {
      cursorCol = 0
      cursorRow = placedRow + 1
    }
  })

  return { cells, rows: occupied.length }
}

export function BentoGrid({
  items = DEFAULT_ITEMS,
  columns = 3,
  gap = 24,
  width = 960,
  rowHeight,
  padding = 34,
  delay = 0,
  stagger = STAGGER,
  fontSize = 30,
  color: colorProp,
  captionColor: captionColorProp,
  accentColor: accentColorProp,
  cardColor: cardColorProp,
  borderColor: borderColorProp,
  fontFamily: fontFamilyProp,
  captionFontFamily: captionFontFamilyProp,
}: BentoGridProps) {
  const { width: canvasW, height: canvasH } = useVideoConfig()

  // One hook call, then a per-index entrance — never a hook in a loop.
  const at = useStaggeredEntrance({ type: 'rise', delay, increment: stagger })

  const theme = useTheme()
  const color = colorProp ?? theme.text
  const captionColor = captionColorProp ?? theme.textMuted
  const accentColor = accentColorProp ?? theme.accent
  const cardColor = cardColorProp ?? theme.surface
  const borderColor = borderColorProp ?? theme.border
  const fontFamily = fontFamilyProp ?? theme.headingFamily ?? theme.fontFamily
  const captionFontFamily = captionFontFamilyProp ?? theme.fontFamily

  const cols = Math.max(1, Math.round(columns))
  // Column-track width from the overall grid width (CSS `repeat(cols, 1fr)`).
  const colWidth = (width - (cols - 1) * gap) / cols
  // Without intrinsic row sizing, default rows to the column width (≈ square
  // cells) — a balanced bento that reads the same at any aspect ratio.
  const trackHeight = rowHeight ?? colWidth

  const { cells, rows } = packCells(items, cols, colWidth, trackHeight, gap)

  // Actual packed footprint. The declared `width` is an upper bound: if the
  // last column ends up empty (the packer left a trailing track), the real
  // content is narrower, so center on the measured extent — not `width` — to
  // keep the margins symmetric. Height likewise has no trailing gap.
  const gridWidth = cells.length > 0 ? Math.max(...cells.map((c) => c.x + c.w)) : width
  const gridHeight = rows > 0 ? rows * trackHeight + (rows - 1) * gap : 0

  // Self-center the fixed-size grid by computing its top-left offset directly —
  // no layout container, so the per-frame entrance translate never reflows.
  const originX = Math.round((canvasW - gridWidth) / 2)
  const originY = Math.round((canvasH - gridHeight) / 2)

  const radius = theme.radius
  const valueSize = Math.round(fontSize * 1.8)
  const captionSize = Math.round(fontSize * 0.56)

  // Faint top sheen: white-alpha gradient over the top ~40% of a card, fading to
  // transparent (GPU-only; CPU collapses to the transparent first stop).
  const sheenTransparent = '#ffffff00'
  const sheenLit = '#ffffff10'

  return (
    <Group x={originX} y={originY}>
      {cells.map((cell) => {
        const entrance = at(cell.index)
        const isAccent = cell.item.accent === true
        const cardBorder = isAccent ? accentColor : borderColor
        const valueColor = isAccent ? accentColor : color

        // Inner content box (bottom-aligned column, like the ondajs Surface).
        const contentW = Math.max(0, cell.w - padding * 2)

        // Bottom-up layout: caption, then title, then value — measured up from the
        // card's bottom padding edge. Each block uses its font size as a line-box
        // proxy (the engine box can't be read back here).
        const captionLines = cell.item.caption
          ? wrapText(cell.item.caption, contentW, captionSize)
          : []
        const captionLineH = Math.round(captionSize * 1.45)
        const titleLineH = Math.round(fontSize * 1.1)
        const blockGap = 8

        // Compute baseline-top offsets from the card bottom, walking upward.
        let cursorBottom = cell.h - padding
        // Caption (lowest block).
        const captionTops: number[] = []
        for (let i = captionLines.length - 1; i >= 0; i--) {
          cursorBottom -= captionLineH
          captionTops[i] = cursorBottom
        }
        if (captionLines.length > 0) cursorBottom -= blockGap
        // Title.
        cursorBottom -= titleLineH
        const titleTop = cursorBottom
        // Value (highest block), if present.
        let valueTop = titleTop
        if (cell.item.value) {
          cursorBottom -= blockGap
          cursorBottom -= valueSize
          valueTop = cursorBottom
        }

        return (
          // Outer Group: fixed pixel placement (explicit x/y — not Flex).
          <Group key={`${cell.index}-${cell.item.title}`} x={cell.x} y={cell.y}>
            {/* Inner Group: entrance opacity + rise translate (layout-safe here
                because the parent is not a layout container). */}
            <Group y={entrance.y} opacity={entrance.opacity}>
              {/* Glass card: translucent fill + 1px stroke. (Could adopt the new
                  `backdropBlur` prop for true frosted glass.) */}
              <Rect
                width={cell.w}
                height={cell.h}
                cornerRadius={radius}
                fill={cardColor}
                stroke={cardBorder}
                strokeWidth={1}
              />
              {/* Top sheen overlay (GPU-only). */}
              <Rect
                width={cell.w}
                height={Math.round(cell.h * 0.4)}
                cornerRadius={radius}
                gradient={linearGradient(
                  [0, 0],
                  [0, Math.round(cell.h * 0.4)],
                  [
                    { offset: 0, color: sheenTransparent },
                    { offset: 0.01, color: sheenLit },
                    { offset: 1, color: sheenTransparent },
                  ],
                )}
              />

              {/* Value (large, accent on the earned cell). */}
              {cell.item.value ? (
                <Text
                  x={padding}
                  y={valueTop}
                  fontSize={valueSize}
                  color={valueColor}
                  fontFamily={fontFamily}
                  fontWeight={600}
                >
                  {cell.item.value}
                </Text>
              ) : null}

              {/* Title. */}
              <Text
                x={padding}
                y={titleTop}
                fontSize={fontSize}
                color={color}
                fontFamily={fontFamily}
                fontWeight={600}
              >
                {cell.item.title}
              </Text>

              {/* Caption (wrapped to the content width). */}
              {captionLines.map((line, li) => (
                <Text
                  key={li}
                  x={padding}
                  y={captionTops[li] ?? cell.h - padding}
                  fontSize={captionSize}
                  color={captionColor}
                  fontFamily={captionFontFamily ?? fontFamily}
                  fontWeight={400}
                >
                  {line}
                </Text>
              ))}
            </Group>
          </Group>
        )
      })}
    </Group>
  )
}
