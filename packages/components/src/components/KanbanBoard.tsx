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
} from '@onda/react'
import { DURATION, SPRING_SMOOTH, STAGGER, staggerFrames } from '../motion.js'

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

export interface KanbanBoardProps {
  /** The columns, laid out left-to-right. Each holds its own ticket cards. */
  columns?: KanbanColumn[]
  /** Overall board width in px. Split evenly across the columns. */
  width?: number
  /** Gap between columns (and between cards within a column) in px. */
  gap?: number
  /** Frames before the first card enters. */
  delay?: number
  /** Frames between successive cards rising in (house stagger = 4). */
  stagger?: number
  /** Base column-header font size in px. */
  fontSize?: number
  /** Loaded font family for headers and ticket labels. */
  fontFamily?: string
  /** Default accent for the dot/count when a column omits its own. */
  accent?: string
  /** Header / title text color. */
  textColor?: string
  /** Ticket-label text color. */
  cardTextColor?: string
  /** Faint color for neutral dots, counts, and card accent stripes. */
  faintColor?: string
  /** Glass column fill (translucent — see approximations). */
  columnFill?: string
  /** Glass column border color. */
  columnStroke?: string
  /** Ticket card fill (translucent — see approximations). */
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
  delay = 0,
  stagger = STAGGER,
  fontSize = 22,
  fontFamily,
  accent = '#d96b82',
  textColor = '#f2f2f4',
  cardTextColor = '#8e8e98',
  faintColor = '#56565f',
  columnFill = '#ffffff14',
  columnStroke = '#ffffff1f',
  cardFill = '#ffffff0f',
}: KanbanBoardProps) {
  const frame = useCurrentFrame()
  const { fps, width: canvasW, height: canvasH } = useVideoConfig()

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
        const stripeColor = hasAccent ? colAccent : faintColor
        const stripeOpacity = hasAccent ? 0.9 : 0.4
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
              >
                {col.title}
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
                const rise = interpolate(progress, [0, 1], [12, 0], {
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
                      <Rect
                        x={0}
                        y={0}
                        width={cardInnerW}
                        height={cardH}
                        cornerRadius={8}
                        fill={cardFill}
                      />
                      {/* Left accent stripe. */}
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
                        color={cardTextColor}
                        fontFamily={fontFamily}
                        fontWeight={400}
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
