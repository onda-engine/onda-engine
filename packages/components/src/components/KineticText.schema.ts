//! Runtime prop schema for {@link KineticText} — @onda-native (mirrors KineticTextProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { placementSchema } from '../placement.js'
import { textStyleSchemaShape } from '../text-style.js'
import { timeSchema } from '../time.js'

export const kineticTextSchema = z.object({
  ...textStyleSchemaShape,
  text: z
    .string()
    .default('kinetic')
    .describe('The line to choreograph; laid out as one row of absolutely-placed glyphs.'),
  fontSize: z.number().default(96).describe('Font size in px.'),
  colors: z
    .array(z.string())
    .optional()
    .describe(
      'Optional per-glyph color palette. When set, glyph i is painted colors[i % colors.length] (cycling), overriding color — a multicolor wordmark from one editable string. Omit to paint the whole line one color.',
    ),
  preset: z
    .enum(['rise', 'fade', 'scale', 'blur', 'wave', 'scatter'])
    .default('rise')
    .describe(
      'Per-glyph entrance flavor. scatter = each glyph flies in from a random direction and tumbles upright (great for an editable kinetic wordmark).',
    ),
  stagger: timeSchema
    .default(5)
    .describe('Frames between consecutive glyphs entering (STAGGER = 5).'),
  durationInFrames: timeSchema
    .default(22)
    .describe("Frames each glyph's entrance takes to settle (DURATION.base = 22)."),
  delay: timeSchema.default(0).describe('Frames before the first glyph starts.'),
  exit: z
    .boolean()
    .optional()
    .describe(
      "scatter preset only: also scatter the glyphs back OUT (tumbling + fading) over the clip's final frames, so the line exits as kinetically as it entered. Default off (settle and hold).",
    ),
  exitDuration: timeSchema
    .optional()
    .describe("Length of the scatter-OUT when exit is on (frames or '0.5s'); default ~14f."),
  align: z
    .enum(['left', 'center', 'right'])
    .default('center')
    .describe('Horizontal alignment of the line about its anchor.'),
  placement: placementSchema
    .optional()
    .describe(
      "Where the element sits: a region keyword ('center', 'lower-third', 'upper-third', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right') or normalized {x,y} (0-1 canvas fractions, element-center anchored). Default 'center'.",
    ),
  fit: z
    .enum(['none', 'frame'])
    .optional()
    .describe(
      "Opt-in auto-fit: 'frame' scales the font size DOWN (never up) so the line cannot exceed the frame minus the safe margins. Default 'none'.",
    ),
  maxWidth: z
    .number()
    .optional()
    .describe('Explicit width cap in px for the line; combines with fit (the smaller cap wins).'),
  fitToClip: z
    .boolean()
    .optional()
    .describe(
      'Compress the whole timing envelope (delay, stagger, durations) so the entrance settles at least hold before the end of the enclosing clip. Opt-in.',
    ),
  maxSettle: timeSchema
    .optional()
    .describe("Hard cap on the settle time (frames or '0.5s'). Wins over fitToClip."),
  hold: timeSchema
    .optional()
    .describe('Breathing room before the cut for fitToClip (default 6 frames).'),
})

export type KineticTextSchemaProps = z.infer<typeof kineticTextSchema>
