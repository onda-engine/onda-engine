//! Runtime prop schema for {@link CountUp} — @onda-native (mirrors CountUpProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { placementSchema } from '../placement.js'
import { textStyleSchemaShape } from '../text-style.js'
import { timeSchema } from '../time.js'

export const countUpSchema = z.object({
  ...textStyleSchemaShape,
  from: z.number().default(0).describe('Starting value the counter animates from.'),
  to: z.number().default(100).describe('Ending value the counter settles on.'),
  delay: timeSchema.default(0).describe('Frames to wait before the count starts.'),
  durationInFrames: timeSchema.optional().describe('Frames spent counting from `from` to `to`.'),
  decimals: z.number().int().default(0).describe('Number of fraction digits to render.'),
  useGrouping: z.boolean().default(true).describe('Insert en-US thousands separators.'),
  prefix: z.string().default('').describe("Text prepended to the number, e.g. '$'."),
  suffix: z.string().default('').describe("Text appended to the number, e.g. '%'."),
  fontSize: z.number().default(120).describe('Font size in px; counters are usually large.'),
  snappy: z
    .boolean()
    .default(false)
    .describe('Use the snappier spring for the count instead of the smooth one.'),
  x: z.number().default(0).describe('Pixel translate on the x axis for placement.'),
  y: z.number().default(0).describe('Pixel translate on the y axis for placement.'),
  placement: placementSchema
    .optional()
    .describe(
      "Where the element sits: a region keyword ('center', 'lower-third', 'upper-third', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right') or normalized {x,y} (0-1 canvas fractions, element-center anchored). Default 'center'.",
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
  fitToClip: z
    .boolean()
    .optional()
    .describe(
      'Compress the whole timing envelope (delay, stagger, durations) so the entrance settles at least hold before the end of the enclosing clip. Opt-in.',
    ),
  maxSettle: timeSchema
    .optional()
    .describe("Hard cap on the settle time (frames or '0.5s'). Wins over fitToClip."),
  hold: timeSchema
    .optional()
    .describe('Breathing room before the cut for fitToClip (default 6 frames).'),
})

export type CountUpSchemaProps = z.infer<typeof countUpSchema>
