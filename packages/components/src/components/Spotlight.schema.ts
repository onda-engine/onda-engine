//! Runtime prop schema for {@link Spotlight} — @onda-native (mirrors SpotlightProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const spotlightSchema = z.object({
  x: z
    .number()
    .default(0.5)
    .describe('Horizontal center of the spotlight as a 0\u20131 fraction of canvas width.'),
  y: z
    .number()
    .default(0.5)
    .describe('Vertical center of the spotlight as a 0\u20131 fraction of canvas height.'),
  radius: z
    .number()
    .default(40)
    .describe("Final radius as a percentage of the canvas's smaller dimension."),
  delay: timeSchema.default(0).describe('Frames before the reveal starts.'),
  durationInFrames: timeSchema
    .optional()
    .describe('Frames until the spotlight reaches its full radius.'),
  color: z
    .string()
    .optional()
    .describe('Light color (defaults to theme `text`). Hex `#rrggbb` / `#rrggbbaa`.'),
  softness: z
    .number()
    .default(60)
    .describe(
      'Gradient softness \u2014 % of the radius given over to the fade-to-transparent tail; 0 is a hard disc, 100 fades from the very center.',
    ),
})

export type SpotlightSchemaProps = z.infer<typeof spotlightSchema>
