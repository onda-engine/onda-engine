//! Runtime prop schema for {@link LogoReveal} — @onda-native (mirrors LogoRevealProps).

import { z } from 'zod'

export const logoRevealSchema = z.object({
  src: z
    .string()
    .default('')
    .describe('Logo image source (resolved at render time by `onda render`).'),
  width: z
    .number()
    .default(520)
    .describe('Logo box width in px (the image is fit="contain" inside it — never cropped).'),
  height: z.number().default(260).describe('Logo box height in px.'),
  delay: z.number().int().default(0).describe('Frames before the reveal starts.'),
  durationInFrames: z
    .number()
    .int()
    .default(28)
    .describe('Frames over which the reveal completes (the house-spring duration).'),
  preset: z
    .enum(['focus', 'rise', 'scale'])
    .default('focus')
    .describe('Reveal style — focus (blur pull, default), rise, or scale.'),
  fromBlur: z.number().default(14).describe('Starting blur sigma (px) for the focus pull.'),
})

export type LogoRevealSchemaProps = z.infer<typeof logoRevealSchema>
