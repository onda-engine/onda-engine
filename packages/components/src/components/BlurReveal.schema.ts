//! Runtime prop schema for {@link BlurReveal} — @onda-native (mirrors BlurRevealProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const blurRevealSchema = z.object({
  text: z.string().default('Onda').describe("What to reveal. Rendered as a single-line Text node."),
  delay: z.number().int().default(0).describe("Frames before the reveal starts."),
  durationInFrames: z.number().int().optional().describe("Frames until the reveal fully settles (DURATION.base = 18)."),
  color: z.string().optional().describe("Text color (hex #rrggbb / #rrggbbaa); defaults to theme text."),
  fontSize: z.number().default(96).describe("Text size in px."),
  fontFamily: z.string().optional().describe("Loaded font family; defaults to theme fontFamily."),
  fontWeight: z.number().default(600).describe("Font weight (display default 600)."),
  placement: z.enum(['center', 'top', 'bottom']).default('center').describe("Vertical placement within the composition."),
  travelPx: z.number().default(16).describe("Rise distance in px (small on purpose)."),
  fromScale: z.number().default(0.97).describe("Starting scale for the focus-settle; close to 1 by design."),
})

export type BlurRevealSchemaProps = z.infer<typeof blurRevealSchema>
