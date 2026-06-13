//! Runtime prop schema for {@link StatCard} — @onda-native (mirrors StatCardProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { placementSchema } from '../placement.js'
import { timeSchema } from '../time.js'

export const statCardSchema = z.object({
  value: z
    .string()
    .default('\u2014')
    .describe('The headline metric, e.g. "26.8 fps" or "100\u00d7" (a number is stringified).'),
  label: z
    .string()
    .default('')
    .describe('The label beneath the value, e.g. "faster than Remotion".'),
  valueSize: z.number().default(180).describe('Font size in px for the headline value.'),
  labelSize: z.number().default(34).describe('Font size in px for the label.'),
  valueColor: z.string().optional().describe('Value color (default: theme text).'),
  labelColor: z.string().optional().describe('Label color (default: theme textMuted).'),
  accent: z
    .any()
    .default(true)
    .describe(
      'Show the accent rule beneath the value: true/undefined shows it (theme accent), false hides it, a string shows it in that color.',
    ),
  accentColor: z
    .string()
    .optional()
    .describe('Accent rule color (default: theme accent); wins over a string passed to accent.'),
  fontFamily: z
    .string()
    .optional()
    .describe('Loaded font family for both value and label (default: theme body family).'),
  delay: timeSchema.default(0).describe('Frames to delay before the staggered fade-in begins.'),
  placement: placementSchema
    .optional()
    .describe(
      "Where the element sits: a region keyword ('center', 'lower-third', 'upper-third', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right') or normalized {x,y} (0-1 canvas fractions, element-center anchored). Default 'center'.",
    ),
})

export type StatCardSchemaProps = z.infer<typeof statCardSchema>
