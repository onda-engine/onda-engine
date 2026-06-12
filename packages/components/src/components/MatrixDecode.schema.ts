//! Runtime prop schema for {@link MatrixDecode} — @onda-native (mirrors MatrixDecodeProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { placementSchema } from '../placement.js'

export const matrixDecodeSchema = z.object({
  text: z.string().default('ONDA').describe("The text that decodes into place."),
  delay: z.number().int().default(0).describe("Frames before decoding starts."),
  charDelay: z.number().int().default(3).describe("Frames between successive characters settling (left-to-right)."),
  scrambleDuration: z.number().int().default(18).describe("Frames each character scrambles before it settles (min 1)."),
  scrambleSpeed: z.number().int().default(2).describe("Frames between glyph swaps while scrambling. Lower = faster flicker (min 1)."),
  seed: z.number().int().default(7).describe("Seed for the deterministic glyph picks."),
  charset: z.string().default('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=<>/').describe("Glyph pool drawn from while scrambling."),
  color: z.string().optional().describe("Settled text color (default: theme text)."),
  scrambleColor: z.string().optional().describe("Color of still-scrambling glyphs \u2014 the earned accent (default: theme accent)."),
  fontSize: z.number().default(120).describe("Font size in px."),
  fontFamily: z.string().optional().describe("Monospace stack keeps the advance steady as glyphs flicker (default: theme monoFamily)."),
  fontWeight: z.number().default(600).describe("Font weight."),
  italic: z.boolean().default(false).describe("Italic text."),
  align: z.enum(['left', 'center', 'right']).default('center').describe("Horizontal anchoring of the single line (approximate)."),
  x: z.number().optional().describe("Absolute x of the line. Defaults to the canvas center (per align)."),
  y: z.number().optional().describe("Absolute y (top-ish) of the line. Defaults to vertical center."),
  placement: placementSchema.optional().describe("Where the element sits: a region keyword ('center', 'lower-third', 'upper-third', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right') or normalized {x,y} (0-1 canvas fractions, element-center anchored). Default 'center'."),
  fit: z.enum(['none', 'frame']).optional().describe("Opt-in auto-fit: 'frame' scales the font size DOWN (never up) so the line cannot exceed the frame minus the safe margins. Default 'none'."),
  maxWidth: z.number().optional().describe("Explicit width cap in px for the line; combines with fit (the smaller cap wins)."),
})

export type MatrixDecodeSchemaProps = z.infer<typeof matrixDecodeSchema>
