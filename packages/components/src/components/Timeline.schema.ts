//! Runtime prop schema for {@link Timeline} — @onda-native (mirrors TimelineProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const timelineSchema = z.object({
  events: z
    .any()
    .optional()
    .describe(
      'Anchor points down the timeline (each { label }). Order is preserved \u2014 top to bottom.',
    ),
  delay: timeSchema.default(0).describe('Frames before the line begins to draw.'),
  lineDuration: timeSchema
    .optional()
    .describe('Frames over which the vertical line reveals itself top-to-bottom.'),
  dotDelay: z
    .number()
    .int()
    .default(8)
    .describe('Frames between the line completing and the first dot appearing.'),
  dotStagger: z
    .number()
    .int()
    .optional()
    .describe('Frames between consecutive dot entrances (canonical Onda stagger = 4).'),
  dotDuration: z.number().int().optional().describe('Per-dot entrance duration in frames.'),
  dotSize: z.number().default(18).describe('Dot diameter in px.'),
  spacing: z.number().default(110).describe('Vertical distance between consecutive events, in px.'),
  lineWidth: z.number().default(4).describe('Line thickness in px.'),
  lineColor: z.string().optional().describe('Line color (default: theme border).'),
  dotColor: z.string().optional().describe('Non-final dot color (default: theme text).'),
  accentColor: z
    .string()
    .optional()
    .describe('Final dot color \u2014 the earned accent (default: theme accent).'),
  labelColor: z.string().optional().describe('Label color (default: theme textMuted).'),
  fontSize: z.number().default(28).describe('Label font size in px.'),
  fontFamily: z
    .string()
    .optional()
    .describe('Loaded font family for labels (default: theme headingFamily ?? fontFamily).'),
})

export type TimelineSchemaProps = z.infer<typeof timelineSchema>
