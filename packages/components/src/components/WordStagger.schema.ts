//! Runtime prop schema for {@link WordStagger} — @onda-native (mirrors WordStaggerProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const wordStaggerSchema = z.object({
  text: z.string().default('motion that moves you').describe("The phrase; split on whitespace into one reveal per word."),
  fontSize: z.number().default(64).describe("Font size in px."),
  color: z.string().describe("Text color; defaults to theme text color."),
  width: z.number().default(1080).describe("Container width in px; the line wraps within this."),
  fontFamily: z.string().describe("Loaded font family; defaults to theme font family."),
  fontWeight: z.number().default(600).describe("Font weight (display default)."),
  justify: z.enum(['start', 'center', 'end']).default('start').describe("Horizontal alignment of words within each line."),
  delay: z.number().int().default(0).describe("Frames before the first word starts."),
  stagger: z.number().int().optional().describe("Frames between consecutive words (defaults to STAGGER = 4)."),
})

export type WordStaggerSchemaProps = z.infer<typeof wordStaggerSchema>
