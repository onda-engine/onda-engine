//! Runtime prop schema for {@link Parallax} — @onda-native (mirrors ParallaxProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const parallaxSchema = z.object({
  src: z.string().optional().describe("Single image layer URL/path; use src OR layers (layers wins when both are set)."),
  layers: z.any().optional().describe("Multiple layers drawn back-to-front, each with its own src, speed, scale, and opacity, drifting at its own rate."),
  delay: z.number().int().default(0).describe("Frames before the drift starts."),
  duration: z.number().int().default(180).describe("Frames over which the drift completes (180f is about 6s at 30fps)."),
  direction: z.enum(['left', 'right', 'up', 'down']).default('left').describe("The edge the layers drift toward as time advances."),
  distance: z.number().default(40).describe("Base drift in pixels across duration, per-layer scaled by speed; keep restrained (past ~120px reads as a pan)."),
  scale: z.number().default(1.05).describe("Default oversize applied to layers that don't set their own scale, hiding drifting edges."),
})

export type ParallaxSchemaProps = z.infer<typeof parallaxSchema>
