//! Parallax — slow, linear drift of one or more image layers at different rates.
//! Ported from ondajs.
//!
//! Backgrounds / b-roll that should feel alive without pulling focus. A lighter,
//! no-zoom complement to KenBurns. Intentionally **linear** (no spring/ease): at
//! a multi-second scale, acceleration would read as the camera moving — wrong for
//! parallax, which is steady throughout.
//!
//! Multi-layer parallax: each layer drifts the shared `distance` scaled by its own
//! `speed` multiplier, so backgrounds (low speed) trail foregrounds (high speed)
//! and the scene gains depth. A single `src` is the degenerate one-layer case and
//! matches the ondajs original.
//!
//! Approximations vs ondajs:
//!  - The engine's `<Image>` has no `width`/`height`/`object-fit`; it renders at
//!    the source's natural size. ondajs stretched the image to `100% cover`. Here
//!    each layer rides a `scale` (default 1.05, matching ondajs's oversize) applied
//!    about the LOCAL ORIGIN (0,0) — supply a source already roughly canvas-sized.
//!    Because scale pivots on (0,0), the layer is placed at (0,0) and the modest
//!    1.05 oversize hides the drifting edges, as in the original.
//!  - ondajs's `overflow: hidden` becomes an outer `<Group clip={clipRect(...)}>`
//!    masking everything to the composition bounds, so the oversized/translated
//!    layers never bleed past the canvas.
//!  - ondajs's `placement` (canvas-fraction sub-region) is not modeled; this port
//!    always fills the composition, which is the original's default behavior.

import { Group, Image, clipRect, interpolate, useCurrentFrame, useVideoConfig } from '@onda/react'

/** One drifting image layer. */
export interface ParallaxLayer {
  /** Image URL/path (resolved at render time). */
  src: string
  /** Drift-rate multiplier vs the base `distance` (1 = full distance over the
   *  duration). Lower = slower/further-back layer; higher = faster/closer. */
  speed?: number
  /** Per-layer oversize so the drift never exposes a canvas edge (default 1.05). */
  scale?: number
  /** Per-layer opacity, 0..1 (default 1). */
  opacity?: number
}

export interface ParallaxProps {
  /** Single image layer. Use `src` OR `layers`; `layers` wins when both are set. */
  src?: string
  /** Multiple layers, drawn back-to-front, each drifting at its own `speed`. */
  layers?: ParallaxLayer[]
  /** Frames before the drift starts. */
  delay?: number
  /** Frames over which the drift completes (180f ≈ 6s @ 30fps — parallax wants time). */
  duration?: number
  /** The edge the layers drift *toward* as time advances. */
  direction?: 'left' | 'right' | 'up' | 'down'
  /** Base drift in pixels across `duration` (per-layer scaled by `speed`). Keep
   *  restrained — past ~120px it reads as a pan, not parallax. */
  distance?: number
  /** Default oversize applied to layers that don't set their own `scale` (1.05). */
  scale?: number
}

export function Parallax({
  src,
  layers,
  delay = 0,
  duration = 180,
  direction = 'left',
  distance = 40,
  scale = 1.05,
}: ParallaxProps) {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

  // Resolve the layer list. `layers` takes precedence; otherwise fall back to the
  // single `src` (the ondajs one-layer case). An empty/absent config renders
  // nothing rather than throwing.
  const resolved: ParallaxLayer[] =
    layers && layers.length > 0 ? layers : src != null ? [{ src }] : []

  // Linear by design — constant drift, no acceleration. Clamp on both sides so
  // the component is correct on frame 0 and rests at the final offset afterward.
  const progress = interpolate(frame - delay, [0, duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  // Axis + sign per direction. Left/up are negative translations; right/down
  // positive. Vertical/horizontal selected once for all layers.
  const isHorizontal = direction === 'left' || direction === 'right'
  const sign = direction === 'left' || direction === 'up' ? -1 : 1

  return (
    <Group clip={clipRect(width, height)}>
      {resolved.map((layer, i) => {
        const layerSpeed = layer.speed ?? 1
        const layerScale = layer.scale ?? scale
        const layerOpacity = layer.opacity ?? 1
        const offset = sign * progress * distance * layerSpeed
        const tx = isHorizontal ? offset : 0
        const ty = isHorizontal ? 0 : offset

        // Each layer is its own translated/scaled Group. The Image sits at the
        // group origin; scale pivots on (0,0), and the modest oversize hides the
        // edges the linear drift would otherwise reveal.
        return (
          <Group
            key={i}
            x={tx}
            y={ty}
            scaleX={layerScale}
            scaleY={layerScale}
            opacity={layerOpacity}
          >
            <Image src={layer.src} />
          </Group>
        )
      })}
    </Group>
  )
}
