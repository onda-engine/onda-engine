//! Runtime prop schema for {@link ShimmerSweep} — @onda-native (mirrors ShimmerSweepProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { textStyleSchemaShape } from '../text-style.js'
import { timeSchema } from '../time.js'

export const shimmerSweepSchema = z.object({
  ...textStyleSchemaShape,
  text: z.string().default('Onda').describe('The single line of text to sweep light across.'),
  delay: timeSchema.default(0).describe('Frames before the sweep starts.'),
  duration: timeSchema
    .optional()
    .describe('Frames for one sweep pass (default DURATION.slower = 30).'),
  loop: z.boolean().default(false).describe('Loop the sweep instead of a single pass.'),
  interval: timeSchema.default(60).describe('Frames between sweeps when looping.'),
  shimmerColor: z
    .string()
    .optional()
    .describe('The sweeping highlight color (default: theme text).'),
  angle: z
    .number()
    .default(110)
    .describe('Sweep angle in degrees (approximated by tilting the gradient band).'),
  fontSize: z.number().default(96).describe('Font size in px (default 96).'),
  width: z
    .number()
    .optional()
    .describe('Explicit text-box width in px. Overrides the glyph-count estimate.'),
  x: z.number().default(0).describe("Local-space placement of the component's top-left (x)."),
  y: z.number().default(0).describe("Local-space placement of the component's top-left (y)."),
})

export type ShimmerSweepSchemaProps = z.infer<typeof shimmerSweepSchema>
