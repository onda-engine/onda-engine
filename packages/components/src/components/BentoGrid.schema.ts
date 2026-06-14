//! Runtime prop schema for {@link BentoGrid} — @onda-native (mirrors BentoGridProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { textStyleSchemaShape } from '../text-style.js'
import { timeSchema } from '../time.js'

export const bentoGridSchema = z.object({
  ...textStyleSchemaShape,
  items: z
    .any()
    .optional()
    .describe(
      'The cells, laid out left-to-right, top-to-bottom; each has title, optional value/caption, colSpan, rowSpan, and accent. Spans drive the rhythm.',
    ),
  columns: z.number().int().default(3).describe('Number of grid columns.'),
  gap: z.number().default(24).describe('Gap between cells in px.'),
  width: z.number().default(960).describe('Overall grid width in px.'),
  rowHeight: z
    .number()
    .optional()
    .describe('Row-track height in px. Defaults to the column-track width (square cells).'),
  padding: z.number().default(34).describe('Inner padding of each cell in px.'),
  delay: timeSchema.default(0).describe('Frames before the first cell enters.'),
  stagger: timeSchema
    .optional()
    .describe('Frames between successive cells rising in. House stagger is 4.'),
  fontSize: z
    .number()
    .default(30)
    .describe('Base title font size in px (value and caption sizes derive from it).'),
  captionColor: z.string().optional().describe('Caption color (defaults to theme textMuted).'),
  accentColor: z
    .string()
    .optional()
    .describe('Accent color for the earned accent cell (defaults to theme accent).'),
  cardColor: z
    .string()
    .optional()
    .describe(
      'Card fill \u2014 translucent dark, approximating glass (defaults to theme surface).',
    ),
  borderColor: z.string().optional().describe('Card border color (defaults to theme border).'),
  captionFontFamily: z
    .string()
    .optional()
    .describe('Body font family for captions (defaults to theme fontFamily).'),
})

export type BentoGridSchemaProps = z.infer<typeof bentoGridSchema>
