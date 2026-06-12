//! Runtime prop schema for {@link ProgressBar} — @onda-native (mirrors ProgressBarProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const progressBarSchema = z.object({
  value: z.number().default(64).describe("Target fill, 0-100. The bar grows from 0 to this value."),
  delay: timeSchema.default(0).describe("Frames before the animation starts."),
  duration: timeSchema.optional().describe("Frames to reach the full target value."),
  width: z.number().default(640).describe("Track width in px \u2014 the full 0%-100% travel."),
  height: z.number().default(12).describe("Bar thickness in px."),
  radius: z.number().default(999).describe("Corner radius in px. Defaults to a full pill."),
  trackColor: z.string().optional().describe("Track color \u2014 the unfilled portion (default: theme surface)."),
  accentColor: z.string().optional().describe("Fill color (default: theme accent)."),
  showValue: z.boolean().default(true).describe("Whether to render the ${value}% label beside the bar."),
  color: z.string().optional().describe("Label color (default: theme text)."),
  fontSize: z.number().default(28).describe("Label font size in px."),
  fontFamily: z.string().optional().describe("Label font family (must be loaded by the renderer; default: theme fontFamily)."),
})

export type ProgressBarSchemaProps = z.infer<typeof progressBarSchema>
