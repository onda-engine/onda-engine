//! Runtime prop schema for {@link CountUp} — @onda-native (mirrors CountUpProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const countUpSchema = z.object({
  from: z.number().default(0).describe("Starting value the counter animates from."),
  to: z.number().default(100).describe("Ending value the counter settles on."),
  delay: z.number().int().default(0).describe("Frames to wait before the count starts."),
  durationInFrames: z.number().int().optional().describe("Frames spent counting from `from` to `to`."),
  decimals: z.number().int().default(0).describe("Number of fraction digits to render."),
  useGrouping: z.boolean().default(true).describe("Insert en-US thousands separators."),
  prefix: z.string().default('').describe("Text prepended to the number, e.g. '$'."),
  suffix: z.string().default('').describe("Text appended to the number, e.g. '%'."),
  color: z.string().optional().describe("Text color; defaults to the theme `text` color."),
  fontSize: z.number().default(120).describe("Font size in px; counters are usually large."),
  fontFamily: z.string().optional().describe("Loaded font family; defaults to the theme `fontFamily`."),
  fontWeight: z.number().default(600).describe("Font weight of the rendered number."),
  snappy: z.boolean().default(false).describe("Use the snappier spring for the count instead of the smooth one."),
  x: z.number().default(0).describe("Pixel translate on the x axis for placement."),
  y: z.number().default(0).describe("Pixel translate on the y axis for placement."),
})

export type CountUpSchemaProps = z.infer<typeof countUpSchema>
