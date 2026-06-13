//! Runtime prop schema for {@link ScaleIn} — @onda-native (mirrors ScaleInProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const scaleInSchema = z.object({
  delay: timeSchema.default(0).describe('Frames to wait before the animation starts.'),
  durationInFrames: timeSchema
    .optional()
    .describe('Number of frames over which the entrance settles.'),
  from: z
    .number()
    .default(0.9)
    .describe('Starting scale that animates to 1 (below ~0.85 reads as a dramatic zoom).'),
})

export type ScaleInSchemaProps = z.infer<typeof scaleInSchema>
