//! ImageReveal — an image that enters with one of Onda's signature motion
//! fingerprints (fade / scale / wipe). Ported from ondajs.
//!
//! ondajs wraps Remotion's `<Img>` with CSS `object-fit` and a CSS `filter:
//! blur()` entrance. The engine's `<Image>` has neither: it draws the decoded
//! source at its *natural pixel box* `[0,0]..[srcW,srcH]`, mapped through the
//! node's translate + scale. So this port reproduces the behavior with scene
//! primitives:
//!
//!  - Sizing / `fit`: the engine can't read the source's intrinsic dimensions
//!    back into a pure frame→scene function, so we take them as `srcWidth` /
//!    `srcHeight` props (defaulting to the box size = "stretch to fill"). With
//!    real source dimensions, `fit: 'cover'` scales so the box is fully covered
//!    (cropping the overflow via a clip) and `fit: 'contain'` scales so the
//!    whole image fits inside the box (letterboxing). Without them, both fits
//!    collapse to a plain box-fill — note this when the source aspect differs
//!    from the box.
//!  - Box: defaults to the full composition (the ondajs "hero photo" fill case).
//!    Pass `width`/`height` (and `x`/`y`) to place a sized sub-canvas image.
//!  - `motion`: `'fade'` (opacity), `'scale'` (opacity + subtle 0.95→1, no
//!    overshoot — the ondajs `entryScale` fingerprint), and `'wipe'` — a
//!    left→right clip reveal that REPLACES ondajs's `'blur'` variant (the engine
//!    has no blur filter; a clip-wipe is the closest faithful image entrance).
//!
//! Pivot note: scene scale is about a node's local origin, so the `'scale'`
//! variant nests an inner group at the box CENTER and draws the image offset by
//! −w/2,−h/2, so it grows from the middle rather than the top-left corner.

import { Group, Image, clipRect, useCurrentFrame, useVideoConfig } from '@onda/react'
import { entryFade, entryScale } from '../choreography.js'
import { DURATION } from '../motion.js'

/** Which entrance fingerprint the image uses. `'wipe'` replaces ondajs's
 *  blur-rise variant (the engine has no blur filter). */
export type ImageRevealMotion = 'fade' | 'scale' | 'wipe'

/** How the image fills its box. Both require `srcWidth`/`srcHeight` to differ
 *  from a plain stretch — see the file doc comment. */
export type ImageRevealFit = 'cover' | 'contain'

export interface ImageRevealProps {
  /** Image URL or path (resolved at render time). */
  src: string
  /** Which motion fingerprint the entrance uses (default `'wipe'`). */
  motion?: ImageRevealMotion
  /** How the image fits its box (default `'cover'`). */
  fit?: ImageRevealFit
  /** Frames to fully reveal (default `DURATION.base` = 18). */
  durationInFrames?: number
  /** Frames before the reveal starts. */
  delay?: number
  /** Box top-left X in px (default 0). */
  x?: number
  /** Box top-left Y in px (default 0). */
  y?: number
  /** Box width in px. Defaults to the full composition width (fill mode). */
  width?: number
  /** Box height in px. Defaults to the full composition height (fill mode). */
  height?: number
  /**
   * Intrinsic source pixel width, used for `fit` math. Defaults to the box
   * width (a plain stretch). Supply the real source size for true cover/contain.
   */
  srcWidth?: number
  /** Intrinsic source pixel height (see {@link srcWidth}). */
  srcHeight?: number
  /** Corner radius of the box (clips the image to a rounded rect). */
  cornerRadius?: number
}

export function ImageReveal({
  src,
  motion = 'wipe',
  fit = 'cover',
  durationInFrames = DURATION.base,
  delay = 0,
  x = 0,
  y = 0,
  width,
  height,
  srcWidth,
  srcHeight,
  cornerRadius,
}: ImageRevealProps) {
  const frame = useCurrentFrame()
  const { fps, width: compWidth, height: compHeight } = useVideoConfig()

  // Box: defaults to the full composition (ondajs's hero-fill default).
  const boxW = width ?? compWidth
  const boxH = height ?? compHeight

  // Intrinsic source size for fit math. Without it, fall back to the box size
  // (a plain stretch — see the doc comment).
  const intrinsicW = srcWidth ?? boxW
  const intrinsicH = srcHeight ?? boxH
  const safeSrcW = intrinsicW > 0 ? intrinsicW : boxW
  const safeSrcH = intrinsicH > 0 ? intrinsicH : boxH

  // Per-axis scale to exactly fill the box, then pick the uniform factor:
  // `cover` uses the larger (fills + overflows → cropped by the clip),
  // `contain` uses the smaller (whole image fits, letterboxed).
  const fillScaleX = boxW / safeSrcW
  const fillScaleY = boxH / safeSrcH
  const uniform =
    fit === 'cover' ? Math.max(fillScaleX, fillScaleY) : Math.min(fillScaleX, fillScaleY)

  // Drawn image size after scaling, and the offset that centers it in the box.
  const drawnW = safeSrcW * uniform
  const drawnH = safeSrcH * uniform
  const imgX = (boxW - drawnW) / 2
  const imgY = (boxH - drawnH) / 2

  // Entrance motion (shared SPRING_SMOOTH fingerprints via the choreography
  // vocabulary). `wipe` drives a clip width; `fade`/`scale` drive the group.
  const fade = entryFade({ frame, fps, delay, durationInFrames })
  const scaleMotion = entryScale({ frame, fps, delay, durationInFrames, from: 0.95 })

  // For `wipe`, reveal width grows 0 → boxW on the house spring (reuse the
  // fade progress as a 0→1 ramp). A tiny opacity lead-in avoids a hard pop.
  const wipeWidth = Math.max(0, fade.opacity * boxW)

  // The image element, drawn centered in the box at the fit scale.
  const image = <Image src={src} x={imgX} y={imgY} scaleX={uniform} scaleY={uniform} />

  if (motion === 'fade') {
    return (
      <Group x={x} y={y} opacity={fade.opacity} clip={clipRect(boxW, boxH, cornerRadius)}>
        {image}
      </Group>
    )
  }

  if (motion === 'scale') {
    // Center-pivot scale: outer group at the box top-left clips to the box;
    // inner group sits at the box CENTER, scales there, and the image is drawn
    // offset by −w/2,−h/2 so it grows from the middle (scale pivots on origin).
    return (
      <Group x={x} y={y} clip={clipRect(boxW, boxH, cornerRadius)}>
        <Group
          x={boxW / 2}
          y={boxH / 2}
          scaleX={scaleMotion.scaleX}
          scaleY={scaleMotion.scaleY}
          opacity={scaleMotion.opacity}
        >
          <Image
            src={src}
            x={imgX - boxW / 2}
            y={imgY - boxH / 2}
            scaleX={uniform}
            scaleY={uniform}
          />
        </Group>
      </Group>
    )
  }

  // 'wipe' — left→right clip reveal. An outer rounded clip masks to the box; an
  // inner clip whose width grows wipes the image in. Slight opacity lead-in.
  return (
    <Group x={x} y={y} clip={clipRect(boxW, boxH, cornerRadius)}>
      <Group opacity={fade.opacity} clip={clipRect(wipeWidth, boxH)}>
        {image}
      </Group>
    </Group>
  )
}
