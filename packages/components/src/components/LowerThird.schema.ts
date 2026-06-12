//! Runtime prop schema for {@link LowerThird} — @onda-native (mirrors LowerThirdProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const lowerThirdSchema = z.object({
  name: z.string().default('Rodrigo').describe("The person's name (the primary line)."),
  role: z.string().default('CEO, Onda').describe("The person's role / title (the secondary line)."),
  placement: z.enum(['bottom-left', 'bottom-right', 'bottom-center', 'top-left', 'top-right', 'top-center']).default('bottom-left').describe("Which canvas region the bar sits in; corners flush left/right, *-center centers the block on the mid-line (for a single credit/URL line)."),
  delay: timeSchema.default(0).describe("Frames before the name slides in."),
  accent: z.boolean().default(true).describe("Show the accent rule beneath the name."),
  color: z.string().optional().describe("Name color (defaults to theme text)."),
  roleColor: z.string().optional().describe("Role color (defaults to theme textMuted)."),
  accentColor: z.string().optional().describe("Accent rule color (defaults to theme accent)."),
  fontSize: z.number().default(48).describe("Name font size in px."),
  nameFontWeight: z.number().default(600).describe("Name font weight."),
  roleFontSize: z.number().default(22).describe("Role font size in px."),
  roleFontWeight: z.number().default(500).describe("Role font weight."),
  fontFamily: z.string().optional().describe("Loaded font family for both lines (defaults to theme fontFamily)."),
  cornerRadius: z.number().optional().describe("Accent rule corner radius in px, capped so a thin sliver never bulges (defaults to theme radius)."),
})

export type LowerThirdSchemaProps = z.infer<typeof lowerThirdSchema>
