//! Runtime prop schema for {@link ThroughLine} — @onda-native (mirrors ThroughLineProps).
//! The Studio agent generates against this; the preview/export renderer validates with it.

import { z } from 'zod'
import { timeSchema } from '../time.js'

/** One stop on the through-line: where/what the hero shape becomes + the word it lands. */
export const throughBeatSchema = z.object({
  x: z.number().describe('Shape center X, as a fraction of canvas width (0..1).'),
  y: z.number().describe('Shape center Y, as a fraction of canvas height (0..1).'),
  w: z.number().describe('Shape width, fraction of canvas width (0..1).'),
  h: z.number().describe('Shape height, fraction of canvas height (0..1).'),
  radius: z
    .number()
    .optional()
    .describe('Corner radius 0..1 of the half-min-side (1 = full pill/ellipse). Default 1.'),
  title: z.string().optional().describe('Word/phrase that lands at this stop (supports \\n).'),
  textAt: z
    .enum(['in', 'above', 'below'])
    .optional()
    .describe('Where the title sits relative to the shape (default: in).'),
})

export const throughLineSchema = z.object({
  beats: z
    .any()
    .optional()
    .describe(
      'The ordered stops the hero shape flows through: array of { x, y, w, h, radius, title, textAt }. The shape continuously moves + reshapes between them (no cuts); a line traces the path.',
    ),
  accent: z.string().optional().describe('Accent for the tracing line + glow (default violet).'),
  background: z.string().optional().describe('Backdrop color (default Onda near-black).'),
  titleColor: z.string().optional().describe('Title color (default white).'),
  fontSize: z.number().optional().describe('Title font size in px (default ~0.07×canvas height).'),
  uppercase: z.boolean().default(false).describe('Uppercase the titles.'),
  showPath: z.boolean().default(true).describe('Draw the fine line tracing the shape’s journey.'),
  livingGradient: z
    .boolean()
    .default(true)
    .describe('Fill the hero shape with a smooth brand gradient (vs a flat accent).'),
  logoWordmark: z
    .string()
    .optional()
    .describe('Brand wordmark revealed at the end as the sign-off (the chip dissolves into it).'),
  logoSrc: z
    .string()
    .optional()
    .describe(
      'Brand logo image/SVG URL revealed at the end — ANY shape (takes precedence over wordmark).',
    ),
  holdFrames: timeSchema.default(42).describe('Frames the chip holds at each tagline word.'),
  morphFrames: timeSchema.default(22).describe('Frames each move+reshape between words takes.'),
  introFrames: timeSchema.default(16).describe('Frames the first shape scales/fades in.'),
  finishFrames: timeSchema
    .default(46)
    .describe('Frames of the chip-dissolves-into-logo finish (when a logo is set).'),
})

export type ThroughLineSchemaProps = z.infer<typeof throughLineSchema>
