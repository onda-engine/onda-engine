//! Runtime prop schema for {@link Moodboard} — @onda-native (mirrors MoodboardProps).
//! The Studio agent generates against this; the preview/export renderer validates with it.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const moodboardSchema = z.object({
  images: z
    .array(z.string())
    .default([])
    .describe('Tile image sources — one tile per image, scattered around the title.'),
  seed: z.number().default(7).describe('Layout seed — same seed → same scatter (deterministic).'),
  columns: z.number().int().default(5).describe('Coarse grid columns the tiles snap to before jitter.'),
  rows: z.number().int().default(4).describe('Coarse grid rows.'),
  exclusionWidth: z
    .number()
    .default(0.46)
    .describe('Central exclusion width (fraction of canvas) where no tiles go — sized to the title.'),
  exclusionHeight: z
    .number()
    .default(0.4)
    .describe('Central exclusion height (fraction of canvas).'),
  stagger: timeSchema
    .default(3)
    .describe('Frames between successive tiles ENTERING — keep it visible.'),
  tileEnter: timeSchema.optional().describe('Per-tile entrance duration (default 0.5s).'),
  exitStagger: timeSchema.default(2).describe('Frames between successive tiles EXITING.'),
  tileExit: timeSchema.optional().describe('Per-tile exit duration (default 0.4s).'),
  durationInFrames: timeSchema
    .optional()
    .describe('Total clip length; defaults to the enclosing Sequence duration.'),
  scaleFrom: z.number().default(1).describe('Entrance start scale (1 = fade + slide, no scale).'),
  driftPx: z.number().default(44).describe('Entrance drift distance in px (tiles rise into place).'),
  cornerRadius: z.number().default(16).describe('Rounded-corner radius for each tile in px.'),
  jitter: z.number().default(0.12).describe('Position jitter as a fraction of the cell.'),
  aspects: z
    .array(z.number())
    .optional()
    .describe('Tile aspect-ratio pool (w/h) the scatter draws from (default landscape + square).'),
})

export type MoodboardSchemaProps = z.infer<typeof moodboardSchema>
