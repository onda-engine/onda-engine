//! Runtime prop schema for {@link SlideOut} — @onda-native (mirrors SlideOutProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const slideOutSchema = z.object({
  delay: timeSchema.default(0).describe("Frames before the exit animation starts."),
  durationInFrames: timeSchema.optional().describe("Frames to fully leave; exits are quicker than entrances."),
  direction: z.enum(['up', 'down', 'left', 'right']).default('down').describe("Direction the element leaves toward ('down' drops it)."),
  distance: z.number().default(12).describe("Travel distance in px for the slide."),
})

export type SlideOutSchemaProps = z.infer<typeof slideOutSchema>
