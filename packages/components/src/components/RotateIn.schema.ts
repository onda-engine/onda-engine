//! Runtime prop schema for {@link RotateIn} — @onda-native (mirrors RotateInProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const rotateInSchema = z.object({
  delay: timeSchema.default(0).describe("Frames to wait before starting."),
  durationInFrames: timeSchema.optional().describe("Frames to settle to 0\u00b0 (default DURATION.base = 18)."),
  fromDegrees: z.number().default(-8).describe("Starting angle in degrees (clockwise). Safe zone: [-12, +12]."),
})

export type RotateInSchemaProps = z.infer<typeof rotateInSchema>
