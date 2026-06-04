//! Runtime prop schema for {@link EndCard} — @onda-native (mirrors EndCardProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const endCardSchema = z.object({
  cta: z.string().default('Made with Onda').describe("Hero CTA / headline line."),
  handles: z.array(z.string()).default(['@onda.video', 'onda.video/components']).describe("Social handles or URLs displayed in a row beneath the CTA."),
  delay: z.number().int().default(0).describe("Frames before the CTA starts; the whole card is sequenced relative to this."),
  accent: z.boolean().default(true).describe("Show the accent underline beneath the CTA."),
  ctaFontSize: z.number().default(96).describe("CTA font size in px."),
  ctaFontWeight: z.number().default(600).describe("Font weight for the CTA."),
  handlesFontSize: z.number().default(24).describe("Handles row font size in px."),
  handlesFontWeight: z.number().default(600).describe("Font weight for the handles row."),
  color: z.string().optional().describe("CTA color (defaults to theme text)."),
  handlesColor: z.string().optional().describe("Handles color, kept quiet (defaults to theme textMuted)."),
  accentColor: z.string().optional().describe("Underline color (defaults to theme accent)."),
  fontFamily: z.string().optional().describe("Loaded display font for both CTA and handles (defaults to theme fontFamily)."),
})

export type EndCardSchemaProps = z.infer<typeof endCardSchema>
