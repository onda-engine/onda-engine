//! Runtime prop schema for {@link FadeOut} — @onda-native (mirrors FadeOutProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const fadeOutSchema = z.object({
  delay: timeSchema.default(0).describe('Frame at which the exit (fade-out) begins.'),
  durationInFrames: timeSchema
    .optional()
    .describe('Frames the fade-out takes (default DURATION.fast = 10 \u2014 exits are quick).'),
})

export type FadeOutSchemaProps = z.infer<typeof fadeOutSchema>
