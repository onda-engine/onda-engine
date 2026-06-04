//! Runtime prop schema for {@link KenBurns} — @onda-native (mirrors KenBurnsProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const kenBurnsSchema = z.object({
  src: z.string().describe("Image source, resolved at render time by `onda render`."),
  delay: z.number().int().default(0).describe("Frames before the drift starts."),
  duration: z.number().int().default(150).describe("Frames over which the zoom and pan completes (150f \u2248 5s @ 30fps)."),
  fromScale: z.number().default(1.0).describe("Starting scale atop the cover fit."),
  toScale: z.number().default(1.1).describe("Ending scale \u2014 keep the delta restrained (1.0 \u2192 1.1)."),
  fromX: z.number().default(0.5).describe("Starting pan origin X (0 = left, 1 = right)."),
  fromY: z.number().default(0.5).describe("Starting pan origin Y (0 = top, 1 = bottom)."),
  toX: z.number().default(0.5).describe("Ending pan origin X."),
  toY: z.number().default(0.5).describe("Ending pan origin Y."),
})

export type KenBurnsSchemaProps = z.infer<typeof kenBurnsSchema>
