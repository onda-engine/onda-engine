//! BrowserFrame — a browser-window chrome that wraps arbitrary content. A top
//! bar with three "traffic-light" dots and an address pill, then a clipped
//! content area below it. Ported from ondajs (`browser-frame`).
//!
//! This is a CONTAINER, not a leaf — the documented exception to the
//! "self-contained" rule, since wrapping content is its whole job. Pass
//! `children` (scene nodes), an image `src` (shown when there are no children),
//! or neither (a neutral placeholder showing the URL). It scales-and-fades in on
//! the house spring (`entryScale`, default `from` 0.96 — restrained), matching
//! the ondajs entrance.
//!
//! Layout: the frame has FIXED dimensions, so it is centered by computing its
//! position from the composition size directly (no `<AbsoluteFill>`) — a layout
//! container would chase the animated subtree. The scale-in pivots on the
//! frame's CENTER: scene scale is about a node's local origin (0,0), so the
//! entrance `<Group>` sits at the frame's center and its body is drawn from
//! `(-cardWidth/2, -cardHeight/2)`, so growth reads as centered, not corner-
//! anchored.
//!
//! Children render at the content area's local origin (0,0) and are masked to it
//! by `clipRect` (which is local-space, anchored at the parent `<Group>`'s
//! origin — sized width×height, no offset).
//!
//! Approximations vs ondajs: the engine has no `object-fit: cover` for images,
//! so a provided `src` is scaled to fill the content WIDTH (uniform scale) from
//! the top-left; the clip hides any vertical overflow (it cannot fill a gap if
//! the image is taller-cropped than the source — pass a landscape image). ondajs
//! cover-crops both axes. The pill text and the placeholder are single-line (the
//! engine doesn't auto-wrap) and left-aligned (no center/right text-align),
//! clipped to the pill box. No drop shadow under the card (no box-shadow
//! primitive) — a 1px border stands in for the card's edge, as in ondajs (which
//! also paints a 1px border). No CSS letter-spacing on the pill text, and no top
//! "sheen" overlay (a 1px highlight gradient ondajs draws on its Surface).

