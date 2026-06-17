//! Runtime prop schema for {@link PulsingIndicator} — @onda-native (mirrors PulsingIndicatorProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { textStyleSchemaShape } from '../text-style.js'

export const pulsingIndicatorSchema = z.object({
  ...textStyleSchemaShape,
  // `color` here is the dot/ring fill (not the label text color); its own
  // description overrides the shared text-style `color` above.
  color: z.string().optional().describe('Dot + ring color (defaults to theme accent).'),
  size: z.number().default(20).describe('Dot diameter in px.'),
  label: z
    .string()
    .default('LIVE')
    .describe('Optional label to the right of the dot; empty hides it.'),
  labelColor: z.string().optional().describe('Label color (defaults to theme textMuted).'),
  fontSize: z.number().default(28).describe('Label font size in px.'),
  period: z.number().int().default(45).describe('Frames per pulse cycle.'),
  x: z
    .number()
    .optional()
    .describe("X of the indicator's top-left; when omitted the dot + label assembly is centered."),
  y: z
    .number()
    .optional()
    .describe("Y of the indicator's top-left; when omitted the dot + label assembly is centered."),
})

export type PulsingIndicatorSchemaProps = z.infer<typeof pulsingIndicatorSchema>
