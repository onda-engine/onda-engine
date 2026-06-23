//! Runtime prop schema for {@link BrandFlow} — @onda-native (mirrors BrandFlowProps).

import { z } from 'zod'
import { timeSchema } from '../time.js'

/** One beat: where the footage window flows to + the big word that lands. */
export const flowBeatSchema = z.object({
  x: z.number().describe('Window center X (0..1 of width).'),
  y: z.number().describe('Window center Y (0..1 of height).'),
  w: z.number().describe('Window width (0..1 of width).'),
  h: z.number().describe('Window height (0..1 of height).'),
  radius: z.number().optional().describe('Corner radius 0..1 (1 = pill/ellipse). Default 0.5.'),
  word: z.string().optional().describe('Big editorial word for this beat.'),
  wordAt: z
    .enum(['left', 'right', 'over'])
    .optional()
    .describe('Where the big word sits relative to the window (default: opposite side).'),
})

export const brandFlowSchema = z.object({
  videoSrc: z.string().optional().describe('Footage played inside the flowing window (URL).'),
  beats: z
    .any()
    .optional()
    .describe(
      'The stops the footage window flows through: array of { x, y, w, h, radius, word, wordAt }. The window continuously moves + reshapes while big type lands each beat.',
    ),
  headlineSize: z.number().optional().describe('Big word font size in px (default ~0.16×height).'),
  accent: z
    .string()
    .optional()
    .describe('Accent for the window edge + atmosphere (default violet).'),
  background: z.string().optional().describe('Base backdrop color (default near-black).'),
  glow: z.boolean().default(true).describe('Living radial-glow gradient background (atmosphere).'),
  vignette: z.number().default(0.5).describe('Vignette strength 0..1.'),
  titleColor: z.string().optional().describe('Word + logo color (default white).'),
  uppercase: z.boolean().default(true).describe('Uppercase the big words.'),
  logoWordmark: z.string().optional().describe('Wordmark revealed at the end (the sign-off).'),
  logoSrc: z.string().optional().describe('Logo image/SVG URL revealed at the end (any shape).'),
  holdFrames: timeSchema.default(40).describe('Frames the window holds at each beat.'),
  morphFrames: timeSchema.default(24).describe('Frames each move+reshape between beats takes.'),
  introFrames: timeSchema.default(20).describe('Frames the window + atmosphere fade in.'),
  finishFrames: timeSchema.default(50).describe('Frames of the window-dissolves-into-logo finish.'),
})

export type BrandFlowSchemaProps = z.infer<typeof brandFlowSchema>
