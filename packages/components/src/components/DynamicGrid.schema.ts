//! Runtime prop schema for {@link DynamicGrid} — @onda-native (mirrors DynamicGridProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const dynamicGridSchema = z.object({
  cell: z.number().int().default(48).describe('Cell size in px (the lattice pitch).'),
  variant: z.enum(['lines', 'dots']).default('lines').describe('Ruled lines or a dot lattice.'),
  color: z
    .string()
    .optional()
    .describe('Grid color (hex #rrggbb / #rrggbbaa); defaults to theme border.'),
  speed: z
    .number()
    .default(0.4)
    .describe('Diagonal drift speed in px/frame; negative drifts the other way.'),
  opacity: z
    .number()
    .default(0.6)
    .describe('Grid opacity, 0..1 \u2014 a grid is scaffold, not subject.'),
  glow: z.boolean().default(true).describe('Add a centered accent glow over the grid.'),
  glowColor: z
    .string()
    .optional()
    .describe(
      'Glow color (hex); the meaningful color on the CPU fallback (first stop); defaults to theme accent.',
    ),
  background: z
    .string()
    .optional()
    .describe('Canvas color painted behind the grid; defaults to theme background.'),
  thickness: z.number().default(1).describe('Stroke thickness (lines) / dot radius in px (dots).'),
})

export type DynamicGridSchemaProps = z.infer<typeof dynamicGridSchema>
