//! ImageReveal — an image that enters with one of Onda's signature motion
//! fingerprints (fade / scale / wipe). Ported from ondajs.
//!
//! ondajs wraps Remotion's `<Img>` with CSS `object-fit` and a CSS `filter:
//! blur()` entrance. The engine's `<Image>` reproduces both with scene
//! primitives — `fit` for `object-fit`, and a REAL gaussian (`Image.blur`,
//! applied in the engine's image pass) for the soft→sharp focus pull:
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
//!  - `motion`: `'blur'` (opacity + a real soft→sharp focus pull, the ondajs
//!    default, now backed by the engine's `Image.blur` gaussian), `'fade'`
//!    (opacity), `'scale'` (opacity + subtle 0.95→1, no overshoot — the ondajs
//!    `entryScale` fingerprint), and `'wipe'` (a left→right clip reveal).
//!
//! Pivot note: scene scale is about a node's local origin, so the `'scale'`
//! variant nests an inner group at the box CENTER and draws the image offset by
//! −w/2,−h/2, so it grows from the middle rather than the top-left corner.

import { Group, Image, clipRect, useCurrentFrame, useVideoConfig } from '@onda-engine/react'
import { entryFade, entryScale } from '../choreography.js'
import { DURATION } from '../motion.js'
import { useTheme } from '../theme.js'
import type { TimeInput } from '../time.js'

/** Which entrance fingerprint the image uses. `'blur'` is the ondajs default —
 *  a real soft→sharp focus pull via the engine's `Image.blur` gaussian. */
export type ImageRevealMotion = 'blur' | 'fade' | 'scale' | 'wipe'

/** How the image fills its box. Both require `srcWidth`/`srcHeight` to differ
 *  from a plain stretch — see the file doc comment. */
export type ImageRevealFit = 'cover' | 'contain'

export interface ImageRevealProps {
  /** Image URL or path (resolved at render time). */
  src: string
  /** Which motion fingerprint the entrance uses (default `'blur'`). */
  motion?: ImageRevealMotion
  /** Peak blur for the `'blur'` motion — the sigma (source px) the image starts
   *  at before resolving to sharp. Ignored by the other motions. Default `24`. */
  blurAmount?: number
  /** How the image fits its box (default `'cover'`). */
  fit?: ImageRevealFit
  /** Frames to fully reveal (default `DURATION.base` = 18). */
  durationInFrames?: TimeInput
  /** Frames before the reveal starts. */
  delay?: TimeInput
  /** Box top-left X in px (default 0). */
  x?: number
  /** Box top-left Y in px (default 0). */
  y?: number
  /** Box width in px. Defaults to the full composition width (fill mode). */
  width?: number
  /** Box height in px. Defaults to the full composition height (fill mode). */
  height?: number
  /** Corner radius of the box (clips the image to a rounded rect) (default: theme `radius`). */
  cornerRadius?: number
}

export function ImageReveal({
  src,
  motion = 'blur',
  blurAmount = 24,
  fit = 'cover',
  durationInFrames = DURATION.base,
  delay = 0,
  x = 0,
  y = 0,
  width,
  height,
  cornerRadius: cornerRadiusProp,
}: ImageRevealProps) {
  const frame = useCurrentFrame()
  const { fps, width: compWidth, height: compHeight } = useVideoConfig()
  const theme = useTheme()
  const cornerRadius = cornerRadiusProp ?? theme.radius

  // Box: defaults to the full composition (ondajs's hero-fill default).
  const boxW = width ?? compWidth
  const boxH = height ?? compHeight

  // Entrance motion (shared SPRING_SMOOTH fingerprints via the choreography
  // vocabulary). `wipe` drives a clip width; `fade`/`scale` drive the group.
  const fade = entryFade({ frame, fps, delay, durationInFrames })
  const scaleMotion = entryScale({ frame, fps, delay, durationInFrames, from: 0.95 })

  // For `wipe`, reveal width grows 0 → boxW on the house spring (reuse the
  // fade progress as a 0→1 ramp). A tiny opacity lead-in avoids a hard pop.
  const wipeWidth = Math.max(0, fade.opacity * boxW)

  // The image, fitted into the box by the renderer (it measures the decoded
  // pixels). The wrapping group's clip crops `cover`; `contain` letterboxes.
  const image = <Image src={src} width={boxW} height={boxH} fit={fit} />

  if (motion === 'blur') {
    // Soft→sharp focus pull: the decoded image carries a gaussian sigma that
    // retreats `blurAmount` → 0 as the spring fades it in — a REAL engine blur
    // (the ondajs `filter: blur()` entrance), identical on GPU/CPU/native.
    const sigma = Math.max(0, (1 - fade.opacity) * blurAmount)
    return (
      <Group x={x} y={y} opacity={fade.opacity} clip={clipRect(boxW, boxH, cornerRadius)}>
        <Image src={src} width={boxW} height={boxH} fit={fit} blur={sigma} />
      </Group>
    )
  }

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
          <Image src={src} x={-boxW / 2} y={-boxH / 2} width={boxW} height={boxH} fit={fit} />
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
