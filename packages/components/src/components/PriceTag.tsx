//! PriceTag — a compact, premium PRODUCT price chip for e-commerce shots: the
//! product name set in the display face with the price emphasized beside it, in a
//! rounded surface chip (hairline border + a soft shadow). DISTINCT from
//! `PricingCard` (subscription tiers) — this is a small label/tag you drop next to
//! or beneath a product photo, the single most-requested e-comm block.
//!
//! Layout: one tasteful row — the name on the left, a thin divider, the accent
//! price on the right — sized to the measured text so the chip hugs its content
//! (the engine measures the shaped widths; a glyph-count estimate stands in until
//! the wasm engine warms). When `sold`, a small muted SOLD pill sits after the
//! price and the price is dimmed + struck through.
//!
//! Motion: the chip fades + rises in on the house spring (no overshoot — restrained,
//! premium). The whole chip is ONE unit (no clip — sidesteps the renderer's
//! clip-occludes-later-siblings issue). Centered on the canvas by default; pass
//! `x`/`y` for the chip's top-left to place it explicitly.

import {
  Group,
  Rect,
  Text,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import { DURATION, SPRING_SMOOTH } from '../motion.js'
import { useTextMetrics } from '../text-metrics.js'
import { useTheme } from '../theme.js'

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** Engine line-box height as a multiple of font size (matches typography crate). */
const LINE_RATIO = 1.2

export interface PriceTagProps {
  /** Product name — the label, set in the display face. */
  name?: string
  /** Price as a string so any currency works (e.g. `'$70'`, `'€19'`, `'£12.50'`). */
  price?: string
  /** Show the SOLD state — dims + strikes the price and appends a muted pill. */
  sold?: boolean
  /** The SOLD pill label. */
  soldLabel?: string
  /** Frames before the chip enters. */
  delay?: number
  /** Base scale for the chip (1 = the default size). Scales type + padding together. */
  size?: number
  /** Name text color (default: theme `text`). */
  color?: string
  /** Price text color (default: theme `accent`). */
  priceColor?: string
  /** Divider + SOLD-pill accent color (default: theme `accent`). */
  accentColor?: string
  /** Chip fill color (default: theme `surface`). */
  surface?: string
  /** Chip hairline border color (default: theme `border`). */
  border?: string
  /** Display font for the name (default: theme `headingFamily ?? fontFamily`). */
  fontFamily?: string
  /** Body font for the price + SOLD pill (default: theme `fontFamily`). */
  bodyFamily?: string
  /** Local-space x of the chip's top-left. Omit to center on the composition. */
  x?: number
  /** Local-space y of the chip's top-left. Omit to center on the composition. */
  y?: number
}

export function PriceTag({
  name = 'Product',
  price = '$0',
  sold = false,
  soldLabel = 'SOLD',
  delay = 0,
  size = 1,
  color: colorProp,
  priceColor: priceColorProp,
  accentColor: accentColorProp,
  surface: surfaceProp,
  border: borderProp,
  fontFamily: fontFamilyProp,
  bodyFamily: bodyFamilyProp,
  x,
  y,
}: PriceTagProps) {
  const frame = useCurrentFrame()
  const { fps, width: W, height: H } = useVideoConfig()
  const theme = useTheme()

  const color = colorProp ?? theme.text
  const priceColor = priceColorProp ?? theme.accent
  const accent = accentColorProp ?? theme.accent
  const surface = surfaceProp ?? theme.surface
  const border = borderProp ?? theme.border
  const nameFont = fontFamilyProp ?? theme.headingFamily ?? theme.fontFamily
  const bodyFont = bodyFamilyProp ?? theme.fontFamily

  // ── Sizing (scaled by `size`) ──────────────────────────────────────────────
  const nameSize = Math.round(36 * size)
  const priceSize = Math.round(34 * size)
  const soldSize = Math.round(15 * size)
  const padX = Math.round(28 * size)
  const padY = Math.round(20 * size)
  const gap = Math.round(20 * size) // between name and divider/price
  const dividerW = Math.max(1, Math.round(1 * size))
  const soldGap = Math.round(14 * size)

  // ── Measured text widths (the chip hugs its content) ───────────────────────
  const nameMetrics = useTextMetrics(name, nameSize, { fontFamily: nameFont, fontWeight: 500 })
  const priceMetrics = useTextMetrics(price, priceSize, { fontFamily: bodyFont, fontWeight: 600 })
  const soldMetrics = useTextMetrics(soldLabel, soldSize, {
    fontFamily: bodyFont,
    fontWeight: 600,
    letterSpacing: soldSize * 0.12,
  })

  // SOLD pill geometry (letterspaced caps run wide — pad generously).
  const soldPadX = Math.round(12 * size)
  const soldTracking = soldSize * 0.12
  const soldTextW = soldMetrics.width + soldTracking
  const soldPillW = sold ? Math.round(soldTextW + soldPadX * 2) : 0
  const soldPillH = Math.round(soldSize * LINE_RATIO + 8 * size)

  // ── Chip geometry ──────────────────────────────────────────────────────────
  const contentW =
    nameMetrics.width + gap + dividerW + gap + priceMetrics.width + (sold ? soldGap + soldPillW : 0)
  const rowH = Math.max(nameSize, priceSize) * LINE_RATIO
  const chipW = Math.round(contentW + padX * 2)
  const chipH = Math.round(rowH + padY * 2)
  const radius = Math.min(theme.radius + 6, Math.round(chipH / 2))

  const originX = x ?? Math.round((W - chipW) / 2)
  const originY = y ?? Math.round((H - chipH) / 2)

  // ── Entrance: fade + small rise on the house spring ────────────────────────
  const enter = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: SPRING_SMOOTH,
    durationInFrames: DURATION.base,
  })
  const opacity = interpolate(enter, [0, 1], [0, 1], CLAMP)
  const riseY = interpolate(enter, [0, 1], [16, 0], CLAMP)

  // ── Row cursor (within the padded content box) ─────────────────────────────
  const nameX = padX
  const dividerX = nameX + nameMetrics.width + gap
  const priceX = dividerX + dividerW + gap
  const soldX = priceX + priceMetrics.width + soldGap
  // Vertical centering of each text's line box inside the row.
  const nameY = padY + Math.round((rowH - nameSize * LINE_RATIO) / 2)
  const priceY = padY + Math.round((rowH - priceSize * LINE_RATIO) / 2)
  const dividerY = padY + Math.round((rowH - rowH * 0.62) / 2)
  const dividerH = Math.round(rowH * 0.62)
  const soldPillY = padY + Math.round((rowH - soldPillH) / 2)

  const soldColor = theme.textMuted
  const struckPrice = sold ? soldColor : priceColor

  return (
    <Group x={originX} y={originY + riseY} opacity={opacity}>
      {/* Chip surface — soft shadow, hairline border. */}
      <Rect
        width={chipW}
        height={chipH}
        cornerRadius={radius}
        fill={surface}
        stroke={border}
        strokeWidth={1}
        shadow={{ color: '#00000040', blur: 28, offsetX: 0, offsetY: 12 }}
      />

      {/* Product name (display face). */}
      <Text
        x={nameX}
        y={nameY}
        fontSize={nameSize}
        color={color}
        fontFamily={nameFont}
        fontWeight={500}
      >
        {name}
      </Text>

      {/* Thin accent divider between name and price. */}
      <Rect x={dividerX} y={dividerY} width={dividerW} height={dividerH} fill={accent} />

      {/* Price (body face, accent / bolder). Dimmed + struck when sold. */}
      <Text
        x={priceX}
        y={priceY}
        fontSize={priceSize}
        color={struckPrice}
        fontFamily={bodyFont}
        fontWeight={600}
      >
        {price}
      </Text>
      {sold ? (
        <Rect
          x={priceX}
          y={priceY + Math.round(priceSize * 0.52)}
          width={priceMetrics.width}
          height={Math.max(1, Math.round(2 * size))}
          fill={soldColor}
        />
      ) : null}

      {/* SOLD pill — muted outline after the price. */}
      {sold ? (
        <Group x={soldX} y={soldPillY}>
          <Rect
            width={soldPillW}
            height={soldPillH}
            cornerRadius={soldPillH / 2}
            fill="#00000000"
            stroke={soldColor}
            strokeWidth={1}
          />
          <Text
            x={soldPadX}
            y={Math.round((soldPillH - soldSize * LINE_RATIO) / 2)}
            fontSize={soldSize}
            letterSpacing={soldTracking}
            color={soldColor}
            fontFamily={bodyFont}
            fontWeight={600}
          >
            {soldLabel}
          </Text>
        </Group>
      ) : null}
    </Group>
  )
}
