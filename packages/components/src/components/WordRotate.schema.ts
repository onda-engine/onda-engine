//! Runtime prop schema for {@link WordRotate} — @onda-native (mirrors WordRotateProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const wordRotateSchema = z.object({
  phrases: z.array(z.string()).default(['fast', 'beautiful', 'restrained']).describe("Phrases cycled in place, in order. One is visible at a time."),
  delay: timeSchema.default(0).describe("Frames before the first phrase begins to enter."),
  holdDuration: timeSchema.default(30).describe("Frames each phrase holds at full opacity before the next arrives."),
  transitionDuration: z.number().int().default(12).describe("Frames for a single phrase to fade in (and, separately, fade out)."),
  color: z.string().optional().describe("Text color. Defaults to theme `text`."),
  fontSize: z.number().default(96).describe("Font size in px. Phrases are usually large."),
  fontFamily: z.string().optional().describe("Loaded font family. Defaults to theme `fontFamily`."),
  fontWeight: z.number().default(600).describe("Font weight (display default 600)."),
  italic: z.boolean().default(false).describe("Italic text."),
  align: z.enum(['left', 'center', 'right']).default('left').describe("Horizontal anchor of each phrase relative to `x`; 'center'/'right' use the measured text width."),
  x: z.number().optional().describe("Absolute x of the anchor point. Defaults to the composition horizontal center."),
  y: z.number().optional().describe("Absolute y (top-ish) of the text. Defaults to vertical center."),
})

export type WordRotateSchemaProps = z.infer<typeof wordRotateSchema>
