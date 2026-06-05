//! Runtime prop schema for {@link KineticText} — @onda-native (mirrors KineticTextProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const kineticTextSchema = z.object({
  text: z
    .string()
    .default('kinetic')
    .describe('The line to choreograph; laid out as one row of absolutely-placed glyphs.'),
  fontSize: z.number().default(96).describe('Font size in px.'),
  preset: z
    .enum(['rise', 'fade', 'scale', 'blur', 'wave'])
    .default('rise')
    .describe('Per-glyph entrance flavor.'),
  stagger: z
    .number()
    .int()
    .default(5)
    .describe('Frames between consecutive glyphs entering (STAGGER = 5).'),
  durationInFrames: z
    .number()
    .int()
    .default(22)
    .describe("Frames each glyph's entrance takes to settle (DURATION.base = 22)."),
  delay: z.number().int().default(0).describe('Frames before the first glyph starts.'),
  align: z
    .enum(['left', 'center', 'right'])
    .default('center')
    .describe('Horizontal alignment of the line about its anchor.'),
  color: z.string().optional().describe('Text color; defaults to theme text color.'),
  fontFamily: z.string().optional().describe('Loaded font family; defaults to theme font family.'),
  fontWeight: z.number().default(600).describe('Font weight (display default).'),
})

export type KineticTextSchemaProps = z.infer<typeof kineticTextSchema>
