//! Runtime prop schema for {@link BlurReveal} — @onda-native (mirrors BlurRevealProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { placementSchema } from '../placement.js'
import { textStyleSchemaShape } from '../text-style.js'
import { timeSchema } from '../time.js'

export const blurRevealSchema = z.object({
  ...textStyleSchemaShape,
  text: z.string().default('Onda').describe('What to reveal. Rendered as a single-line Text node.'),
  delay: timeSchema.default(0).describe('Frames before the reveal starts.'),
  durationInFrames: timeSchema
    .optional()
    .describe('Frames until the reveal fully settles (DURATION.base = 18).'),
  fontSize: z.number().default(96).describe('Text size in px.'),
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
  fit: z
    .enum(['none', 'frame'])
    .optional()
    .describe(
      "Opt-in auto-fit: 'frame' scales the font size DOWN (never up) so the line cannot exceed the frame minus the safe margins. Default 'none'.",
    ),
  maxWidth: z
    .number()
    .optional()
    .describe('Explicit width cap in px for the line; combines with fit (the smaller cap wins).'),
})

export type BlurRevealSchemaProps = z.infer<typeof blurRevealSchema>
