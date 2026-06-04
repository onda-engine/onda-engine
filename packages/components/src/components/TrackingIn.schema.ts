//! Runtime prop schema for {@link TrackingIn} — @onda-native (mirrors TrackingInProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const trackingInSchema = z.object({
  text: z.string().default('Onda').describe("The text to settle in."),
  delay: z.number().int().default(0).describe("Frames before the entrance starts."),
  durationInFrames: z.number().int().optional().describe("Frames until the text settles (default DURATION.slow = 24)."),
  color: z.string().optional().describe("Text color (hex #rrggbb / #rrggbbaa); defaults to theme text."),
  fromTracking: z.number().default(0.5).describe("Starting letter-spacing in em \u2014 the text begins spread wide and contracts."),
  tracking: z.number().default(-0.02).describe("Resting letter-spacing in em."),
  blur: z.boolean().default(true).describe("Start the text soft and sharpen as it settles (approximated as a fading ghost layer)."),
  fontSize: z.number().default(96).describe("Font size in px."),
  fontFamily: z.string().optional().describe("Loaded font family (e.g. a --font passed to onda render); defaults to theme fontFamily."),
  fontWeight: z.number().default(600).describe("Font weight (display default 600)."),
  italic: z.boolean().default(false).describe("Italic text."),
  align: z.enum(['left', 'center', 'right']).default('center').describe("Horizontal alignment of the line about x."),
  advanceFactor: z.number().optional().describe("Deprecated and unused; accepted for compat (real shaped letter-spacing metrics are used now)."),
  x: z.number().optional().describe("Absolute x anchor of the line (default canvas center)."),
  y: z.number().optional().describe("Absolute y of the line's top (default vertical center)."),
})

export type TrackingInSchemaProps = z.infer<typeof trackingInSchema>
