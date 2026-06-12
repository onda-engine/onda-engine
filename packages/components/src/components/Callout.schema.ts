//! Runtime prop schema for {@link Callout} — @onda-native (mirrors CalloutProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'
import { placementSchema } from '../placement.js'

export const calloutSchema = z.object({
  label: z.string().default('Look here').describe("Bubble label. Single line \u2014 no auto-wrap."),
  x: z.number().default(0.5).describe("Bubble-center X as a 0..1 fraction of canvas width (default 0.5 = center)."),
  y: z.number().default(0.5).describe("Bubble-center Y as a 0..1 fraction of canvas height (default 0.5 = center)."),
  direction: z.enum(['top', 'bottom', 'left', 'right']).default('bottom').describe("Side the pointer triangle sticks out from (and the rough direction the callout is aimed)."),
  delay: timeSchema.default(0).describe("Frames before the bubble starts revealing."),
  duration: timeSchema.optional().describe("Bubble scale-and-fade reveal duration in frames."),
  lineDelay: timeSchema.default(6).describe("Frames after the bubble starts before the pointer eases in."),
  lineDuration: timeSchema.optional().describe("Pointer reveal duration in frames."),
  color: z.string().optional().describe("Label color (default: theme text)."),
  bgColor: z.string().optional().describe("Bubble background fill (default: an elevated translucent-white surface that lifts the bubble off the dark canvas)."),
  borderColor: z.string().optional().describe("Bubble border color (default: a bright translucent-white hairline)."),
  borderWidth: z.number().default(1).describe("Bubble border width in px."),
  fontSize: z.number().default(20).describe("Label font size in px."),
  fontFamily: z.string().optional().describe("Loaded font family (the Onda display font) (default: theme fontFamily)."),
  fontWeight: z.number().default(500).describe("Label font weight."),
  paddingX: z.number().default(14).describe("Horizontal padding inside the bubble in px."),
  paddingY: z.number().default(8).describe("Vertical padding inside the bubble in px."),
  cornerRadius: z.number().optional().describe("Bubble corner radius (default: theme radius)."),
  pointerWidth: z.number().default(18).describe("Pointer triangle base width in px."),
  pointerLength: z.number().default(12).describe("Pointer triangle length (how far it pokes out) in px."),
  width: z.number().optional().describe("Explicit bubble width in px. Overrides the measured text extent."),
  placement: placementSchema.optional().describe("Where the element sits: a region keyword ('center', 'lower-third', 'upper-third', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right') or normalized {x,y} (0-1 canvas fractions, element-center anchored). Default 'center'."),
})

export type CalloutSchemaProps = z.infer<typeof calloutSchema>
