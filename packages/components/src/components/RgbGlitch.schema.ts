//! Runtime prop schema for {@link RgbGlitch} — @onda-native (mirrors RgbGlitchProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const rgbGlitchSchema = z.object({
  text: z.string().default('GLITCH').describe('The text to glitch.'),
  delay: timeSchema.default(0).describe('Frames before the effect starts.'),
  baseSplit: z
    .number()
    .default(2)
    .describe('Constant baseline channel split in px (the always-on chromatic edge).'),
  intensity: z.number().default(10).describe('Peak extra split in px during a glitch burst.'),
  glitchPeriod: z.number().int().default(48).describe('Frames between glitch bursts.'),
  glitchDuration: z.number().int().default(8).describe('Frames a glitch burst lasts.'),
  seed: z.number().int().default(7).describe('Seed for the (deterministic) burst jitter.'),
  color: z.string().optional().describe('Base (center) text color (default: theme text).'),
  redColor: z.string().optional().describe('Red-channel copy color (default: theme accent).'),
  cyanColor: z.string().optional().describe('Cyan-channel copy color (default: theme palette[1]).'),
  channelOpacity: z
    .number()
    .default(0.85)
    .describe(
      'Opacity of the coloured channel copies (screen-blend approximation; lower keeps the center clean white).',
    ),
  fontSize: z.number().default(120).describe('Font size in px.'),
  fontFamily: z.string().optional().describe('Loaded font family (default: theme fontFamily).'),
  fontWeight: z.number().default(600).describe('Font weight (default 600).'),
  italic: z.boolean().default(false).describe('Italic text.'),
  align: z
    .enum(['left', 'center', 'right'])
    .default('center')
    .describe('Line alignment relative to the placement point.'),
  x: z
    .number()
    .optional()
    .describe('Absolute x of the alignment anchor (defaults to canvas horizontal center).'),
  y: z
    .number()
    .optional()
    .describe('Absolute y (top-ish) of the line (defaults to vertical center).'),
  variant: z
    .number()
    .int()
    .optional()
    .describe(
      "Integer 'take' selector: derives a new deterministic seed from (seed, variant), so alternates never require hand-edited seeds. 0/omitted = the default take.",
    ),
})

export type RgbGlitchSchemaProps = z.infer<typeof rgbGlitchSchema>
