//! Runtime prop schema for {@link GradientShift} — @onda-native (mirrors GradientShiftProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const gradientShiftSchema = z.object({
  from: z.string().optional().describe("Gradient start color (`#rrggbb` / `#rrggbbaa`); the meaningful first stop. Defaults to theme `background`."),
  to: z.string().optional().describe("Gradient end color, intentionally near-identical to `from` so the shift is a whisper. Defaults to theme `surface`."),
  angle: z.number().default(135).describe("Starting gradient angle in degrees (CSS convention: `0deg` points up, increasing clockwise)."),
  speed: z.number().default(0.5).describe("Rotation rate in degrees per frame; keep low \u2014 atmospheric, not focal (0.5 is a 24s full rotation at 30fps)."),
  delay: timeSchema.default(0).describe("Frames before the drift starts; while `frame < delay` the gradient sits at `angle`."),
})

export type GradientShiftSchemaProps = z.infer<typeof gradientShiftSchema>
