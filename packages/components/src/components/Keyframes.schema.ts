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

const imageContent = z.object({
  kind: z.literal('image'),
  src: z.string().describe('Tile image source (editable — swap for your own).'),
  width: z.number(),
  height: z.number(),
  cornerRadius: z.number().optional(),
  anchorX: z.number().optional().describe('Pivot in content space (default tile center).'),
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
  rotation: z.array(valKey).optional().describe('Rotation track in degrees (over frames).'),
  content: z
    .discriminatedUnion('kind', [imageContent, textContent])
    .describe('The element to animate — an image tile or a text line.'),
})

export type KeyframesSchemaProps = z.infer<typeof keyframesSchema>
