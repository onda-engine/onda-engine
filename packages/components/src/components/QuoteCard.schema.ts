//! Runtime prop schema for {@link QuoteCard} — @onda-native (mirrors QuoteCardProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { placementSchema } from '../placement.js'

export const quoteCardSchema = z.object({
  quote: z.string().default('Motion is the difference between art and craft.').describe("The pull-quote body, revealed word-by-word on a slower-than-canonical stagger."),
  author: z.string().default('Saul Bass').describe("Attribution name."),
  role: z.string().default('Graphic Designer').describe("Attribution role / title."),
  delay: z.number().int().default(0).describe("Frames before the quote starts."),
  accent: z.boolean().default(true).describe("Show the accent divider between quote and attribution."),
  quoteFontSize: z.number().default(56).describe("Quote font size in px."),
  quoteFontWeight: z.number().default(600).describe("Quote font weight (display default 600)."),
  authorFontSize: z.number().default(22).describe("Author / role font size in px."),
  authorFontWeight: z.number().default(500).describe("Author / role font weight."),
  color: z.string().optional().describe("Quote color (defaults to theme text)."),
  authorColor: z.string().optional().describe("Author / role color (defaults to theme textMuted)."),
  accentColor: z.string().optional().describe("Divider color (defaults to theme accent)."),
  fontFamily: z.string().optional().describe("Loaded font family for every line (defaults to theme fontFamily)."),
  quoteWidth: z.number().optional().describe("Wrap width for the quote in px (defaults to ~44% of the composition width)."),
  placement: placementSchema.optional().describe("Where the element sits: a region keyword ('center', 'lower-third', 'upper-third', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right') or normalized {x,y} (0-1 canvas fractions, element-center anchored). Default 'center'."),
})

export type QuoteCardSchemaProps = z.infer<typeof quoteCardSchema>
