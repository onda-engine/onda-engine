//! Runtime prop schema for {@link Button} — @onda-native (mirrors ButtonProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { placementSchema } from '../placement.js'

export const buttonSchema = z.object({
  label: z.string().default('Get started').describe("The button label."),
  variant: z.enum(['primary', 'ghost']).default('primary').describe("'primary' = filled with color; 'ghost' = transparent with a color border and color-tinted label."),
  color: z.string().optional().describe("Accent color \u2014 the primary fill and the ghost border/label tint (default: theme accent)."),
  textColor: z.string().optional().describe("Label color on the primary variant (default: theme text). Ignored by 'ghost', which tints the label with color."),
  width: z.number().default(280).describe("Pill width in px."),
  height: z.number().default(72).describe("Pill height in px."),
  cornerRadius: z.number().optional().describe("Corner radius in px (default: theme radius)."),
  borderWidth: z.number().default(2).describe("Border thickness in px for the 'ghost' variant."),
  fontSize: z.number().default(24).describe("Label font size in px."),
  fontFamily: z.string().optional().describe("Loaded font family (e.g. a --font passed to onda render) (default: theme fontFamily)."),
  fontWeight: z.number().default(600).describe("Label font weight (display default 600)."),
  centerX: z.number().default(0.5).describe("Horizontal center as a 0\u20131 fraction of canvas width (default 0.5 \u2014 centered)."),
  centerY: z.number().default(0.5).describe("Vertical center as a 0\u20131 fraction of canvas height (default 0.5)."),
  entrance: z.boolean().default(true).describe("Play the entrance (fade + rise on the house spring)."),
  delay: z.number().int().default(0).describe("Frames before the entrance begins."),
  durationInFrames: z.number().int().optional().describe("Entrance duration in frames (default DURATION.base = 18)."),
  press: z.boolean().default(true).describe("Play the click-dip press animation."),
  pressFrame: z.number().int().default(30).describe("Frame the press dip lands on (relative to the local timeline)."),
  placement: placementSchema.optional().describe("Where the element sits: a region keyword ('center', 'lower-third', 'upper-third', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right') or normalized {x,y} (0-1 canvas fractions, element-center anchored). Default 'center'."),
})

export type ButtonSchemaProps = z.infer<typeof buttonSchema>
