//! Runtime prop schema for {@link Cursor} — @onda-native (mirrors CursorProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const cursorSchema = z.object({
  fromX: z.number().default(0.28).describe("Start X as a 0..1 fraction of canvas width."),
  fromY: z.number().default(0.72).describe("Start Y as a 0..1 fraction of canvas height."),
  toX: z.number().default(0.6).describe("End X as a 0..1 fraction of canvas width."),
  toY: z.number().default(0.42).describe("End Y as a 0..1 fraction of canvas height."),
  delay: timeSchema.default(6).describe("Frames before the cursor starts moving."),
  travelDuration: z.number().int().optional().describe("Frames to travel from start to end on the house spring."),
  click: z.boolean().default(true).describe("Emit a click ripple on arrival."),
  clickDelay: z.number().int().default(6).describe("Frames after arrival before the click fires."),
  color: z.string().optional().describe("Pointer + ripple color (hex #rrggbb / #rrggbbaa). Defaults to theme text."),
  size: z.number().default(56).describe("Pointer height in px."),
})

export type CursorSchemaProps = z.infer<typeof cursorSchema>
