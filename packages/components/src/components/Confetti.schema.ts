//! Runtime prop schema for {@link Confetti} — @onda-native (mirrors ConfettiProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const confettiSchema = z.object({
  seed: z.number().int().default(7).describe("Seed for every per-piece random (angle, velocity, spin, color, size) \u2014 the same seed always produces the same burst."),
  count: z.number().int().default(80).describe("Number of confetti pieces; ~80 reads full without thrashing the render."),
  colors: z.array(z.string()).optional().describe("Palette pieces are picked from; defaults to the theme accent plus tasteful neutrals."),
  originX: z.number().default(0.5).describe("Burst origin X, as a fraction of canvas width (0 = left, 1 = right)."),
  originY: z.number().default(0.35).describe("Burst origin Y, as a fraction of canvas height (0 = top, 1 = bottom)."),
  delay: timeSchema.default(0).describe("Frames before the burst launches."),
  duration: timeSchema.default(70).describe("Frames over which a piece travels, tumbles and fades out."),
  spread: z.number().default(120).describe("Launch spread, in degrees, around straight up; wider = more fan-out."),
  gravity: z.number().default(1).describe("Downward acceleration; higher = pieces fall back faster."),
  pieceSize: z.number().default(12).describe("Base piece size in pixels \u2014 each piece varies around this."),
  variant: z.number().int().optional().describe("Integer 'take' selector: derives a new deterministic seed from (seed, variant), so alternates never require hand-edited seeds. 0/omitted = the default take."),
})

export type ConfettiSchemaProps = z.infer<typeof confettiSchema>
