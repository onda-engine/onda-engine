//! MaskReveal — a hard-edge mask reveal: content uncovered by a clip region that
//! retreats from `direction` on the house spring. Pixel-sharp edge by design — no
//! opacity fade. The moving edge IS the fingerprint. Ported from ondajs.
//!
//! In ondajs the text is fully painted from frame 0 and a CSS `clip-path` inset
//! shrinks from 100% → 0% along the chosen side. `@onda/react` expresses the same
//! shape with a `<Group clip={clipRect(w, h)}>` whose clip RECTANGLE grows from 0
//! → full. `clipRect` is anchored at the node's LOCAL ORIGIN (0,0) and takes no
//! offset, so:
//!   - `left`/`top`  (reveal grows away from the origin) clip directly;
//!   - `right`/`bottom` (reveal grows toward the origin) need the shift-clip-
//!     shift-back trick (outer Group offsets, inner Group clips at the origin and
//!     offsets back) — the same approach `@onda/react`'s `wipe` transition uses.
//!
//! `direction` names the side the content appears to come IN from (mirrors
//! `SlideIn`): the mask sits on the OPPOSITE side and retreats toward `direction`,
//! so the reveal edge sweeps in from that side.
//!
//! Sizing caveat: the clip box must cover the content. With a `text` prop the box
//! width comes from the engine's MEASURED glyph run (`useTextMetrics`, with a
//! glyph-count fallback until the wasm engine warms) and its height from
//! `LINE_RATIO`, padded so the sweep clears glyph edges and descenders. To reveal
//! arbitrary `children`, pass explicit `width`/`height` for the clip box. The assembly is
//! origin-relative (like `SlideIn`/`Underline`): position it via a parent `x`/`y`
//! or an `<AbsoluteFill>` rather than as a measured `<Flex>` child.

import { Group, Text, clipRect, useVideoConfig } from '@onda/react'
import type { ReactNode } from 'react'
import { fitFontSize, fitMaxWidth } from '../bounds.js'
import { useSpringValue } from '../hooks.js'
import { DURATION } from '../motion.js'
import { type Placement, usePlacement } from '../placement.js'
import { useTextMetrics } from '../text-metrics.js'
import { useTheme } from '../theme.js'

/** Engine line-box height as a multiple of font size (matches the typography
 *  crate / the ratio `Underline` and `Highlight` use). */
const LINE_RATIO = 1.2
/** Extra px around the estimated text box so the hard reveal edge sweeps cleanly
 *  past the glyphs and descenders are never trimmed. */
const BOX_PAD = 8
/** Extra px added to each end of the reveal axis (on top of `BOX_PAD`) so the
 *  last glyph clears the right/leading edge of the clip even at rest (p = 1) and
 *  is never trimmed by the estimate. */
const AXIS_PAD = 12

export interface MaskRevealProps {
  /** What to reveal (single line). Ignored when `children` is supplied. */
  text?: string
  /** Frames before the reveal starts. */
  delay?: number
  /** Frames for the mask to fully retreat. */
  duration?: number
  /** The side the content appears to come IN from (mirrors `SlideIn`). The mask
   *  retreats toward this side. */
  direction?: 'left' | 'right' | 'top' | 'bottom'
  /** Text color (hex `#rrggbb` / `#rrggbbaa`) (default: theme `text`). */
  color?: string
  /** Text size in px (default 96). */
  fontSize?: number
  /** Opt-in auto-fit: `'frame'` scales the font size DOWN (never up) so the
   *  padded clip box cannot exceed the frame minus the safe margins. Default
   *  `'none'` (the historical behavior). Text mode only. */
  fit?: 'none' | 'frame'
  /** Explicit width cap in px for the padded clip box; combines with `fit`
   *  (the smaller cap wins). Text mode only. */
  maxWidth?: number
  /** Loaded font family (e.g. a `--font` passed to `onda render`) (default: theme `headingFamily ?? fontFamily`). */
  fontFamily?: string
  /** Font weight (display default 600). */
  fontWeight?: number
  /** Italic text. */
  italic?: boolean
  /** Clip-box width in px. Required for `children`; otherwise estimated from `text`. */
  width?: number
  /** Clip-box height in px. Required for `children`; otherwise `fontSize × 1.2`. */
  height?: number
  /** Where the clip box sits: a region keyword (`'center'`, `'lower-third'`, …)
   *  or normalized `{x,y}` (0–1, box center). The shared placement contract;
   *  default `'center'` (the historical behavior). */
  placement?: Placement
  /** Arbitrary subtree to reveal instead of `text`. Supply `width`/`height`. */
  children?: ReactNode
}

