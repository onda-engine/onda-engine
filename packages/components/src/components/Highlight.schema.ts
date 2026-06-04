//! Runtime prop schema for {@link Highlight} — @onda-native (mirrors HighlightProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const highlightSchema = z.object({
  text: z.string().default('highlight this').describe("Text to highlight."),
  delay: z.number().int().default(0).describe("Frames before the text starts revealing."),
  duration: z.number().int().optional().describe("Text reveal duration in frames (default DURATION.base = 18)."),
  lineDelay: z.number().int().default(8).describe("Frames to wait after the text appears before the accent bar wipes in."),
  lineDuration: z.number().int().optional().describe("Accent-bar wipe duration. Fast on purpose \u2014 emphatic (default DURATION.fast)."),
  color: z.string().optional().describe("Text color (default: theme text)."),
  accentColor: z.string().optional().describe("Accent (highlight) bar color (default: theme accent)."),
  fontSize: z.number().default(64).describe("Font size in px (default 64)."),
  fontFamily: z.string().optional().describe("Loaded font family (default: theme fontFamily)."),
  fontWeight: z.number().default(600).describe("Font weight (display default 600)."),
  paddingX: z.number().default(8).describe("Pixels past the text edges that the accent bar extends (default 8)."),
  width: z.number().optional().describe("Explicit text width in px. Overrides the glyph-count estimate when known."),
  x: z.number().default(0).describe("Local-space placement of the component's top-left."),
  y: z.number().default(0).describe("Local-space placement of the component's top-left."),
})

export type HighlightSchemaProps = z.infer<typeof highlightSchema>
