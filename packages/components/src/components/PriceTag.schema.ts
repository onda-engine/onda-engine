//! Runtime prop schema for {@link PriceTag} — @onda-native (mirrors PriceTagProps).

import { z } from 'zod'
import { textStyleSchemaShape } from '../text-style.js'

export const priceTagSchema = z.object({
  ...textStyleSchemaShape,
  name: z
    .string()
    .default('Product')
    .describe('Product name — the label, set in the display face.'),
  price: z
    .string()
    .default('$0')
    .describe("Price as a string so any currency works (e.g. '$70', '€19', '£12.50')."),
  sold: z
    .boolean()
    .default(false)
    .describe('Show the SOLD state — dims + strikes the price and appends a muted pill.'),
  soldLabel: z.string().default('SOLD').describe('The SOLD pill label.'),
  delay: z.number().int().default(0).describe('Frames before the chip enters.'),
  size: z
    .number()
    .default(1)
    .describe('Base scale for the chip (1 = the default size). Scales type + padding together.'),
  priceColor: z.string().optional().describe('Price text color (defaults to theme accent).'),
  accentColor: z
    .string()
    .optional()
    .describe('Divider + SOLD-pill accent color (defaults to theme accent).'),
  surface: z.string().optional().describe('Chip fill color (defaults to theme surface).'),
  border: z.string().optional().describe('Chip hairline border color (defaults to theme border).'),
  bodyFamily: z
    .string()
    .optional()
    .describe('Body font for the price + SOLD pill (defaults to theme fontFamily).'),
  x: z
    .number()
    .optional()
    .describe("Local-space x of the chip's top-left. Omit to center on the composition."),
  y: z
    .number()
    .optional()
    .describe("Local-space y of the chip's top-left. Omit to center on the composition."),
})

export type PriceTagSchemaProps = z.infer<typeof priceTagSchema>
