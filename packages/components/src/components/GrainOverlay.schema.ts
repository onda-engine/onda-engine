//! Runtime prop schema for {@link GrainOverlay} — @onda-native (mirrors GrainOverlayProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const grainOverlaySchema = z.object({
  opacity: z.number().default(0.05).describe("Grain strength (peak luminance deviation), capped at 0.15 to match the house 2-15% range."),
  baseFrequency: z.number().default(0.9).describe("Grain fineness: higher = finer, tighter speckle; lower = coarser photo-grain."),
  numOctaves: z.number().default(1).describe("Grain contrast: widens the deviation so the texture gains punch, clamped to 1..4."),
  seed: z.number().default(0).describe("Deterministic variation \u2014 the same seed always produces the same grain field."),
  animate: z.boolean().default(false).describe("When true, the field re-seeds on a frame bucket so the grain shimmers; off by default (static set-dressing)."),
  animateEvery: z.number().default(2).describe("Frames per re-seed bucket when animate is on; lower = busier shimmer."),
  count: z.number().optional().describe("Deprecated and ignored \u2014 grain is now a continuous per-pixel field, not scattered dots; accepted for compat only."),
  color: z.string().optional().describe("Deprecated and ignored \u2014 grain is monochrome luminance noise (overlay-blended); accepted for compat only."),
})

export type GrainOverlaySchemaProps = z.infer<typeof grainOverlaySchema>
