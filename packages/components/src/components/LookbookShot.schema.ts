//! Runtime prop schema for {@link LookbookShot} — @onda-native (mirrors LookbookShotProps).

import { z } from 'zod'
import { textStyleSchemaShape } from '../text-style.js'

export const lookbookShotSchema = z.object({
  ...textStyleSchemaShape,
  src: z
    .string()
    .default('')
    .describe('Product photo source (resolved at render time by `onda render`).'),
  name: z
    .string()
    .default('Product')
    .describe('Product name — the headline, set in the display face.'),
  eyebrow: z
    .string()
    .default('')
    .describe('Small letterspaced eyebrow above the name (category), in the body face.'),
  detail: z
    .string()
    .default('')
    .describe('Quiet supporting line under the name (material / method), in the body face.'),
  layout: z
    .enum(['spread-right', 'spread-left', 'centered'])
    .default('spread-right')
    .describe(
      'Page composition. Alternate spread-right / spread-left across shots for lookbook rhythm.',
    ),
  delay: z.number().int().default(0).describe('Frames before the card enters.'),
  nameFontSize: z
    .number()
    .optional()
    .describe('Name font size in px (default 86 for spreads, 58 for centered).'),
  matColor: z
    .string()
    .optional()
    .describe('The mat/frame color (the print border). Default a near-white off the bg.'),
  shadowColor: z.string().default('#2b201824').describe('Soft shadow color under the mat.'),
  accentColor: z.string().optional().describe('Eyebrow + rule color (defaults to theme accent).'),
  detailColor: z.string().optional().describe('Detail line color (defaults to theme textMuted).'),
  bodyFamily: z
    .string()
    .optional()
    .describe('Body font for eyebrow + detail (defaults to theme fontFamily).'),
  lifeDurationInFrames: z
    .number()
    .int()
    .default(150)
    .describe("Frames over which the card's slow breath scale completes."),
})

export type LookbookShotSchemaProps = z.infer<typeof lookbookShotSchema>