export function MaskReveal({
  text = 'Onda',
  delay = 0,
  duration = DURATION.base,
  direction = 'left',
  color: colorProp,
  fontSize: fontSizeProp = 96,
  fit,
  maxWidth,
  fontFamily: fontFamilyProp,
  fontWeight = 600,
  italic = false,
  width,
  height,
  placement,
  children,
}: MaskRevealProps) {
  // House spring (SPRING_SMOOTH, no overshoot), matching ondajs. `useSpringValue`
  // clamps the pre-delay frames to 0 internally, so it reads 0 before `delay`.
  const progress = useSpringValue({ delay, durationInFrames: duration })
  const theme = useTheme()
  const color = colorProp ?? theme.text
  const fontFamily = fontFamilyProp ?? theme.headingFamily ?? theme.fontFamily

  // Opt-in auto-fit (text mode): the cap applies to the PADDED clip box, so
  // the text must fit cap minus the sweep padding.
  const { width: frameW } = useVideoConfig()
  const cap = fitMaxWidth({ fit, maxWidth }, frameW)
  const textPad = width != null ? 0 : (BOX_PAD + AXIS_PAD) * 2
  const fontSize =
    cap !== undefined && children == null
      ? fitFontSize(text, fontSizeProp, Math.max(1, cap - textPad), { fontFamily, fontWeight })
      : fontSizeProp

  // Real shaped text width — the engine measures the glyphs (proportional, exact);
  // falls back to a glyph-count estimate until the wasm engine warms in the browser.
  const measured = useTextMetrics(text, fontSize, { fontFamily, fontWeight })
  // Revealed fraction 0 → 1 (ondajs animates `cover` 100 → 0; this is `1 - cover`).
  const p = Math.min(1, Math.max(0, progress))

  // Clip box. With explicit children the caller owns the box; for `text` it's
  // sized from the measured glyph run, padded so the sweep clears the glyphs.
  const boxW = width ?? Math.max(1, measured.width + (BOX_PAD + AXIS_PAD) * 2)
  const boxH = height ?? Math.round(fontSize * LINE_RATIO + BOX_PAD * 2)

  // The content rendered beneath the mask — fully painted from frame 0.
  const content: ReactNode = children ?? (
    <Text
      x={width != null ? 0 : BOX_PAD + AXIS_PAD}
      y={height != null ? 0 : BOX_PAD}
      fontSize={fontSize}
      color={color}
      fontFamily={fontFamily}
      fontWeight={fontWeight}
      italic={italic}
    >
      {text}
    </Text>
  )

  // Grow the clip along the reveal axis. `clipRect` is origin-anchored, so for a
  // reveal that grows AWAY from the origin (left/top) the clip dimension simply
  // scales with `p`. For one that grows TOWARD the origin (right/bottom) we offset
  // the whole box by the not-yet-revealed amount, clip at the origin, and offset
  // the content back so it stays put — the moving edge then sweeps from that side.
  let inner: ReactNode
  switch (direction) {
    case 'top': {
      // Content comes in from the top → mask covers the bottom, retreats downward.
      const h = boxH * p
      inner = <Group clip={clipRect(boxW, h)}>{content}</Group>
      break
    }
    case 'right': {
      // Content comes in from the right → mask covers the left, retreats leftward.
      const w = boxW * p
      const dx = boxW - w
      inner = (
        <Group x={dx}>
          <Group x={-dx} clip={clipRect(w, boxH)}>
            {content}
          </Group>
        </Group>
      )
      break
    }
    case 'bottom': {
      // Content comes in from the bottom → mask covers the top, retreats upward.
      const h = boxH * p
      const dy = boxH - h
      inner = (
        <Group y={dy}>
          <Group y={-dy} clip={clipRect(boxW, h)}>
            {content}
          </Group>
        </Group>
      )
      break
    }
    default: {
      // 'left' — content comes in from the left → mask covers the right, retreats rightward.
      const w = boxW * p
      inner = <Group clip={clipRect(w, boxH)}>{content}</Group>
    }
  }

  // Anchor the (origin-relative) clip box on the shared placement contract —
  // the assembly is laid out from its top-left, so without this it would sit in
  // the corner (the Underline/BarChart pattern). Default `'center'` is the
  // historical centering; corner regions sit flush on the safe margin. A static
  // origin avoids any per-frame reflow as the clip edge sweeps. Explicit
  // children that overflow the estimated box still anchor to this top-left.
  const resolved = usePlacement(placement, { width: boxW, height: boxH })
  const originX = Math.round(resolved.originX)
  const originY = Math.round(resolved.originY)
  return (
    <Group x={originX} y={originY}>
      {inner}
    </Group>
  )
}
