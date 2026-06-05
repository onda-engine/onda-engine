//! Runtime prop schema for {@link FilmGrade} — @onda-native (mirrors FilmGradeProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const filmGradeSchema = z.object({
  look: z
    .enum(['warm', 'cool', 'noir', 'teal-orange', 'vibrant', 'film', 'faded'])
    .default('film')
    .describe(
      'The named cinematic look applied to the whole subtree: warm, cool, noir (b&w), teal-orange (blockbuster split-tone), vibrant, film (subtle default), or faded (matte/washed).',
    ),
  intensity: z
    .number()
    .default(1)
    .describe(
      'Strength of the look, 0..1. Lerps every grade param from neutral toward the look: 0 = no grade (pass-through), 1 = the full look.',
    ),
  exposure: z
    .number()
    .optional()
    .describe(
      'Explicit linear-exposure override (2^exposure; 0 = identity), applied on top of the look.',
    ),
  contrast: z
    .number()
    .optional()
    .describe('Explicit contrast override (1 = identity), applied on top of the look.'),
  saturation: z
    .number()
    .optional()
    .describe(
      'Explicit saturation override (1 = identity, 0 = grayscale), applied on top of the look.',
    ),
  temperature: z
    .number()
    .optional()
    .describe(
      'Explicit warm/cool override (R up / B down for positive; 0 = neutral), applied on top.',
    ),
  tint: z
    .number()
    .optional()
    .describe('Explicit green/magenta override (positive = green; 0 = neutral), applied on top.'),
})

export type FilmGradeSchemaProps = z.infer<typeof filmGradeSchema>
