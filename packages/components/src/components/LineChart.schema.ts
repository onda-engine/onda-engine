//! Runtime prop schema for {@link LineChart} — @onda-native (mirrors LineChartProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const lineChartSchema = z.object({
  data: z.array(z.number()).default([12, 18, 15, 24, 22, 31, 28, 38]).describe("The series values, left to right."),
  delay: z.number().int().default(0).describe("Frames before the line starts drawing."),
  duration: z.number().int().default(40).describe("Frames for the line to fully draw on."),
  color: z.string().optional().describe("Line + dot color \u2014 the earned accent (defaults to theme accent)."),
  strokeWidth: z.number().default(4).describe("Stroke width in px."),
  width: z.number().default(900).describe("Chart width in px."),
  height: z.number().default(440).describe("Chart height in px."),
  fill: z.boolean().default(true).describe("Fill a soft gradient area under the line."),
  showDots: z.boolean().default(true).describe("Show a dot at each data point as the line reaches it."),
})

export type LineChartSchemaProps = z.infer<typeof lineChartSchema>
