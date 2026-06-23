//! Runtime prop schema for {@link MagicGallery} — @onda-native (mirrors MagicGalleryProps).

import { z } from 'zod'
import { timeSchema } from '../time.js'

/** One media tile that keeps its identity across every layout. */
export const galleryTileSchema = z.object({
  src: z
    .string()
    .optional()
    .describe('Photo/video URL filling the tile (cover-fit). Omit → gradient placeholder.'),
  video: z
    .boolean()
    .optional()
    .describe('Treat `src` as a looping video clip rather than a still image.'),
  gradient: z
    .any()
    .optional()
    .describe('Placeholder gradient [from, to] hex pair when there is no `src`.'),
})

/** One stop in the magic-move tour. */
export const magicBeatSchema = z.object({
  layout: z
    .enum(['grid', 'spotlight', 'hero', 'cover', 'row'])
    .describe(
      'Arrangement at this stop: grid (all equal), spotlight (focal big + strip), hero (focal left + column), cover (focal full-bleed), row (filmstrip).',
    ),
  focal: z
    .number()
    .optional()
    .describe('Which tile index is the hero this beat (default: rotates by beat).'),
  caption: z.string().optional().describe('Short kicker shown on a chip near the focal tile.'),
})

export const magicGallerySchema = z.object({
  media: z
    .any()
    .optional()
    .describe(
      'The tiles (keep identity across beats): array of { src, video, gradient }. Default: 5 gradient placeholders the user swaps for photos/videos.',
    ),
  beats: z
    .any()
    .optional()
    .describe(
      'The magic-move tour: array of { layout, focal, caption }. Tiles glide + rescale between consecutive layouts, never cut.',
    ),
  accent: z.string().optional().describe('Accent for tile edges + atmosphere (default violet).'),
  background: z.string().optional().describe('Base backdrop color (default near-black).'),
  glow: z.boolean().default(true).describe('Living fbm color-field + key-light atmosphere.'),
  vignette: z.number().default(0.55).describe('Vignette strength 0..1.'),
  titleColor: z.string().optional().describe('Caption color (default white).'),
  uppercase: z.boolean().default(true).describe('Uppercase the captions.'),
  cornerRadius: z
    .number()
    .default(0.1)
    .describe('Tile corner radius as a fraction of the tile shorter side (0..0.5).'),
  gap: z.number().default(0.024).describe('Gap between tiles, fraction of frame.'),
  holdFrames: timeSchema.default(30).describe('Frames each arrangement holds.'),
  morphFrames: timeSchema
    .default(26)
    .describe('Frames each magic-move between arrangements takes.'),
  introFrames: timeSchema.default(22).describe('Frames the gallery fades + scales in.'),
})

export type MagicGallerySchemaProps = z.infer<typeof magicGallerySchema>
