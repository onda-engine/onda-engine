//! Runtime prop schema for {@link SlotMachineRoll} — @onda-native (mirrors SlotMachineRollProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { placementSchema } from '../placement.js'
import { textStyleSchemaShape } from '../text-style.js'
import { timeSchema } from '../time.js'

export const slotMachineRollSchema = z.object({
  ...textStyleSchemaShape,
  text: z
    .string()
    .default('2026')
    .describe('The text that rolls into place. Best on short strings (years, counts).'),
  delay: timeSchema.default(0).describe('Frames before rolling starts.'),
  charDelay: timeSchema
    .default(5)
    .describe(
      'Frames between successive characters starting their roll (default the house STAGGER = 5 - a settled, orchestrated wave left-to-right).',
    ),
  durationInFrames: timeSchema
    .optional()
    .describe(
      "Frames for each character's reel to settle (default DURATION.slower = 34 - a slow, hard-decelerating odometer drop, not a constant-velocity spin).",
    ),
  reelLength: z
    .number()
    .int()
    .default(12)
    .describe('How many filler glyphs spin past before the target lands.'),
  seed: z.number().int().default(7).describe('Seed for the (deterministic) filler glyphs.'),
  charset: z.string().default('0123456789').describe('Glyph pool the reel spins through.'),
  fontSize: z
    .number()
    .default(140)
    .describe('Font size in px (default 140). The cell height equals this.'),
  glow: z
    .boolean()
    .default(false)
    .describe(
      'Render a soft radial accent bloom behind the landed row as the reels settle — a true falloff to transparent, not a solid wash. Default false (off).',
    ),
  align: z
    .enum(['left', 'center', 'right'])
    .default('center')
    .describe("Horizontal anchoring of the whole block (default 'center')."),
  x: z
    .number()
    .optional()
    .describe(
      "Absolute x of the block's anchor. Defaults to the canvas horizontal center (respecting align).",
    ),
  y: z
    .number()
    .optional()
    .describe("Absolute y of the block's top. Defaults to vertically centering the row."),
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
  variant: z
    .number()
    .int()
    .optional()
    .describe(
      "Integer 'take' selector: derives a new deterministic seed from (seed, variant), so alternates never require hand-edited seeds. 0/omitted = the default take.",
    ),
})

export type SlotMachineRollSchemaProps = z.infer<typeof slotMachineRollSchema>
