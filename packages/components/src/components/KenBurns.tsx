//! KenBurns — a slow cinematic zoom + pan over a photo (the iconic documentary
//! motion). Ported from ondajs.
//!
//! Intentionally **linear** (no spring, no easing) for a constant slow-cinematic
//! drift. Springs/eases at this multi-second scale read as "the camera is
//! accelerating" — wrong for Ken Burns, which is steady throughout. So this is
//! one of the few components that interpolates frame→progress directly rather
//! than reaching for the choreography vocabulary.
//!
//! Engine model vs ondajs CSS. ondajs renders an `<Img>` with
//! `width/height: 100%`, `objectFit: cover`, then `transform: scale(s)` about a
//! `transformOrigin` of `originX% originY%`. The engine's `<Image>` has none of
//! that: it draws the decoded pixels at their *natural* box `[0,0]..[iw,ih]`
//! mapped through the node transform (translate + scale; the CPU reference does
//! not rotate images). A pure frame→scene function also can't read the image's
//! intrinsic pixel size back from the renderer, so:
//!   1. The natural size is supplied via `imageWidth`/`imageHeight` props
//!      (default 1920×1080) — only the *ratio* matters for the cover fit.
//!   2. We compute a "cover" base scale = max(compW/iw, compH/ih) so the photo
//!      fills the whole composition (matching CSS `objectFit: cover`), center it,
//!      then layer the Ken Burns zoom (1.0 → 1.1) on top.
//!   3. The pan is expressed exactly as origin-based scale: scaling by `s` about
//!      the fractional origin `(originX, originY)` of the displayed box keeps that
//!      point fixed. Since engine scale pivots on the node's LOCAL origin (0,0),
//!      we fold the origin offset into the translate each frame:
//!        x = offsetX + baseScale·iw·originX·(1 − s)
//!      (and likewise for y). Animating originX/originY over time is the pan.
//!      NOTE: this treats originX/originY as a fraction of the *image* (the
//!      cover box), not of the composition viewport — identical to CSS when the
//!      image and composition share an aspect ratio (the 1920×1080 default), and
//!      a small, sensible reinterpretation only on the cross axis when they
//!      differ (panning relative to the picture is the intuitive Ken Burns).
//!
//! Layout note: the `<Image>` is positioned absolutely (explicit x/y + scaleX/Y)
//! inside a clip `<Group>`, NOT as a `<Flex>`/`<AbsoluteFill>` child — a child
//! whose effective size changes every frame would otherwise make a flex parent
//! reflow. The outer `<Group clip>` masks the zoomed image to the composition,
//! replacing ondajs's `overflow: hidden` (without it, scale > 1 paints outside).
//!
//! Approximation: ondajs supports a `placement` box (`PlacementBox`) to sit the
//! effect in a sub-region of the canvas; the engine has no equivalent layout
//! primitive here, so this port always fills the full composition (the ondajs
//! default, `placement` omitted).

import { Group, Image, clipRect, interpolate, useCurrentFrame, useVideoConfig } from '@onda/react'

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export interface KenBurnsProps {
  /** Image source (resolved at render time by `onda render`). */
  src: string
  /** Natural pixel width of the source image. Only its ratio to `imageHeight`
   *  matters — it sets the cover fit. Default 1920. */
  imageWidth?: number
  /** Natural pixel height of the source image. Default 1080. */
  imageHeight?: number
  /** Frames before the drift starts. */
  delay?: number
  /** Frames over which the zoom + pan completes. 150f ≈ 5s @ 30fps. */
  duration?: number
  /** Starting scale (atop the cover fit). Default 1.0. */
  fromScale?: number
  /** Ending scale — keep the delta restrained (1.0 → 1.1). Default 1.1. */
  toScale?: number
  /** Starting pan origin X. `0` = left, `1` = right. Default 0.5 (center). */
  fromX?: number
  /** Starting pan origin Y. `0` = top, `1` = bottom. Default 0.5 (center). */
  fromY?: number
  /** Ending pan origin X. Default 0.5. */
  toX?: number
  /** Ending pan origin Y. Default 0.5. */
  toY?: number
}

export function KenBurns({
  src,
  imageWidth = 1920,
  imageHeight = 1080,
  delay = 0,
  duration = 150,
  fromScale = 1.0,
  toScale = 1.1,
  fromX = 0.5,
  fromY = 0.5,
  toX = 0.5,
  toY = 0.5,
}: KenBurnsProps) {
  const frame = useCurrentFrame()
  const { width: compWidth, height: compHeight } = useVideoConfig()

  // Guard the supplied natural size — fall back to a 16:9 box if a non-positive
  // value slips through (avoids divide-by-zero in the cover fit).
  const iw = imageWidth > 0 ? imageWidth : 1920
  const ih = imageHeight > 0 ? imageHeight : 1080

  // Linear progress 0 → 1 across [delay, delay + duration]. No spring, no easing
  // (see header) — the steady drift is the whole point. Guard duration ≥ 1.
  const span = duration > 0 ? duration : 1
  const progress = interpolate(frame - delay, [0, span], [0, 1], CLAMP)

  // Ken Burns zoom and the panning origin, all linear.
  const zoom = interpolate(progress, [0, 1], [fromScale, toScale], CLAMP)
  const originX = interpolate(progress, [0, 1], [fromX, toX], CLAMP)
  const originY = interpolate(progress, [0, 1], [fromY, toY], CLAMP)

  // Cover fit: scale the natural box so it fills the composition (CSS
  // `objectFit: cover`), then center the covered box. Total scale folds in the
  // Ken Burns zoom on top.
  const baseScale = Math.max(compWidth / iw, compHeight / ih)
  const totalScale = baseScale * zoom

  // Covered (unzoomed) box size, used to center it within the composition.
  const coverWidth = iw * baseScale
  const coverHeight = ih * baseScale
  const centerOffsetX = (compWidth - coverWidth) / 2
  const centerOffsetY = (compHeight - coverHeight) / 2

  // Origin-based scale → translate. Engine scale pivots on the node's local
  // origin (0,0), so to keep the fractional origin point of the displayed box
  // fixed while scaling by `zoom`, shift the translate by
  // baseScale·iw·originX·(1 − zoom) (the displacement of that pixel under the
  // extra zoom). At zoom = 1 this is 0 — the image just covers + centers.
  const x = centerOffsetX + baseScale * iw * originX * (1 - zoom)
  const y = centerOffsetY + baseScale * ih * originY * (1 - zoom)

  return (
    <Group clip={clipRect(compWidth, compHeight)}>
      <Image src={src} x={x} y={y} scaleX={totalScale} scaleY={totalScale} />
    </Group>
  )
}
