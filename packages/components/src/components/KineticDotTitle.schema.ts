//! Runtime prop schema for {@link KineticDotTitle} — mirrors KineticDotTitleProps.
//! The Studio agent generates against this and the preview/export renderer validates
//! with it. Edit the component + this schema together.

import { z } from 'zod'
import { placementSchema } from '../placement.js'
import { textStyleSchemaShape } from '../text-style.js'
import { timeSchema } from '../time.js'

export const kineticDotTitleSchema = z.object({
  ...textStyleSchemaShape,
  text: z
    .string()
    .default('EVERY IDEA')
    .describe('The title line (editable); the period at the end is the animated circle.'),
  fontSize: z.number().default(110).describe('Font size in px.'),
  dotColor: z
    .string()
    .optional()
    .describe('Color of the period (the circle that becomes the full stop). Default theme accent.'),
  dotScale: z.number().default(0.34).describe('Period diameter as a fraction of fontSize.'),
  circleFrom: z
    .number()
    .default(6)
    .describe('How big the circle starts, in multiples of the period diameter.'),
  shrinkDuration: timeSchema
    .default(24)
    .describe('Frames for the circle to shrink to the period while the line writes in.'),
  gap: z
    .number()
    .default(0.16)
    .describe('Gap between the last glyph and the period, as a fraction of fontSize.'),
  align: z
    .enum(['left', 'center', 'right'])
    .default('center')
    .describe('Horizontal alignment of the text+period unit about its anchor.'),
  placement: placementSchema
    .optional()
    .describe(
      "Where the unit sits: a region keyword ('center', 'lower-third', 'upper-third', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right') or normalized {x,y} (0-1 canvas fractions, element-center anchored). Default 'center'.",
    ),
})

export type KineticDotTitleSchemaProps = z.infer<typeof kineticDotTitleSchema>
