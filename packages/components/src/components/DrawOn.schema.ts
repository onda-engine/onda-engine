//! Runtime prop schema for {@link DrawOn} — @onda-native (mirrors DrawOnProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const drawOnSchema = z.object({
  d: z.string().default('M 10 50 Q 100 10 190 50').describe("SVG path `d` attribute (in the path's own coordinate space); the default is a gentle wave."),
  color: z.string().optional().describe("Stroke color (hex `#rrggbb` / `#rrggbbaa`); defaults to theme `text`."),
  strokeWidth: z.number().default(3).describe("Stroke width in path coordinate units."),
  delay: timeSchema.default(0).describe("Frames before the draw-on starts."),
  durationInFrames: timeSchema.optional().describe("Frames to fully draw the path in (default `DURATION.slow` = 24)."),
})

export type DrawOnSchemaProps = z.infer<typeof drawOnSchema>
