//! Runtime prop schema for {@link PathMorph} — @onda-native (mirrors PathMorphProps).
//! The Studio agent generates against this; the preview/export renderer validates
//! with it. Edit the component + re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const pathMorphSchema = z.object({
  from: z
    .string()
    .describe('SVG path `d` to morph FROM (e.g. a logo emblem), in its own coordinate space.'),
  to: z.string().describe('SVG path `d` to morph TO (e.g. a divider line), in the SAME space.'),
  color: z
    .string()
    .optional()
    .describe('Ink (hex) — FILL for closed shapes, STROKE for open lines; defaults to theme `text`.'),
  stroke: z
    .boolean()
    .optional()
    .describe('Force STROKE (line) rendering; auto-true when both paths are OPEN (no `Z`).'),
  strokeWidth: z
    .number()
    .default(4)
    .describe('Stroke width in path-coordinate units (when stroked).'),
  delay: z.number().int().default(0).describe('Frames before the morph starts.'),
  durationInFrames: z
    .number()
    .int()
    .optional()
    .describe('Frames the morph takes (default `DURATION.slow` = 24).'),
  x: z.number().default(0).describe("Composition x of the morph's local origin."),
  y: z.number().default(0).describe("Composition y of the morph's local origin."),
  scale: z.number().default(1).describe("Uniform scale of the path's coordinate space."),
  fadeIn: z.boolean().default(true).describe('Fade the shape in over the first 8 frames.'),
})

export type PathMorphSchemaProps = z.infer<typeof pathMorphSchema>
