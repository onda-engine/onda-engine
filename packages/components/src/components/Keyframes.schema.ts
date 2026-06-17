//! Runtime prop schema for {@link Keyframes} — @onda-native (mirrors KeyframesProps).
//! The Studio agent generates against this; the preview/export renderer validates with it.

import { z } from 'zod'

// Easing: a named curve OR a raw cubic-bezier [x1,y1,x2,y2] (so an AE/Lottie handle transcribes 1:1).
const easeSchema = z
  .union([
    z.enum(['linear', 'ease', 'easeIn', 'easeOut', 'easeInOut']),
    z.tuple([z.number(), z.number(), z.number(), z.number()]),
  ])
  .optional()
  .describe('Easing of the segment ENDING at this key — named, or a cubic-bezier [x1,y1,x2,y2].')

const posKey = z.object({
  at: z.number().describe('Frame.'),
  x: z.number(),
  y: z.number(),
  ease: easeSchema,
})
const valKey = z.object({
  at: z.number().describe('Frame.'),
  v: z.number(),
  ease: easeSchema,
})

// A tile can be filled three ways, in priority order: an `src` image, a
// `gradient`, or a solid `color` (falling back to the theme surface). This lets a
// template ship as editable color/gradient cards the user can swap for images.
const gradientStop = z.object({ offset: z.number(), color: z.string() })
const point = z.union([z.tuple([z.number(), z.number()]), z.object({ x: z.number(), y: z.number() })])
const gradientSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('linear'), start: point, end: point, stops: z.array(gradientStop) }),
    z.object({ type: z.literal('radial'), center: point, radius: z.number(), stops: z.array(gradientStop) }),
    z.object({
      type: z.literal('fbm'),
      stops: z.array(gradientStop),
      scale: z.number().optional(),
      time: z.number().optional(),
      warp: z.number().optional(),
    }),
  ])
  .describe('Gradient fill (linear/radial/fbm) used when `src` is absent — wins over `color`.')

const imageContent = z.object({
  kind: z.literal('image'),
  src: z
    .string()
    .optional()
    .describe('Tile image source (editable — swap for your own). Omit for a `gradient`/`color` fill.'),
  gradient: gradientSchema.optional(),
  color: z
    .string()
    .optional()
    .describe('Solid fill (hex) used when neither `src` nor `gradient` is set; falls back to theme surface.'),
  width: z.number(),
  height: z.number(),
  cornerRadius: z.number().optional(),
  stroke: z.string().optional().describe('Outline color (hex) — for a stroked/outline rect.'),
  strokeWidth: z.number().optional(),
  anchorX: z.number().optional().describe('Pivot in content space (default tile center).'),
  anchorY: z.number().optional(),
})
// Shape leaves — same per-channel tracks, drawn as vector primitives. (`rect` is the
// `image` content with a `color`/`gradient` + no `src`; `line` is a thin rect.)
const ellipseContent = z.object({
  kind: z.literal('ellipse'),
  width: z.number(),
  height: z.number(),
  color: z.string().optional().describe('Fill (hex). Omit + use `stroke` for a ring.'),
  gradient: gradientSchema.optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  anchorX: z.number().optional().describe('Pivot (default ellipse center).'),
  anchorY: z.number().optional(),
})
const pathContent = z.object({
  kind: z.literal('path'),
  d: z.string().describe('SVG path data in local space (e.g. "M0 0 L100 0 Z"). Native/GPU render.'),
  color: z.string().optional().describe('Fill (hex).'),
  gradient: gradientSchema.optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  anchorX: z.number().optional().describe('Pivot (default 0,0).'),
  anchorY: z.number().optional(),
})
const textContent = z.object({
  kind: z.literal('text'),
  text: z.string().describe('Line text (editable).'),
  fontSize: z.number(),
  color: z.string().optional().describe('Ink (hex); defaults to theme `text`.'),
  fontFamily: z.string().optional(),
  fontWeight: z.number().optional(),
  letterSpacing: z.number().optional(),
  anchorX: z.number().optional().describe('Pivot in content space (default top-left 0,0).'),
  anchorY: z.number().optional(),
})

export const keyframesSchema = z.object({
  position: z.array(posKey).optional().describe('Position track (x,y over frames).'),
  opacity: z.array(valKey).optional().describe('Opacity track (0–1 over frames).'),
  scale: z.array(valKey).optional().describe('Uniform-scale track (over frames).'),
  scaleX: z.array(valKey).optional().describe('Horizontal-scale track — wins over `scale` (e.g. a bar growing wide).'),
  scaleY: z.array(valKey).optional().describe('Vertical-scale track — wins over `scale`.'),
  rotation: z.array(valKey).optional().describe('Rotation track in degrees (over frames).'),
  content: z
    .discriminatedUnion('kind', [imageContent, textContent, ellipseContent, pathContent])
    .describe('The element to animate — an image/rect tile, a text line, an ellipse, or a path.'),
})

export type KeyframesSchemaProps = z.infer<typeof keyframesSchema>
