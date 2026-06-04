//! Runtime prop schema for {@link ShimmerSweep} — @onda-native (mirrors ShimmerSweepProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const shimmerSweepSchema = z.object({
  text: z.string().default('Onda').describe("The single line of text to sweep light across."),
  delay: z.number().int().default(0).describe("Frames before the sweep starts."),
  duration: z.number().int().optional().describe("Frames for one sweep pass (default DURATION.slower = 30)."),
  loop: z.boolean().default(false).describe("Loop the sweep instead of a single pass."),
  interval: z.number().int().default(60).describe("Frames between sweeps when looping."),
  color: z.string().optional().describe("Base (dim) text color so the bright band reads as a highlight (default: theme textMuted)."),
  shimmerColor: z.string().optional().describe("The sweeping highlight color (default: theme text)."),
  angle: z.number().default(110).describe("Sweep angle in degrees (approximated by tilting the gradient band)."),
  fontSize: z.number().default(96).describe("Font size in px (default 96)."),
  fontFamily: z.string().optional().describe("Loaded font family (e.g. a --font passed to onda render) (default: theme fontFamily)."),
  fontWeight: z.number().default(600).describe("Font weight (display default 600)."),
  width: z.number().optional().describe("Explicit text-box width in px. Overrides the glyph-count estimate."),
  x: z.number().default(0).describe("Local-space placement of the component's top-left (x)."),
  y: z.number().default(0).describe("Local-space placement of the component's top-left (y)."),
})

export type ShimmerSweepSchemaProps = z.infer<typeof shimmerSweepSchema>
