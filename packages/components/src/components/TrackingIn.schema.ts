//! Runtime prop schema for {@link TrackingIn} — @onda-native (mirrors TrackingInProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { textStyleSchemaShape } from '../text-style.js'
import { timeSchema } from '../time.js'

export const trackingInSchema = z.object({
  ...textStyleSchemaShape,
  text: z.string().default('Onda').describe('The text to settle in.'),
  delay: timeSchema.default(0).describe('Frames before the entrance starts.'),
  durationInFrames: timeSchema
    .optional()
    .describe('Frames until the text settles (default DURATION.slow = 24).'),
  fromTracking: z
    .number()
    .default(0.5)
    .describe('Starting letter-spacing in em \u2014 the text begins spread wide and contracts.'),
  tracking: z.number().default(-0.02).describe('Resting letter-spacing in em.'),
  blur: z
    .boolean()
    .default(true)
    .describe(
      'Start the text soft and sharpen as it settles (approximated as a fading ghost layer).',
    ),
  fontSize: z.number().default(96).describe('Font size in px.'),
  align: z
    .enum(['left', 'center', 'right'])
    .default('center')
    .describe('Horizontal alignment of the line about x.'),
  advanceFactor: z
    .number()
    .optional()
    .describe(
      'Deprecated and unused; accepted for compat (real shaped letter-spacing metrics are used now).',
    ),
  x: z.number().optional().describe('Absolute x anchor of the line (default canvas center).'),
  y: z.number().optional().describe("Absolute y of the line's top (default vertical center)."),
})

export type TrackingInSchemaProps = z.infer<typeof trackingInSchema>
