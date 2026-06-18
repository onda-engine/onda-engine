//! Runtime prop schema for {@link CardShowcase} — mirrors CardShowcaseProps.
//! The Studio agent generates against this; the preview/export renderer validates
//! with it. Edit the component + this schema together.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const cardShowcaseSchema = z.object({
  brand: z
    .string()
    .default('Lumen')
    .describe('Brand wordmark shown big on the hero card + as the centered logo.'),
  network: z
    .string()
    .default('VISA')
    .describe('Payment-network mark on the hero card (e.g. VISA, Mastercard).'),
  cardNumber: z.string().default('···· 3346').describe('Masked card number on the hero card.'),
  heroColor: z.string().default('#3D2BE0').describe('Hero card fill — the brand color.'),
  heroTextColor: z.string().default('#EAEAFF').describe('Text color on the hero card.'),
  tierColors: z
    .array(z.string())
    .default(['#111114', '#F3F3F6', '#8E93A1', '#5B3EE0', '#1B1C22', '#D7D9E0'])
    .describe('Palette for the surrounding (ghost) tier cards — 4–6 reads best.'),
  background: z.string().default('#ECECEF').describe('Canvas behind the cards.'),
  tilt: z
    .number()
    .default(-22)
    .describe('Grid tilt in degrees (the diagonal alignment); rotates to 0 at the end.'),
  speed: z.number().default(320).describe('Slide speed in px/sec.'),
  logo: z
    .string()
    .default('')
    .describe('Center logo text revealed at the end (e.g. a brand). Empty = none.'),
  logoColor: z.string().optional().describe('Logo color (default: heroColor).'),
  duration: timeSchema.default('10s').describe('Total length of the choreography.'),
})

export type CardShowcaseSchemaProps = z.infer<typeof cardShowcaseSchema>
