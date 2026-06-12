//! Runtime prop schema for {@link MaskReveal} — @onda-native (mirrors MaskRevealProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'
import { placementSchema } from '../placement.js'

export const maskRevealSchema = z.object({
  text: z.string().default('Onda').describe("The single line of text to reveal."),
  delay: timeSchema.default(0).describe("Frames before the reveal starts."),
  duration: timeSchema.optional().describe("Frames for the mask to fully retreat."),
  direction: z.enum(['left', 'right', 'top', 'bottom']).default('left').describe("The side the content appears to come in from; the mask retreats toward this side."),
  color: z.string().optional().describe("Text color as a hex string; defaults to the theme text color."),
  fontSize: z.number().default(96).describe("Text size in px."),
  fontFamily: z.string().optional().describe("Loaded font family; defaults to the theme heading or base font family."),
  fontWeight: z.number().default(600).describe("Font weight (display default 600)."),
  italic: z.boolean().default(false).describe("Render the text in italic."),
  width: z.number().optional().describe("Clip-box width in px; otherwise estimated from the measured text."),
  height: z.number().optional().describe("Clip-box height in px; otherwise fontSize times 1.2."),
  placement: placementSchema.optional().describe("Where the element sits: a region keyword ('center', 'lower-third', 'upper-third', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right') or normalized {x,y} (0-1 canvas fractions, element-center anchored). Default 'center'."),
  fit: z.enum(['none', 'frame']).optional().describe("Opt-in auto-fit: 'frame' scales the font size DOWN (never up) so the line cannot exceed the frame minus the safe margins. Default 'none'."),
  maxWidth: z.number().optional().describe("Explicit width cap in px for the line; combines with fit (the smaller cap wins)."),
})

export type MaskRevealSchemaProps = z.infer<typeof maskRevealSchema>
