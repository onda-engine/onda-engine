//! Runtime prop schema for {@link TitleCard} — @onda-native (mirrors TitleCardProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const titleCardSchema = z.object({
  title: z.string().describe("The hero headline rendered as the large centered title."),
  subtitle: z.string().optional().describe("Optional smaller phrase shown beneath the title, fading in one stagger step later."),
  titleSize: z.number().default(120).describe("Title font size in px."),
  subtitleSize: z.number().default(36).describe("Subtitle font size in px."),
  titleColor: z.string().optional().describe("Title color (defaults to theme text)."),
  subtitleColor: z.string().optional().describe("Subtitle color (defaults to theme textMuted)."),
  fontFamily: z.string().optional().describe("Loaded font family (defaults to theme heading family, else body family)."),
  delay: z.number().default(0).describe("Frame the title begins fading in; the subtitle follows by one stagger step."),
})

export type TitleCardSchemaProps = z.infer<typeof titleCardSchema>
