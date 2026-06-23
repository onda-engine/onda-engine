//! Runtime prop schema for {@link MatteReveal} — @onda-native (mirrors MatteRevealProps).
//! The Studio agent generates against this; the preview/export renderer validates with it.

import { z } from 'zod'
import { timeSchema } from '../time.js'

/** One beat of the matte sequence: a shape the video is revealed through + a title. */
export const matteBeatSchema = z.object({
  shape: z
    .enum(['oval', 'squircle', 'circle', 'diamond', 'star', 'rect'])
    .optional()
    .describe('The matte shape the video is revealed through for this beat.'),
  title: z.string().optional().describe('Bold title shown over the shape (supports \\n lines).'),
})

export const matteRevealSchema = z.object({
  src: z
    .string()
    .optional()
    .describe('Video URL revealed through the morphing shapes (resolved at render time).'),
  beats: z
    .any()
    .optional()
    .describe(
      'The sequence of beats: array of { shape, title }. The matte morphs from each shape to the next, holding on each while the title shows. Falls back to a default oval→squircle→circle→star→diamond run.',
    ),
  titleColor: z.string().optional().describe('Title color (default white).'),
  background: z.string().optional().describe('Backdrop behind the matte (default black).'),
  fontSize: z.number().optional().describe('Title font size in px (default ~150).'),
  uppercase: z.boolean().optional().describe('Uppercase the titles (default true).'),
  shapeScale: z
    .number()
    .default(1)
    .describe('Overall size of the matte shapes (1 = default; >1 reveals more of the video).'),
  letterbox: z
    .number()
    .default(0)
    .describe('Cinematic letterbox bars — fraction of height per bar (e.g. 0.07). 0 = none.'),
  vignette: z.number().default(0).describe('Vignette strength 0..1 darkening the frame edges.'),
  holdFrames: timeSchema.default(40).describe('Frames each shape holds before morphing.'),
  morphFrames: timeSchema.default(26).describe('Frames each shape→next-shape morph takes.'),
  introFrames: timeSchema.default(16).describe('Frames the first shape scales/fades in.'),
})

export type MatteRevealSchemaProps = z.infer<typeof matteRevealSchema>
