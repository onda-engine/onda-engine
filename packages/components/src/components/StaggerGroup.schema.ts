//! Runtime prop schema for {@link StaggerGroup} — @onda-native (mirrors StaggerGroupProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const staggerGroupSchema = z.object({
  items: z.array(z.string()).default(['Less is more', 'Calm is power', 'Motion has a feel', 'Made to be edited']).describe("The items to reveal, in source order."),
  delay: z.number().int().default(0).describe("Frames before the first item starts."),
  stagger: z.number().int().optional().describe("Frames between consecutive items; canonical Onda stagger is 4."),
  duration: z.number().int().optional().describe("Per-item reveal duration in frames."),
  direction: z.enum(['row', 'column']).default('column').describe("Layout direction for the items."),
  gap: z.number().default(16).describe("Pixels between items."),
  align: z.enum(['start', 'center', 'end']).default('center').describe("Cross-axis alignment of items."),
  color: z.string().optional().describe("Text color; defaults to theme text."),
  fontSize: z.number().default(48).describe("Font size in px."),
  fontFamily: z.string().optional().describe("Loaded font family; defaults to theme fontFamily."),
  fontWeight: z.number().default(600).describe("Font weight; display default 600."),
})

export type StaggerGroupSchemaProps = z.infer<typeof staggerGroupSchema>
