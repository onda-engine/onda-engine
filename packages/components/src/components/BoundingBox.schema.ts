//! Runtime prop schema for {@link BoundingBox} — @onda-native (mirrors BoundingBoxProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const boundingBoxSchema = z.object({
  x: z.number().default(0.3).describe("Box left edge as a 0..1 fraction of the composition width."),
  y: z.number().default(0.3).describe("Box top edge as a 0..1 fraction of the composition height."),
  width: z.number().default(0.4).describe("Box width as a 0..1 fraction of the composition width."),
  height: z.number().default(0.4).describe("Box height as a 0..1 fraction of the composition height."),
  label: z.string().default('').describe("Optional label tag pinned to the box's top-left corner; empty string hides it."),
  color: z.string().optional().describe("Outline, tick, and tag color; defaults to the theme accent."),
  delay: z.number().default(0).describe("Frames before the outline starts revealing."),
  drawDuration: z.number().optional().describe("Frames to reveal the full outline (default 24)."),
  strokeWidth: z.number().default(3).describe("Outline stroke width in px."),
  cornerRadius: z.number().default(0).describe("Corner rounding for the outline rectangle in px (sharp by default)."),
  labelColor: z.string().default('#08080a').describe("Label text color; a dark for contrast on the accent tag by default."),
  fontSize: z.number().default(16).describe("Label font size in px."),
  fontFamily: z.string().optional().describe("Label font family; defaults to the theme heading family."),
})

export type BoundingBoxSchemaProps = z.infer<typeof boundingBoxSchema>
