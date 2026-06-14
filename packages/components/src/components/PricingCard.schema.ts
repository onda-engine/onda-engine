//! Runtime prop schema for {@link PricingCard} — @onda-native (mirrors PricingCardProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { placementSchema } from '../placement.js'
import { textStyleSchemaShape } from '../text-style.js'
import { timeSchema } from '../time.js'

export const pricingCardSchema = z.object({
  ...textStyleSchemaShape,
  tier: z
    .string()
    .default('Pro')
    .describe("Tier name above the price (e.g. 'Pro'). Rendered uppercase."),
  price: z
    .string()
    .default('$29')
    .describe("The headline price, rendered large. Free-form: '$29', '\u20ac19', 'Free'."),
  period: z
    .string()
    .default('/month')
    .describe("Billing period beneath the price (e.g. '/month'). Empty hides it."),
  features: z
    .array(z.string())
    .optional()
    .describe(
      'Feature checklist \u2014 each item gets an accent checkmark, revealed on a stagger.',
    ),
  cta: z.string().default('Get started').describe('Call-to-action button label.'),
  recommended: z
    .boolean()
    .default(false)
    .describe('Lifts + scales the card and shows an accent badge \u2014 the highlighted tier.'),
  accent: z
    .string()
    .optional()
    .describe(
      'The earned accent \u2014 checkmarks, badge, CTA, recommended border + glow (default: theme accent).',
    ),
  delay: timeSchema.default(0).describe('Frames before the card enters.'),
  width: z.number().default(380).describe('Card width in px.'),
  priceSize: z.number().default(64).describe('Price font size in px (the large display number).'),
  background: z.string().optional().describe('Panel fill color (default: theme surface).'),
  borderColor: z
    .string()
    .optional()
    .describe('Panel border color (when not recommended) (default: theme border).'),
  dimColor: z
    .string()
    .optional()
    .describe('Dim color for the tier label (default: theme textMuted).'),
  faintColor: z
    .string()
    .optional()
    .describe('Faint color for the billing period (default: theme textMuted).'),
  bodyFontFamily: z
    .string()
    .optional()
    .describe('Body font for tier / features / CTA (default: theme fontFamily).'),
  x: z
    .number()
    .optional()
    .describe("Local-space x of the card's top-left. Omit to center on the composition."),
  y: z
    .number()
    .optional()
    .describe("Local-space y of the card's top-left. Omit to center on the composition."),
  placement: placementSchema
    .optional()
    .describe(
      "Where the element sits: a region keyword ('center', 'lower-third', 'upper-third', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right') or normalized {x,y} (0-1 canvas fractions, element-center anchored). Default 'center'.",
    ),
})

export type PricingCardSchemaProps = z.infer<typeof pricingCardSchema>
