//! Runtime prop schema for {@link SpotlightCard} — @onda-native (mirrors SpotlightCardProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { textStyleSchemaShape } from '../text-style.js'
import { timeSchema } from '../time.js'

export const spotlightCardSchema = z.object({
  ...textStyleSchemaShape,
  eyebrow: z
    .string()
    .default('FEATURE')
    .describe('Small uppercase kicker above the title; empty hides it.'),
  title: z
    .string()
    .default('Motion identity')
    .describe('Card headline rendered in the display font.'),
  body: z
    .string()
    .default('One consistent feel across every component.')
    .describe('Supporting body copy; empty hides it; single line.'),
  delay: timeSchema.default(0).describe('Frames before the card enters.'),
  glowColor: z
    .string()
    .optional()
    .describe('The drifting spotlight color \u2014 the earned accent (default: theme accent).'),
  width: z.number().default(560).describe('Card width in px.'),
  height: z
    .number()
    .optional()
    .describe('Card height in px; if omitted, sized from content plus padding.'),
  padding: z.number().default(48).describe('Inner padding in px.'),
  align: z.enum(['left', 'center']).default('left').describe('Text alignment within the card.'),
  bodyFontFamily: z
    .string()
    .optional()
    .describe('Font family for the eyebrow and body copy (default: theme fontFamily).'),
  titleSize: z.number().default(44).describe('Title font size in px.'),
  bodySize: z.number().default(20).describe('Body font size in px.'),
  eyebrowSize: z.number().default(15).describe('Eyebrow font size in px.'),
  titleColor: z.string().optional().describe('Title color (default: theme text).'),
  bodyColor: z.string().optional().describe('Body color (default: theme textMuted).'),
  eyebrowColor: z.string().optional().describe('Eyebrow color (default: theme textMuted).'),
  background: z
    .string()
    .optional()
    .describe('Card glass fill, translucent dark by default (default: theme surface).'),
  borderColor: z
    .string()
    .optional()
    .describe('Card border (stroke) color (default: theme border).'),
  cornerRadius: z.number().optional().describe('Corner radius in px (default: theme radius).'),
})

export type SpotlightCardSchemaProps = z.infer<typeof spotlightCardSchema>
