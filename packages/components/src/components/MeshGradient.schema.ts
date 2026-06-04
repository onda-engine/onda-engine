//! Runtime prop schema for {@link MeshGradient} — @onda-native (mirrors MeshGradientProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const meshGradientSchema = z.object({
  colors: z.array(z.string()).optional().describe("Blob colors; 2-4 reads best, drifting over the background canvas (defaults to theme palette[0])."),
  background: z.string().optional().describe("Base canvas color behind the blobs (defaults to theme background)."),
  speed: z.number().default(1).describe("Drift speed multiplier; keep low since this is atmosphere, not motion."),
  seed: z.number().int().default(7).describe("Seed for the blob phase/amplitude offsets (deterministic)."),
  opacity: z.number().default(0.5).describe("Overall blob opacity over the canvas (0..1)."),
})

export type MeshGradientSchemaProps = z.infer<typeof meshGradientSchema>
