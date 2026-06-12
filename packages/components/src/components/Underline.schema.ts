//! Runtime prop schema for {@link Underline} — @onda-native (mirrors UnderlineProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const underlineSchema = z.object({
  text: z.string().default('underline this').describe("Text to reveal. Pass \"\" to draw the rule alone."),
  delay: timeSchema.default(0).describe("Frames before the text starts revealing."),
  duration: timeSchema.optional().describe("Text reveal duration in frames (default DURATION.base = 18)."),
  lineDelay: timeSchema.default(8).describe("Frames to wait after the text lands before the rule starts drawing."),
  lineDuration: timeSchema.optional().describe("Rule draw duration. Fast on purpose \u2014 emphatic (default DURATION.fast)."),
  color: z.string().optional().describe("Text color (default: theme text)."),
  accentColor: z.string().optional().describe("Rule color (default: theme accent)."),
  lineThickness: z.number().default(3).describe("Rule thickness in px."),
  lineOffset: z.number().default(6).describe("Pixel gap between the text box and the rule."),
  fontSize: z.number().default(64).describe("Text size in px (default 64)."),
  fontFamily: z.string().optional().describe("Loaded font family (e.g. a --font passed to onda render); defaults to theme font."),
  fontWeight: z.number().default(600).describe("Font weight (display default 600)."),
  align: z.enum(['left', 'center', 'right']).default('left').describe("Horizontal alignment of the rule under the text."),
})

export type UnderlineSchemaProps = z.infer<typeof underlineSchema>
