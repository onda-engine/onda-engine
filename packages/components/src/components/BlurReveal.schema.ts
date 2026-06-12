//! Runtime prop schema for {@link BlurReveal} — @onda-native (mirrors BlurRevealProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { placementSchema } from '../placement.js'

export const blurRevealSchema = z.object({
  text: z.string().default('Onda').describe('What to reveal. Rendered as a single-line Text node.'),
  delay: z.number().int().default(0).describe('Frames before the reveal starts.'),
  durationInFrames: z
    .number()
    .int()
    .optional()
    .describe('Frames until the reveal fully settles (DURATION.base = 18).'),
  color: z
    .string()
    .optional()
    .describe('Text color (hex #rrggbb / #rrggbbaa); defaults to theme text.'),
  fontSize: z.number().default(96).describe('Text size in px.'),
  fontFamily: z.string().optional().describe('Loaded font family; defaults to theme fontFamily.'),
  fontWeight: z.number().default(600).describe('Font weight (display default 600).'),
  placement: placementSchema
    .default('center')
    .describe(
      "Where the reveal sits - the shared placement contract (region keyword or normalized {x,y}). Legacy 'top'/'bottom' keep their historical edge-flush meaning.",
    ),
  travelPx: z.number().default(16).describe('Rise distance in px (small on purpose).'),
  fromBlur: z
    .number()
    .default(10)
    .describe(
      'Starting blur in px (gaussian sigma) for the soft→sharp focus-pull; ramps to 0 as the reveal settles.',
    ),
})

export type BlurRevealSchemaProps = z.infer<typeof blurRevealSchema>
