//! Runtime prop schema for {@link ProgressSteps} — @onda-native (mirrors ProgressStepsProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const progressStepsSchema = z.object({
  steps: z.array(z.string()).default(['Plan', 'Build', 'Render', 'Ship']).describe("Step labels, left to right."),
  current: z.number().int().default(2).describe("How many steps are complete \u2014 the fill animates to this index (0-based count)."),
  delay: timeSchema.default(0).describe("Frames before the fill animates."),
  duration: timeSchema.optional().describe("Frames for the fill to travel to `current`."),
  accentColor: z.string().optional().describe("Completed / active color \u2014 the earned accent (defaults to theme `accent`)."),
  dimColor: z.string().optional().describe("Pending color for dots and connector track (defaults to theme `border`)."),
  labelColor: z.string().optional().describe("Label color (defaults to theme `textMuted`)."),
  fontFamily: z.string().optional().describe("Loaded font family for labels (defaults to theme `fontFamily`)."),
  fontSize: z.number().default(34).describe("Label font size in px."),
  width: z.number().default(1280).describe("Overall width in px (dots are spaced across this)."),
  dotSize: z.number().default(30).describe("Dot diameter in px."),
  trackThickness: z.number().default(3).describe("Connector track thickness in px."),
})

export type ProgressStepsSchemaProps = z.infer<typeof progressStepsSchema>
