//! Runtime prop schema for {@link SlotMachineRoll} — @onda-native (mirrors SlotMachineRollProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const slotMachineRollSchema = z.object({
  text: z.string().default('2026').describe("The text that rolls into place. Best on short strings (years, counts)."),
  delay: z.number().int().default(0).describe("Frames before rolling starts."),
  charDelay: z.number().int().default(4).describe("Frames between successive characters starting their roll."),
  durationInFrames: z.number().int().optional().describe("Frames for each character's reel to settle (default DURATION.slow = 24)."),
  reelLength: z.number().int().default(12).describe("How many filler glyphs spin past before the target lands."),
  seed: z.number().int().default(7).describe("Seed for the (deterministic) filler glyphs."),
  charset: z.string().default('0123456789').describe("Glyph pool the reel spins through."),
  color: z.string().optional().describe("Text color (default: theme text)."),
  fontSize: z.number().default(140).describe("Font size in px (default 140). The cell height equals this."),
  fontFamily: z.string().optional().describe("Monospace/display stack keeps reels column-aligned (default: theme fontFamily)."),
  fontWeight: z.number().default(600).describe("Font weight (default 600)."),
  italic: z.boolean().default(false).describe("Italic glyphs."),
  align: z.enum(['left', 'center', 'right']).default('center').describe("Horizontal anchoring of the whole block (default 'center')."),
  x: z.number().optional().describe("Absolute x of the block's anchor. Defaults to the canvas horizontal center (respecting align)."),
  y: z.number().optional().describe("Absolute y of the block's top. Defaults to vertically centering the row."),
})

export type SlotMachineRollSchemaProps = z.infer<typeof slotMachineRollSchema>
