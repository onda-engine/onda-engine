//! Runtime prop schema for {@link TextFadeReplace} — @onda-native (mirrors TextFadeReplaceProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const textFadeReplaceSchema = z.object({
  from: z.string().describe("The outgoing phrase (shown first, fades out)."),
  to: z.string().describe("The incoming phrase (fades in over `from`)."),
  delay: z.number().int().optional().describe("Frames before the crossfade begins; until then only `from` is shown (default 45)."),
  durationInFrames: z.number().int().optional().describe("Frames the crossfade takes \u2014 old out over the first half, new in over the second (default 18)."),
  fontSize: z.number().default(96).describe("Font size in px (default 96)."),
  color: z.string().optional().describe("Text color (hex #rrggbb / #rrggbbaa); defaults to theme `text`."),
  fontFamily: z.string().optional().describe("Loaded font family; defaults to theme `headingFamily`."),
  fontWeight: z.number().default(600).describe("Font weight (default 600)."),
})

export type TextFadeReplaceSchemaProps = z.infer<typeof textFadeReplaceSchema>
