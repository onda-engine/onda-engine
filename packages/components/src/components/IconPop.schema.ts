//! Runtime prop schema for {@link IconPop} — @onda-native (mirrors IconPopProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { textStyleSchemaShape } from '../text-style.js'
import { timeSchema } from '../time.js'

export const iconPopSchema = z.object({
  ...textStyleSchemaShape,
  glyph: z
    .string()
    .optional()
    .describe(
      'A character/emoji to pop in (e.g. "\u2726", "\u2605", "\ud83c\udf89"); takes precedence over `shape` when set, rendered as text so it works on both backends.',
    ),
  shape: z
    .enum(['check', 'cross', 'dot', 'star'])
    .default('check')
    .describe(
      'One of the four built-in shapes, used when `glyph` is not set; drawn as a Path (GPU/Vello only).',
    ),
  iconSize: z
    .number()
    .default(96)
    .describe('Icon size in px (the icon is square-ish, centered on its placement point).'),
  color: z.string().optional().describe('Icon color; defaults to the theme `accent` when omitted.'),
  strokeWidth: z
    .number()
    .default(3)
    .describe(
      'Stroke width for the outline shapes (check, cross); ignored by glyph and by the filled shapes (dot, star).',
    ),
  delay: timeSchema.default(0).describe('Frames before the pop starts.'),
  durationInFrames: timeSchema
    .optional()
    .describe('Frames the pop takes to settle (defaults to DURATION.base = 18).'),
  overshoot: z
    .number()
    .default(0.18)
    .describe(
      'Overshoot amount \u2014 how far past 1.0 the scale peaks before settling, as a fraction (0.18 \u2248 an 18% bump); 0 disables the overshoot.',
    ),
  x: z.number().default(0).describe("Canvas x of the icon's CENTER (the pop grows from here)."),
  y: z.number().default(0).describe("Canvas y of the icon's CENTER."),
})

export type IconPopSchemaProps = z.infer<typeof iconPopSchema>
