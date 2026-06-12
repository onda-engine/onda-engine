//! Runtime prop schema for {@link TitleCard} — @onda-native (mirrors TitleCardProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'
import { placementSchema } from '../placement.js'

export const titleCardSchema = z.object({
  title: z.string().describe("The hero headline rendered as the large centered title."),
  subtitle: z.string().optional().describe("Optional smaller phrase shown beneath the title, fading in one stagger step later."),
  titleSize: z.number().default(120).describe("Title font size in px."),
  subtitleSize: z.number().default(36).describe("Subtitle font size in px."),
  titleColor: z.string().optional().describe("Title color (defaults to theme text)."),
  subtitleColor: z.string().optional().describe("Subtitle color (defaults to theme textMuted)."),
  fontFamily: z.string().optional().describe("Loaded font family (defaults to theme heading family, else body family)."),
  delay: timeSchema.default(0).describe("Frame the title begins fading in; the subtitle follows by one stagger step."),
  placement: placementSchema.optional().describe("Where the element sits: a region keyword ('center', 'lower-third', 'upper-third', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right') or normalized {x,y} (0-1 canvas fractions, element-center anchored). Default 'center'."),
  fit: z.enum(['none', 'frame']).optional().describe("Opt-in auto-fit: 'frame' scales the font size DOWN (never up) so the line cannot exceed the frame minus the safe margins. Default 'none'."),
  maxWidth: z.number().optional().describe("Explicit width cap in px for the line; combines with fit (the smaller cap wins)."),
})

export type TitleCardSchemaProps = z.infer<typeof titleCardSchema>
