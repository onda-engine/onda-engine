//! Runtime prop schema for {@link SplitScreen} — @onda-native (mirrors SplitScreenProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const splitScreenSchema = z.object({
  orientation: z
    .enum(['horizontal', 'vertical'])
    .default('horizontal')
    .describe('Pane axis: horizontal = side-by-side, vertical = stacked.'),
  ratio: z
    .number()
    .default(0.5)
    .describe('Fraction (0..1) of the main axis given to the left (or top) pane.'),
  gap: z.number().default(0).describe('Gap between the two panes in px.'),
  divider: z
    .boolean()
    .default(true)
    .describe('Draw a thin token divider in the gap between the panes.'),
  animate: z
    .boolean()
    .default(true)
    .describe('Slide the two panes apart from the center seam on the house spring.'),
  delay: timeSchema.default(0).describe('Frames before the entrance.'),
  width: z
    .number()
    .optional()
    .describe('Overall width in px. Defaults to the full composition width.'),
  height: z
    .number()
    .optional()
    .describe('Overall height in px. Defaults to the full composition height.'),
  paneBackground: z
    .string()
    .optional()
    .describe('Pane background fill (default: lifted surface fill).'),
  background: z
    .string()
    .optional()
    .describe(
      'Outer (gutter) background fill, seen in the gap behind the divider (default: theme background).',
    ),
  dividerColor: z
    .string()
    .optional()
    .describe('Divider color (thin token line) (default: brighter hairline edge color).'),
  placeholderColor: z
    .string()
    .optional()
    .describe('Placeholder label color for an empty pane (default: theme textMuted).'),
  fontFamily: z
    .string()
    .optional()
    .describe('Loaded font family for empty-pane placeholders (default: theme fontFamily).'),
})

export type SplitScreenSchemaProps = z.infer<typeof splitScreenSchema>
