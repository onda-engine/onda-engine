//! Canvas2D **preview** renderer (the stopgap path).
//!
//! Draws an ONDA scene graph to a `CanvasRenderingContext2D` for a fast,
//! dependency-free in-browser preview. It interprets the *same* scene graph the
//! engine renders, and now covers shapes (rect/ellipse/path), gradients, clips,
//! transforms, and opacity — but it is **not** the engine and is **not
//! pixel-accurate**:
//!
//!   - Text uses the browser's font rasterizer (and a heuristic baseline), not
//!     the engine's cosmic-text + bundled Open Sans, so glyph shapes/metrics
//!     differ.
//!   - Anti-aliasing, gradient color-space, and path/stroke geometry follow the
//!     browser's Canvas2D, not Vello.
//!
//! The pixel-exact output is `onda render` / `onda export`, and in the browser
//! the {@link @onda-engine/wasm} `OndaEngine` (the real Rust renderer compiled to wasm).
//! Prefer that drawer in `<Player>` when it is available; this Canvas2D renderer
//! is the graceful fallback. A WebGPU *present* path (see `WEBGPU.md`) is the
//! planned way to make in-browser preview == export at real-time speed.

import type { Color, Gradient, Scene, SceneNode, ShapeGeometry } from '@onda-engine/react'

/** Paints a scene onto a 2D context. The default is {@link drawScene}; the
 *  playground and `<Player>` swap in a WASM-engine drawer (real renderer →
 *  `putImageData`) when `@onda-engine/wasm` is present. */
export type FrameDrawer = (ctx: CanvasRenderingContext2D, scene: Scene) => void

/** Draw `scene` onto `ctx`, clearing first. The context should be sized to the
 *  composition's resolution. */
export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { width, height } = scene.composition
  ctx.clearRect(0, 0, width, height)
  ctx.save()
  ctx.globalAlpha = 1
  drawNode(ctx, scene.root)
  ctx.restore()
}

function drawNode(ctx: CanvasRenderingContext2D, node: SceneNode): void {
  ctx.save()

  const transform = node.transform
  if (transform?.translate) ctx.translate(transform.translate.x, transform.translate.y)
  if (transform?.scale) ctx.scale(transform.scale.x, transform.scale.y)
  if (typeof node.opacity === 'number') ctx.globalAlpha *= node.opacity

  // Clip this node's subtree to its (local-space) geometry, if any.
  if (node.clip) {
    geometryPath(ctx, node.clip)
    ctx.clip()
  }

  const kind = node.kind
  switch (kind.type) {
    case 'group':
      break
    case 'shape':
      drawShape(ctx, kind)
      break
    case 'text':
      drawText(ctx, kind)
      break
    // Images and inline SVG are not previewed in Canvas2D (the WASM engine
    // renders them faithfully); they're skipped rather than drawn wrong.
    case 'image':
    case 'svg':
      break
  }

  for (const child of node.children ?? []) drawNode(ctx, child)

  ctx.restore()
}

/** Trace a {@link ShapeGeometry} as the current path (no fill/stroke). Used by
 *  both shape drawing and clipping so the two stay consistent. */
function geometryPath(ctx: CanvasRenderingContext2D, geometry: ShapeGeometry): void {
  ctx.beginPath()
  switch (geometry.shape) {
    case 'rect': {
      const { width, height } = geometry.size
      if (geometry.corner_radius) ctx.roundRect(0, 0, width, height, geometry.corner_radius)
      else ctx.rect(0, 0, width, height)
      break
    }
    case 'ellipse': {
      const rx = geometry.size.width / 2
      const ry = geometry.size.height / 2
      ctx.ellipse(rx, ry, rx, ry, 0, 0, Math.PI * 2)
      break
    }
    case 'path':
      // SVG path data maps directly onto a Path2D the browser can trace.
      ctx.beginPath()
      tracePath(ctx, geometry.data)
      break
  }
}

/** Trace SVG path data into `ctx`. Uses `Path2D` where available (browsers);
 *  no-ops on platforms without it (e.g. headless test stubs). */
function tracePath(ctx: CanvasRenderingContext2D, data: string): void {
  if (typeof Path2D === 'undefined') return
  // Stash the Path2D so fill/stroke can target it (Canvas2D can fill a Path2D).
  pendingPath = new Path2D(data)
}

let pendingPath: Path2D | null = null

function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: Extract<SceneNode['kind'], { type: 'shape' }>,
): void {
  pendingPath = null
  geometryPath(ctx, shape.geometry)

  // A gradient paint takes precedence over a solid fill (mirrors @onda-engine/react).
  const paint = shape.gradient
    ? gradientStyle(ctx, shape.geometry, shape.gradient)
    : shape.fill
      ? cssColor(shape.fill)
      : null

  if (paint) {
    ctx.fillStyle = paint
    if (pendingPath) ctx.fill(pendingPath)
    else ctx.fill()
  }
  if (shape.stroke) {
    ctx.strokeStyle = cssColor(shape.stroke.color)
    ctx.lineWidth = shape.stroke.width
    if (pendingPath) ctx.stroke(pendingPath)
    else ctx.stroke()
  }
  pendingPath = null
}

/** Build a Canvas2D gradient from the engine's {@link Gradient} (local space).
 *  Note: Canvas2D interpolates in sRGB, so colors won't match Vello exactly. */
function gradientStyle(
  ctx: CanvasRenderingContext2D,
  geometry: ShapeGeometry,
  gradient: Gradient,
): CanvasGradient {
  let g: CanvasGradient
  if (gradient.gradient === 'linear') {
    g = ctx.createLinearGradient(gradient.start.x, gradient.start.y, gradient.end.x, gradient.end.y)
  } else if (gradient.gradient === 'radial') {
    g = ctx.createRadialGradient(
      gradient.center.x,
      gradient.center.y,
      0,
      gradient.center.x,
      gradient.center.y,
      gradient.radius,
    )
  } else {
    // `fbm` is a procedural GPU shader the Canvas2D fallback can't reproduce —
    // approximate it as a linear sweep across the shape bounds using the same
    // stops (this fallback never matches Vello exactly; the goal is "doesn't throw
    // / roughly right", and the real engine paths are pixel-exact).
    const [w, h] = geometryExtent(geometry)
    g = ctx.createLinearGradient(0, 0, w, h)
  }
  for (const stop of gradient.stops) {
    g.addColorStop(Math.min(1, Math.max(0, stop.offset)), cssColor(stop.color))
  }
  return g
}

/** A rough local-space extent for the fbm fallback: the shape's own size for
 *  rect/ellipse, or a default span for paths (no cheap bounds in the fallback). */
function geometryExtent(geometry: ShapeGeometry): [number, number] {
  if (geometry.shape === 'rect' || geometry.shape === 'ellipse') {
    return [geometry.size.width, geometry.size.height]
  }
  return [256, 256]
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: Extract<SceneNode['kind'], { type: 'text' }>,
): void {
  ctx.fillStyle = cssColor(text.color ?? { r: 1, g: 1, b: 1 })
  ctx.textBaseline = 'alphabetic'
  const size = text.font_size ?? 48
  ctx.font = `${size}px sans-serif`
  // The engine places text by its top-left; nudge down by ~the ascent so the
  // preview roughly lines up with the real render (still only approximate).
  ctx.fillText(text.content, 0, size * 0.8)
}

/** Convert the engine's 0..1 straight-alpha sRGB color to a CSS `rgba()`. */
export function cssColor(color: Color): string {
  const to255 = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255)
  return `rgba(${to255(color.r)}, ${to255(color.g)}, ${to255(color.b)}, ${color.a ?? 1})`
}
