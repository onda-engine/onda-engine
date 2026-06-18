//! KanbanBoard — a data-driven board: a row of glass columns, each with a header
//! (status dot, title, ticket count) and a vertical stack of small ticket cards.
//! Every card rises + fades in on the house spring, staggered across the whole
//! board on a single flat running index (left-to-right, top-to-bottom) so it
//! assembles as one calm cascade. The board is static after the entrance.
//! Ported from ondajs (`kanban-board`).
//!
//! Layout is computed manually with explicit x/y inside `<Group>`s — NOT a
//! `<Flex>` — for two scene reasons: (1) each card's entrance is a per-frame
//! TRANSLATE (rise), and a Flex both clobbers a direct child's x/y and reflows
//! (jiggles) as the measured subtree grows; (2) `<Text>` is single-line, so card
//! heights are fixed from the label font size rather than measured. Columns are
//! equal-width, splitting `width` minus the inter-column gaps.
//!
//! Scene caveats: scale/rotation are unused here, so the local-origin pivot does
//! not bite. Colors with alpha (`#rrggbbaa`) stand in for the original glass
//! Surface (see approximations).

import {
  Ellipse,
  Group,
  Rect,
  Text,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda-engine/react'
import { DURATION, SPRING_SMOOTH, STAGGER, staggerFrames } from '../motion.js'
import { type TextStyleProps, applyTextCase } from '../text-style.js'
import { useTheme } from '../theme.js'
import { type TimeInput, framesOf } from '../time.js'

/** A single Kanban column: a header, an optional accent, and its ticket cards. */
export interface KanbanColumn {
  /** Column header, e.g. `'In Progress'`. */
  title: string
  /** Status-dot + count color for this column. Defaults to a neutral faint token;
   *  one column should earn the accent. */
  accent?: string
  /** Ticket labels — one small card per entry, top-to-bottom. Single-line each. */
  cards?: string[]
}

export interface KanbanBoardProps extends TextStyleProps {
  /** The columns, laid out left-to-right. Each holds its own ticket cards. */
  columns?: KanbanColumn[]
  /** Overall board width in px. Split evenly across the columns. */
  width?: number
  /** Gap between columns (and between cards within a column) in px. */
  gap?: number
  /** Frames before the first card enters. */
  delay?: TimeInput
  /** Frames between successive cards rising in (house stagger = 4). */
  stagger?: TimeInput
  /** Base column-header font size in px. */
  fontSize?: number
  /** Default accent for the dot/count when a column omits its own (default: theme `accent`). */
  accent?: string
  /** Header / title text color (default: theme `text`). */
  textColor?: string
  /** Ticket-label text color (default: theme `textMuted`). */
  cardTextColor?: string
  /** Faint color for neutral dots, counts, and card accent stripes (default: theme `textMuted`). */
  faintColor?: string
  /** Glass column fill (translucent — see approximations) (default: theme `surface`). */
  columnFill?: string
  /** Glass column border color (default: theme `border`). */
  columnStroke?: string
  /** Ticket card fill (translucent — see approximations) (default: theme `surface`). */
  cardFill?: string
}

const DEFAULT_COLUMNS: KanbanColumn[] = [
  {
    title: 'Todo',
    cards: ['Storyboard the intro', 'Source b-roll', 'Write VO script'],
  },
  {
    title: 'In Progress',
    accent: '#d96b82',
    cards: ['Animate the title card', 'Color-grade scene 2'],
  },
  {
    title: 'Done',
    cards: ['Lock the edit', 'Render preview', 'Sound pass', 'Export master'],
  },
]

export function KanbanBoard({
  columns = DEFAULT_COLUMNS,
  width = 1040,
  gap = 20,
  delay: delayIn = 0,
  stagger: staggerIn = STAGGER,
  fontSize = 22,
  fontFamily: fontFamilyProp,
  letterSpacing,
  uppercase,
  accent: accentProp,
  textColor: textColorProp,
  cardTextColor: cardTextColorProp,
  faintColor: faintColorProp,
  columnFill: columnFillProp,
  columnStroke: columnStrokeProp,
  cardFill: cardFillProp,
}: KanbanBoardProps) {
  const frame = useCurrentFrame()
  const { fps, width: canvasW, height: canvasH } = useVideoConfig()
  // TimeInput props -> frames (accepts numbers or '0.5s'/'500ms'/'12f').
  const delay = framesOf(delayIn, fps)
  const stagger = framesOf(staggerIn, fps)
  const theme = useTheme()
  const fontFamily = fontFamilyProp ?? theme.fontFamily
  const accent = accentProp ?? theme.accent
  const textColor = textColorProp ?? theme.text
  const cardTextColor = cardTextColorProp ?? theme.textMuted
  const faintColor = faintColorProp ?? theme.textMuted
  const columnFill = columnFillProp ?? theme.surface
  const columnStroke = columnStrokeProp ?? theme.border
  const cardFill = cardFillProp ?? theme.surface

  // Soft elevation shadows: tinted toward the canvas bg (never hard black) so
  // cards read as panels floating above the near-surface column. The active
  // card swaps the neutral tint for a faint accent-tinted glow.
  const shadowTint = withAlpha(theme.background, 0.45)
  const shadowGlow = withAlpha(accent, 0.28)

  const headerSize = fontSize
  const cardSize = Math.round(headerSize * 0.82)

  // Inner padding of each column (ondajs: padding ≈ 0.9 * gap).
  const pad = Math.round(gap * 0.9)
  // Vertical gap between ticket cards (ondajs: 0.6 * gap).
  const cardGap = Math.round(gap * 0.6)
  // Inner padding inside each ticket card (ondajs: 0.7 * gap).
  const cardPad = Math.round(gap * 0.7)

  const dotSize = Math.round(cardSize * 0.42)
  const countSize = Math.round(cardSize * 0.78)
  // Header row height = the tallest of its inline parts.
  const headerH = Math.max(headerSize, dotSize, countSize)
  // Single-line label height + vertical padding on both sides.
  const cardH = cardSize + cardPad * 2
  // Accent stripe on the left edge of each card.
  const stripeW = 3
  const stripeGap = 8

  // Equal-width columns split `width` minus the (n-1) inter-column gaps.
  const n = Math.max(1, columns.length)
  const colWidth = Math.max(1, Math.floor((width - gap * (n - 1)) / n))

  // Board height = tallest column (header + its full card stack), so we can
  // center the fixed-size board by computing its top-left offset directly — no
  // layout container chasing the per-frame rise.
  const columnHeight = (col: KanbanColumn): number => {
    const cards = col.cards ?? []
    const stackH = cards.length > 0 ? cards.length * cardH + (cards.length - 1) * cardGap : 0
    const inner = headerH + (stackH > 0 ? gap + stackH : 0)
    return inner + pad * 2
  }
  const boardHeight = columns.reduce((m, col) => Math.max(m, columnHeight(col)), 0)

  const originX = Math.round((canvasW - width) / 2)
  const originY = Math.round((canvasH - boardHeight) / 2)

  // Flat running index across all cards keeps the cascade reading
  // left-to-right, top-to-bottom across the whole board.
  let cardIndex = 0

  return (
    <Group x={originX} y={originY}>
      {columns.map((col, ci) => {
        const colAccent = col.accent ?? accent
        const hasAccent = col.accent != null
        const dotColor = hasAccent ? colAccent : faintColor
        const countColor = hasAccent ? colAccent : faintColor
        const cards = col.cards ?? []
        const colX = ci * (colWidth + gap)

        return (
          <Group key={`${ci}-${col.title}`} x={colX} y={0}>
            {/* Glass column surface (translucent fill + faint border). */}
            <Rect
              x={0}
              y={0}
              width={colWidth}
              height={boardHeight}
              cornerRadius={16}
              fill={columnFill}
              stroke={columnStroke}
              strokeWidth={1}
            />

            {/* Column header: status dot · title · ticket count. */}
            <Group x={pad} y={pad}>
              <Ellipse
                x={0}
                y={Math.round((headerH - dotSize) / 2)}
                width={dotSize}
                height={dotSize}
                fill={dotColor}
              />
              <Text
                x={dotSize + 10}
                y={Math.round((headerH - headerSize) / 2)}
                fontSize={headerSize}
                color={textColor}
                fontFamily={fontFamily}
                fontWeight={600}
                letterSpacing={letterSpacing}
              >
                {applyTextCase(col.title, { uppercase })}
              </Text>
              {/* Count — right-aligned within the inner column width. The engine
                  measures text from its own origin (no right-align), so we offset
                  by an estimated glyph advance; close enough for a 1–2 digit
                  count (see approximations). */}
              <Text
                x={colWidth - pad * 2 - countSize * (`${cards.length}`.length * 0.62)}
                y={Math.round((headerH - countSize) / 2)}
                fontSize={countSize}
                color={countColor}
                fontFamily={fontFamily}
                fontWeight={500}
              >
                {`${cards.length}`}
              </Text>
            </Group>

            {/* Ticket cards — each rises + fades in on the flat running stagger. */}
            <Group x={pad} y={pad + headerH + gap}>
              {cards.map((label, ti) => {
                // One earned accent: the active/priority card is the FIRST card
                // of the accented column. It alone gets the live accent stripe +
                // a soft accent glow; every other card stays calm and faint.
                const isActive = hasAccent && ti === 0
                const stripeColor = isActive ? colAccent : faintColor
                const stripeOpacity = isActive ? 1 : 0.35

                const cardDelay = delay + staggerFrames(cardIndex, stagger)
                cardIndex += 1

                const local = Math.max(0, frame - cardDelay)
                const progress = spring({
                  frame: local,
                  fps,
                  config: SPRING_SMOOTH,
                  durationInFrames: DURATION.base,
                })
                const opacity = interpolate(progress, [0, 1], [0, 1], {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                })
                const rise = interpolate(progress, [0, 1], [16, 0], {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                })

                const cardY = ti * (cardH + cardGap)
                const cardInnerW = colWidth - pad * 2

                return (
                  // Outer Group: explicit layout position (x/y). Inner Group:
                  // motion rise + opacity. Nesting keeps the translate off the
                  // layout-positioned node.
                  <Group key={`${ti}-${label}`} x={0} y={cardY}>
                    <Group y={rise} opacity={opacity}>
                      {/* Soft elevation shadow tinted toward the canvas bg (not
                          hard black) so cards read as floating above the column.
                          The active card earns a faint accent-tinted glow. */}
                      <Rect
                        x={0}
                        y={0}
                        width={cardInnerW}
                        height={cardH}
                        cornerRadius={8}
                        fill={cardFill}
                        stroke={columnStroke}
                        strokeWidth={1}
                        shadow={
                          isActive
                            ? { color: shadowGlow, blur: 26, offsetY: 8, spread: -2 }
                            : { color: shadowTint, blur: 22, offsetY: 8, spread: -4 }
                        }
                      />
                      {/* Left accent stripe — live accent only on the active card. */}
                      <Rect
                        x={cardPad}
                        y={cardPad}
                        width={stripeW}
                        height={cardH - cardPad * 2}
                        cornerRadius={2}
                        fill={stripeColor}
                        opacity={stripeOpacity}
                      />
                      <Text
                        x={cardPad + stripeW + stripeGap}
                        y={cardPad}
                        fontSize={cardSize}
                        color={isActive ? textColor : cardTextColor}
                        fontFamily={fontFamily}
                        fontWeight={isActive ? 500 : 400}
                      >
                        {label}
                      </Text>
                    </Group>
                  </Group>
                )
              })}
            </Group>
          </Group>
        )
      })}
    </Group>
  )
}

/** Parse a 2-char hex byte to 0..255, defaulting to 0. */
function hx(byte: string): number {
  const v = Number.parseInt(byte, 16)
  return Number.isNaN(v) ? 0 : v
}

/** Two-digit hex for a 0..255 channel. */
function toHexByte(v: number): string {
  const c = Math.max(0, Math.min(255, Math.round(v)))
  return c.toString(16).padStart(2, '0')
}

/** Parse `#rgb` / `#rrggbb` / `#rrggbbaa` to an RGB triple. */
function parseRgb(color: string): [number, number, number] {
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    if (hex.length === 3) {
      const r = hex[0] ?? '0'
      const g = hex[1] ?? '0'
      const b = hex[2] ?? '0'
      return [hx(`${r}${r}`), hx(`${g}${g}`), hx(`${b}${b}`)]
    }
    if (hex.length === 6 || hex.length === 8) {
      return [hx(hex.slice(0, 2)), hx(hex.slice(2, 4)), hx(hex.slice(4, 6))]
    }
  }
  return [0, 0, 0]
}

/** Return `color`'s RGB with the given alpha (0..1) as `#rrggbbaa`. */
function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = parseRgb(color)
  const a = Math.max(0, Math.min(1, alpha)) * 255
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}${toHexByte(a)}`
}
