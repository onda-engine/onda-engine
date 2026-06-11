//! Runtime prop schema for {@link ProductWall} — @onda-native (mirrors ProductWallProps).

import { z } from 'zod'

export const productWallSchema = z.object({
  images: z
    .array(z.string())
    .default([])
    .describe('Product photo sources (resolved at render time by `onda render`).'),
  spans: z
    .array(z.tuple([z.number(), z.number()]))
    .optional()
    .describe(
      'Per-image [colSpan, rowSpan] for the bento rhythm; cycled if shorter than images. Omit for a uniform 1×1 grid.',
    ),
  columns: z.number().int().default(4).describe('Grid columns.'),
  gap: z.number().default(16).describe('Gap between tiles in px.'),
  width: z.number().default(1680).describe('Overall grid width in px.'),
  rowHeight: z
    .number()
    .optional()
    .describe('Row-track height in px (defaults to the column-track width ≈ square tiles).'),
  delay: z.number().int().default(0).describe('Frames before the first tile enters.'),
  stagger: z.number().int().default(4).describe('Frames between successive tiles rising in.'),
  borderColor: z.string().optional().describe('Tile hairline border color (defaults to theme border).'),
  borderWidth: z.number().default(0).describe('Tile hairline border width in px (0 = no border).'),
  scrim: z.number().default(0).describe('Dark veil over every tile, 0..1, to unify a mixed set (0 = off).'),
  cameraFrom: z.number().default(1.06).describe('Camera scale at the start of the move.'),
  cameraTo: z.number().default(1.18).describe('Camera scale at the end (keep the delta gentle).'),
  cameraDriftX: z.number().default(-44).describe('Horizontal camera drift in px across the move.'),
  cameraDriftY: z.number().default(26).describe('Vertical camera drift in px across the move.'),
  cameraDurationInFrames: z
    .number()
    .int()
    .default(150)
    .describe('Frames over which the camera completes its push + drift.'),
})

export type ProductWallSchemaProps = z.infer<typeof productWallSchema>
