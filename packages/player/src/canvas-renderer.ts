//! Canvas2D **preview** renderer.
//!
//! Draws an ONDA scene graph to a `CanvasRenderingContext2D` for fast,
//! interactive in-browser preview. It interprets the same scene graph the engine
//! renders, but it is *not* the engine: shapes match, yet text uses the browser's
//! font rasterizer rather than the engine's (cosmic-text/Open Sans). The
//! pixel-exact output remains `onda render`/`onda export`; a WASM build of the
//! Rust renderer is the planned path to make preview == export.

import type { Color, Scene, SceneNode } from '@onda/react'

/** Paints a scene onto a 2D context. The default is {@link drawScene}; the
 *  playground swaps in a WASM-engine drawer (real renderer → `putImageData`). */
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
    case 'image':
      break // images are not previewed yet
  }

  for (const child of node.children ?? []) drawNode(ctx, child)

  ctx.restore()
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: Extract<SceneNode['kind'], { type: 'shape' }>,
): void {
  const { geometry } = shape
  ctx.beginPath()
  if (geometry.shape === 'rect') {
    const { width, height } = geometry.size
    if (geometry.corner_radius) ctx.roundRect(0, 0, width, height, geometry.corner_radius)
    else ctx.rect(0, 0, width, height)
  } else {
    const rx = geometry.size.width / 2
    const ry = geometry.size.height / 2
    ctx.ellipse(rx, ry, rx, ry, 0, 0, Math.PI * 2)
  }
  if (shape.fill) {
    ctx.fillStyle = cssColor(shape.fill)
    ctx.fill()
  }
  if (shape.stroke) {
    ctx.strokeStyle = cssColor(shape.stroke.color)
    ctx.lineWidth = shape.stroke.width
    ctx.stroke()
  }
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: Extract<SceneNode['kind'], { type: 'text' }>,
): void {
  ctx.fillStyle = cssColor(text.color ?? { r: 1, g: 1, b: 1 })
  ctx.textBaseline = 'top'
  ctx.font = `${text.font_size ?? 48}px sans-serif`
  ctx.fillText(text.content, 0, 0)
}

/** Convert the engine's 0..1 sRGB color to a CSS `rgba()` string. */
export function cssColor(color: Color): string {
  const to255 = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255)
  return `rgba(${to255(color.r)}, ${to255(color.g)}, ${to255(color.b)}, ${color.a ?? 1})`
}
