//! Runtime prop schema for {@link Vignette} — @onda-native (mirrors VignetteProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const vignetteSchema = z.object({
  intensity: z.number().default(0.5).describe("Edge darkness. 0 = no vignette, 1 = fully dark edges."),
  innerRadius: z.number().default(40).describe("Percent (0..100) from center where the darkening begins; larger means a bigger clean middle."),
  color: z.string().optional().describe("Edge color; defaults to the theme background (typically black for a classic cinematic frame)."),
})

export type VignetteSchemaProps = z.infer<typeof vignetteSchema>
