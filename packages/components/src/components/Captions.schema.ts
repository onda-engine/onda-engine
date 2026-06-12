//! Runtime prop schema for {@link Captions} — @onda-native (mirrors CaptionsProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const captionsSchema = z.object({
  captions: z.any().default([{ text: 'Onda', startMs: 0, endMs: 1500 }, { text: 'kinetic', startMs: 1500, endMs: 3000 }, { text: 'captions', startMs: 3000, endMs: 4500 }]).describe("The transcript timeline; each entry is a word plus its [startMs, endMs) activation window."),
  delay: timeSchema.default(0).describe("Frames before the timeline starts (shifts every startMs by this)."),
  color: z.string().optional().describe("Settled word color — the near-white tone a word relaxes to once the eye has landed past it (defaults to theme text)."),
  accentColor: z.string().optional().describe("Active word color — the one earned accent carried by the word the eye is currently landing on as the line cascades in (defaults to theme accent)."),
  fontSize: z.number().default(96).describe("Font size in px."),
  fontFamily: z.string().optional().describe("Loaded font family (defaults to theme fontFamily)."),
  fontWeight: z.number().default(600).describe("Font weight (display default 600)."),
  letterSpacing: z.string().optional().describe("CSS letter-spacing (e.g. '-0.02em' or '2px'); applied to the caption and folded into its measured width so centering stays exact."),
  lineHeight: z.number().optional().describe("Unitless line height; accepted for ondajs parity but not applied (the scene Text uses a fixed text box)."),
  align: z.enum(['left', 'center', 'right']).default('center').describe("Text alignment of the caption block within its line(s)."),
  placement: z.union([z.enum(['center', 'top', 'bottom', 'upper-third', 'lower-third']), z.object({ x: z.number().min(0).max(1).optional(), y: z.number().min(0).max(1).optional() })]).default('lower-third').describe("Vertical placement band of the caption block (defaults to the broadcast lower-third subtitle position), or a normalized {x,y} point (0-1, line center) per the shared placement contract."),
  maxWidth: z.number().default(0.8).describe("Max line width as a 0\u20131 fraction of canvas width; the block wraps within this safe band."),
})

export type CaptionsSchemaProps = z.infer<typeof captionsSchema>
