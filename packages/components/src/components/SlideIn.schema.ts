//! Runtime prop schema for {@link SlideIn} — @onda-native (mirrors SlideInProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const slideInSchema = z.object({
  delay: timeSchema.default(0).describe('Frames to wait before the animation starts.'),
  durationInFrames: timeSchema.optional().describe('Frames to fully settle into place.'),
  direction: z
    .enum(['up', 'down', 'left', 'right'])
    .default('up')
    .describe("Settling direction; 'up' rises into place from below."),
  distance: z.number().default(12).describe('Travel distance in px (12-24 Onda envelope).'),
})

export type SlideInSchemaProps = z.infer<typeof slideInSchema>
