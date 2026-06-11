//! Runtime prop schema for {@link Scrim} — @onda-native (mirrors ScrimProps).

import { z } from 'zod'

export const scrimSchema = z.object({
  color: z
    .string()
    .optional()
    .describe('Veil color (hex). Default white — lifts a busy photo so dark text reads.'),
  opacity: z.number().default(0.3).describe('Veil strength 0..1 (default 0.3).'),
  delay: z.number().int().default(0).describe('Frames before it appears.'),
  fadeIn: z.boolean().default(true).describe('Fade the veil in over the first 8 frames.'),
})

export type ScrimSchemaProps = z.infer<typeof scrimSchema>
