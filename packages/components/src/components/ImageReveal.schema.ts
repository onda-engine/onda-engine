//! Runtime prop schema for {@link ImageReveal} — @onda-native (mirrors ImageRevealProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const imageRevealSchema = z.object({
  src: z.string().describe('Image URL or path (resolved at render time).'),
  motion: z
    .enum(['blur', 'fade', 'scale', 'wipe', 'none'])
    .default('blur')
    .describe(
      "Which motion fingerprint the entrance uses: 'blur' soft-to-sharp focus pull, 'fade' opacity, 'scale' center-pivot grow, 'wipe' left-to-right reveal, or 'none' to place the image with no entrance (held still — for logos and precise product stills).",
    ),
  blurAmount: z
    .number()
    .default(24)
    .describe(
      "Peak blur for the 'blur' motion \u2014 the starting gaussian sigma (source px) before resolving to sharp; ignored by other motions.",
    ),
  fit: z
    .enum(['cover', 'contain'])
    .default('cover')
    .describe("How the image fits its box: 'cover' crops to fill, 'contain' letterboxes."),
  durationInFrames: timeSchema
    .optional()
    .describe('Frames to fully reveal the image (default DURATION.base = 18).'),
  delay: timeSchema.default(0).describe('Frames before the reveal starts.'),
  x: z.number().default(0).describe('Box top-left X in px (default 0).'),
  y: z.number().default(0).describe('Box top-left Y in px (default 0).'),
  width: z
    .number()
    .optional()
    .describe('Box width in px; defaults to the full composition width (fill mode).'),
  height: z
    .number()
    .optional()
    .describe('Box height in px; defaults to the full composition height (fill mode).'),
  cornerRadius: z
    .number()
    .optional()
    .describe(
      'Corner radius of the box, clipping the image to a rounded rect (defaults to theme radius).',
    ),
})

export type ImageRevealSchemaProps = z.infer<typeof imageRevealSchema>
