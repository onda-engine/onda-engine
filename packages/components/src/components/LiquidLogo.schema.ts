//! Runtime prop schema for {@link LiquidLogo} — @onda-native (mirrors LiquidLogoProps).

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const liquidLogoSchema = z.object({
  logoWordmark: z
    .string()
    .optional()
    .describe('Wordmark that settles beneath the mark (the lockup).'),
  logoSrc: z
    .string()
    .optional()
    .describe('Image/SVG mark that surfaces from the pool instead of the wave (any shape).'),
  markPath: z
    .string()
    .optional()
    .describe(
      'Line-mark the liquid streams into — a stroked path in a 0..48 × 0..12 box (default: the Onda wave). Ignored when logoSrc is set.',
    ),
  accent: z.string().optional().describe('Liquid + mark color (default violet).'),
  background: z.string().optional().describe('Base backdrop color (default near-black).'),
  titleColor: z.string().optional().describe('Wordmark color (default white).'),
  uppercase: z.boolean().default(false).describe('Uppercase the wordmark.'),
  dropCount: z.number().default(6).describe('How many droplets coalesce into the pool.'),
  glow: z.boolean().default(true).describe('The liquid lights the room with an accent glow.'),
  vignette: z.number().default(0.5).describe('Vignette strength 0..1.'),
  gatherFrames: timeSchema
    .default(30)
    .describe('Frames the droplets drift in + fuse into the pool.'),
  flowFrames: timeSchema
    .default(30)
    .describe('Frames the pool streams out along the mark (liquid → brand).'),
  holdFrames: timeSchema.default(40).describe('Frames the finished lockup holds.'),
})

export type LiquidLogoSchemaProps = z.infer<typeof liquidLogoSchema>
