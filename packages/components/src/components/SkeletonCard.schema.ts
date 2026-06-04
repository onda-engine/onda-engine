//! Runtime prop schema for {@link SkeletonCard} — @onda-native (mirrors SkeletonCardProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const skeletonCardSchema = z.object({
  lines: z.number().int().default(3).describe("Number of placeholder text bars below the (optional) thumbnail."),
  thumbnail: z.boolean().default(true).describe("Show the leading thumbnail block above the bars."),
  shimmerSpeed: z.number().int().default(48).describe("Frames for one shimmer pass across the card. Lower = faster sweep."),
  shimmerColor: z.string().describe("The travelling highlight color \u2014 a soft sheen over the bars (default: theme border)."),
  barColor: z.string().describe("Resting fill of the placeholder bars / thumbnail (default: theme surface)."),
  cardColor: z.string().describe("Card (panel) background \u2014 the translucent glass fill (default: theme background)."),
  borderColor: z.string().describe("Card border color (the 1px-equivalent stroke) (default: theme border)."),
  delay: z.number().int().default(0).describe("Frames before the card enters."),
  width: z.number().default(480).describe("Card width in px."),
  height: z.number().optional().describe("Card height in px. undefined sizes the card to its content."),
  barHeight: z.number().default(18).describe("Base bar height in px."),
  padding: z.number().default(32).describe("Inner padding of the card in px."),
})

export type SkeletonCardSchemaProps = z.infer<typeof skeletonCardSchema>
