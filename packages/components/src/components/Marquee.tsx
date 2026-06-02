//! Marquee — a seamless looping horizontal scroll (logo strips, ticker tape,
//! "as featured in" rows). Ported from ondajs.
//!
//! Intentionally **linear**: a marquee with spring acceleration feels broken.
//! Content is laid out absolutely (not via `<Flex>`) and translated each frame,
//! then the item set is repeated enough times to blanket the viewport from a
//! one-content-width head start, so the wrap is seamless. An outer `<Group clip>`
//! masks everything to the viewport, hiding the seam and the off-screen tail.
//!
//! Caveat: the engine measures text at render time, but a pure frame→scene
//! function can't read those measurements back. Like ondajs, item widths (and
//! thus `contentWidth`) are *estimated* from `length * fontSize * AVG_CHAR_W`.
//! The estimate only needs to be roughly proportional; the copy count is derived
//! from it so coverage holds even when one set is narrower than the viewport.

import { Group, Text, clipRect, useCurrentFrame, useVideoConfig } from '@onda/react'

/** Approximate average glyph advance as a fraction of font size, for
 *  proportional display fonts. Matches the ondajs estimate. */
const AVG_CHAR_W = 0.6

export interface MarqueeProps {
  /** Items to scroll. The list is repeated as needed for a seamless wrap. */
  items?: string[]
  /** Scroll speed in pixels per second. Keep low for restraint (default 30). */
  speed?: number
  /** Scroll direction (default `'left'`). */
  direction?: 'left' | 'right'
  /** Pixels between items (default 64). */
  gap?: number
  /** Text color (default an atmospheric faint grey). */
  color?: string
  /** Font size in px (default 32). */
  fontSize?: number
  /** Loaded font family (e.g. a `--font` passed to `onda render`). */
  fontFamily?: string
  /** CSS weight 1..1000 (default 500). */
  fontWeight?: number
  /** Viewport width to scroll within. Defaults to the full composition width. */
  width?: number
  /** Viewport height (the clip band). Defaults to the full composition height. */
  height?: number
}

export function Marquee({
  items = ['ONDA', 'TYPESCRIPT', 'REACT'],
  speed = 30,
  direction = 'left',
  gap = 64,
  color = '#56565f',
  fontSize = 32,
  fontFamily,
  fontWeight = 500,
  width,
  height,
}: MarqueeProps) {
  const frame = useCurrentFrame()
  const { fps, width: compWidth, height: compHeight } = useVideoConfig()

  const viewportWidth = width ?? compWidth
  const viewportHeight = height ?? compHeight

  // Estimated x-advance for each item, plus the trailing gap. Deterministic:
  // no DOM measurement, so the result is identical across frames/renderers.
  const itemWidths = items.map((item) => item.length * fontSize * AVG_CHAR_W + gap)
  const contentWidth = itemWidths.reduce((sum, w) => sum + w, 0)

  // Linear translation by design (see header). Pixels travelled so far.
  const speedPxPerFrame = speed / fps
  const rawOffset = frame * speedPxPerFrame

  // Modulo by one content width so the wrap is seamless. JS `%` can return a
  // negative result for negative operands, so normalize into [0, contentWidth).
  const wrapped = contentWidth > 0 ? ((rawOffset % contentWidth) + contentWidth) % contentWidth : 0

  // 'left' moves content leftward (negative x); 'right' flips the direction by
  // starting one content width back so the second copy is on screen.
  const offset = direction === 'left' ? -wrapped : wrapped - contentWidth

  // Vertically center the text band within the clip (fontSize is the line-height
  // proxy, since we can't read the engine's measured box back here).
  const textY = Math.round((viewportHeight - fontSize) / 2)

  // Precompute each item's local x within a single set (running sum of widths).
  let cursor = 0
  const placed = items.map((item, i) => {
    const x = cursor
    cursor += itemWidths[i] ?? 0
    return { item, x }
  })

  // Repeat the set enough times to blanket the viewport. The content is shifted
  // by at most one content width (`wrapped < contentWidth`), so we need one lead
  // copy plus enough copies to span `viewportWidth` — i.e. ceil(vw/cw) + 1.
  // Always at least 2 so the wrap point is never visible. Each copy's local x
  // origin is `copyIndex * contentWidth`.
  const copyCount = contentWidth > 0 ? Math.max(2, Math.ceil(viewportWidth / contentWidth) + 1) : 1
  const copies = Array.from({ length: copyCount }, (_, copyIndex) => copyIndex * contentWidth)

  return (
    <Group clip={clipRect(viewportWidth, viewportHeight)}>
      <Group x={offset}>
        {copies.map((copyOffset, copyIndex) =>
          placed.map(({ item, x }, i) => (
            <Text
              // biome-ignore lint/suspicious/noArrayIndexKey: positional row, stable order
              key={`${copyIndex}-${i}`}
              x={copyOffset + x}
              y={textY}
              fontSize={fontSize}
              color={color}
              fontFamily={fontFamily}
              fontWeight={fontWeight}
            >
              {item}
            </Text>
          )),
        )}
      </Group>
    </Group>
  )
}