import {
  Ellipse,
  Group,
  Image,
  Rect,
  Text,
  clipRect,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import type { ReactNode } from 'react'
import { entryScale } from '../choreography.js'
import { DURATION } from '../motion.js'

// Onda palette tokens (from ondajs `lib/tokens.ts`), inlined as hex since the
// engine has no CSS-variable resolution.
const BG = '#08080a' // near-black content canvas
const SURFACE = '#0e0e12' // card body
const SURFACE_2 = '#121217' // address-pill fill
const BORDER = '#1c1c22' // 1px borders / chrome divider
const BORDER_LIT = '#26262e' // traffic-light dots
const DIM = '#8e8e98' // pill (url) text
const FAINT = '#56565f' // placeholder text

// Card geometry (matches ondajs: RADIUS.lg = 20 corners, the chrome bar's 16/22px
// padding, 18px dots with a 10px gap, a 40px-tall pill).
const CARD_RADIUS = 20
const CHROME_PAD_Y = 16
const CHROME_PAD_X = 22
const DOT_SIZE = 18
const DOT_GAP = 10
const PILL_HEIGHT = 40
const PILL_RADIUS = PILL_HEIGHT / 2
// Gap between the last dot and the pill. In ondajs the chrome row is a flex
// container with `gap: 10` AND the pill carries `marginLeft: 16`, so the
// last-dot → pill distance is the sum of both.
const PILL_GAP = DOT_GAP + 16 // = 26
const PILL_PAD_X = 20 // inner horizontal padding of the pill
const PILL_FONT = 22
const PLACEHOLDER_FONT = 32
// Approx average glyph advance as a fraction of font size, for roughly centering
// the single-line placeholder text (the engine measures at render time, but a
// pure frame->scene function can't read those measurements back).
const AVG_CHAR_W = 0.55

// The taller of the dots / pill — the run of content the chrome bar sizes to.
const CHROME_ROW = Math.max(DOT_SIZE, PILL_HEIGHT)
// Chrome bar height: vertical padding around that row.
const CHROME_HEIGHT = CHROME_PAD_Y * 2 + CHROME_ROW

export interface BrowserFrameProps {
  /** URL shown in the address pill (and as the placeholder when empty). */
  url?: string
  /** Image to show inside the frame when no `children` are passed. Scaled to
   *  fill the content width (see approximations). */
  src?: string
  /** Frames before the entrance. */
  delay?: number
  /** Scale-and-fade the frame in on the house spring. */
  animate?: boolean
  /** Frame (and content) width in px. */
  width?: number
  /** Content height in px (excludes the chrome bar). */
  height?: number
  /** Starting scale for the entrance (default 0.96 — restrained, like ondajs). */
  from?: number
  /** Content to wrap; renders at the content area's local origin (0,0). */
  children?: ReactNode
}

export function BrowserFrame({
  url = 'onda.video',
  src,
  delay = 0,
  animate = true,
  width = 1280,
  height = 720,
  from = 0.96,
  children,
}: BrowserFrameProps) {
  const frame = useCurrentFrame()
  const { width: compWidth, height: compHeight, fps } = useVideoConfig()

  // Total card footprint: chrome bar on top, content area below.
  const cardWidth = width
  const cardHeight = CHROME_HEIGHT + height

  // Center the fixed-size card on the canvas.
  const centerX = compWidth / 2
  const centerY = compHeight / 2
  // Body drawn from the card's top-left, expressed relative to its center so the
  // entrance scale pivots on the center.
  const bodyX = -cardWidth / 2
  const bodyY = -cardHeight / 2

  // House spring scale + fade. Matches ondajs `useEntrance({ type: 'scale',
  // from: 0.96 })`, which uses the hook's default duration (DURATION.base).
  const motion = animate
    ? entryScale({ frame, fps, delay, durationInFrames: DURATION.base, from })
    : { opacity: 1, scaleX: 1, scaleY: 1 }

  // Dots: three traffic lights at the chrome bar's left, vertically centered.
  const dotY = CHROME_PAD_Y + (CHROME_ROW - DOT_SIZE) / 2
  const dotXs = [0, 1, 2].map((i) => CHROME_PAD_X + i * (DOT_SIZE + DOT_GAP))
  const lastDotRight = (dotXs[2] ?? CHROME_PAD_X) + DOT_SIZE

  // Pill: fills the remaining chrome width to the right of the dots.
  const pillX = lastDotRight + PILL_GAP
  const pillY = CHROME_PAD_Y + (CHROME_ROW - PILL_HEIGHT) / 2
  const pillWidth = Math.max(0, cardWidth - pillX - CHROME_PAD_X)
  // Inner box of the pill, where the url text is clipped/aligned.
  const pillInnerWidth = Math.max(0, pillWidth - PILL_PAD_X * 2)
  const pillTextX = pillX + PILL_PAD_X
  const pillTextY = pillY + (PILL_HEIGHT - PILL_FONT) / 2

  // Content area origin (just below the chrome bar), relative to the card body.
  const contentX = bodyX
  const contentY = bodyY + CHROME_HEIGHT

  // Placeholder text (when no children and no src): roughly centered.
  const placeholderTextWidth = url.length * PLACEHOLDER_FONT * AVG_CHAR_W
  const placeholderX = Math.round((cardWidth - placeholderTextWidth) / 2)
  const placeholderY = Math.round((height - PLACEHOLDER_FONT) / 2)

  // Image: uniform scale to fill the content width from its top-left (no
  // object-fit). The clip hides vertical overflow. The base raster is assumed
  // ~1280px wide (the ondajs default frame width).
  const imageScale = cardWidth / 1280

  return (
    <Group
      x={centerX}
      y={centerY}
      scaleX={motion.scaleX}
      scaleY={motion.scaleY}
      opacity={motion.opacity}
    >
      {/* Card body — opaque raised surface with a 1px border. */}
      <Rect
        x={bodyX}
        y={bodyY}
        width={cardWidth}
        height={cardHeight}
        cornerRadius={CARD_RADIUS}
        fill={SURFACE}
        stroke={BORDER}
        strokeWidth={1}
      />

      {/* Chrome bar contents, positioned relative to the card body top-left. */}
      <Group x={bodyX} y={bodyY}>
        {dotXs.map((dx, i) => (
          <Ellipse key={i} x={dx} y={dotY} width={DOT_SIZE} height={DOT_SIZE} fill={BORDER_LIT} />
        ))}

        {/* Address pill. */}
        {pillWidth > 0 ? (
          <Rect
            x={pillX}
            y={pillY}
            width={pillWidth}
            height={PILL_HEIGHT}
            cornerRadius={PILL_RADIUS}
            fill={SURFACE_2}
            stroke={BORDER}
            strokeWidth={1}
          />
        ) : null}

        {/* The 1px divider beneath the chrome bar. */}
        <Rect x={0} y={CHROME_HEIGHT - 1} width={cardWidth} height={1} fill={BORDER} />

        {/* URL text, masked to the pill's inner box (clip is local to its
            parent's origin, so this Group sits at the pill's inner top-left). */}
        {pillInnerWidth > 0 ? (
          <Group x={pillTextX} y={pillTextY} clip={clipRect(pillInnerWidth, PILL_FONT)}>
            <Text fontSize={PILL_FONT} color={DIM}>
              {url}
            </Text>
          </Group>
        ) : null}
      </Group>

      {/* Content area: dark canvas + clipped children / image / placeholder. */}
      <Group x={contentX} y={contentY}>
        {/* Background fill behind the content. */}
        <Rect x={0} y={0} width={cardWidth} height={height} fill={BG} />

        {/* Everything inside the content area is masked to it. */}
        <Group clip={clipRect(cardWidth, height)}>
          {children ??
            (src ? (
              <Image src={src} x={0} y={0} scaleX={imageScale} scaleY={imageScale} />
            ) : (
              <Text x={placeholderX} y={placeholderY} fontSize={PLACEHOLDER_FONT} color={FAINT}>
                {url}
              </Text>
            ))}
        </Group>
      </Group>
    </Group>
  )
}
