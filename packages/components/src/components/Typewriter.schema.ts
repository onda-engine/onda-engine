//! Runtime prop schema for {@link Typewriter} — @onda-native (mirrors TypewriterProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { placementSchema } from '../placement.js'

export const typewriterSchema = z.object({
  text: z.string().default('motion graphics').describe("What to type out."),
  delay: z.number().int().default(0).describe("Frames before typing starts."),
  durationInFrames: z.number().int().optional().describe("Frames to type the full string; linear pacing means chars-per-frame is constant (default 24)."),
  cursor: z.boolean().default(true).describe("Show a blinking cursor at the leading edge while typing."),
  cursorColor: z.string().optional().describe("Cursor color (defaults to theme accent)."),
  color: z.string().optional().describe("Text color (defaults to theme text)."),
  fontSize: z.number().default(64).describe("Font size in px."),
  fontFamily: z.string().optional().describe("Loaded font family (defaults to theme fontFamily)."),
  fontWeight: z.number().default(500).describe("Font weight (default 500 reads more 'terminal')."),
  italic: z.boolean().default(false).describe("Italic text."),
  x: z.number().optional().describe("Absolute x of the text's left edge (defaults to a centered origin from the measured full-text width)."),
  y: z.number().optional().describe("Absolute y top of the text (defaults to vertical center)."),
  placement: placementSchema.optional().describe("Where the element sits: a region keyword ('center', 'lower-third', 'upper-third', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right') or normalized {x,y} (0-1 canvas fractions, element-center anchored). Default 'center'."),
  fit: z.enum(['none', 'frame']).optional().describe("Opt-in auto-fit: 'frame' scales the font size DOWN (never up) so the line cannot exceed the frame minus the safe margins. Default 'none'."),
  maxWidth: z.number().optional().describe("Explicit width cap in px for the line; combines with fit (the smaller cap wins)."),
})

export type TypewriterSchemaProps = z.infer<typeof typewriterSchema>
