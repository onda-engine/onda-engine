//! Runtime prop schema for {@link SplitLockup} — @onda-native (mirrors SplitLockupProps).
//! The Studio agent generates against this; the preview/export renderer validates with it.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const splitLockupSchema = z.object({
  line1: z.string().default('NEW').describe('Top line of the lockup.'),
  line2: z.string().default('PROJECT').describe('Bottom line of the lockup.'),
  fontSize: z.number().default(200).describe('Font size in px.'),
  color: z.string().optional().describe('Ink color (hex); defaults to theme `text`.'),
  fontFamily: z.string().optional().describe('Font family; defaults to the theme heading family.'),
  fontWeight: z.number().default(500).describe('Font weight (this look wants regular ≈ 400).'),
  letterSpacing: z
    .number()
    .optional()
    .describe('Tracking in px — keep it generous (default fontSize × 0.04).'),
  splitX: z
    .number()
    .optional()
    .describe('How far each line pulls HORIZONTALLY to its corner, px from center.'),
  splitY: z
    .number()
    .optional()
    .describe('How far each line pulls VERTICALLY to its corner, px from center.'),
  lineGap: z
    .number()
    .optional()
    .describe('Vertical gap between the two stacked lines in the lockup (px).'),
  assembleFrames: timeSchema
    .optional()
    .describe('Duration of the assemble (split → center) move (default 0.7s).'),
  disassembleFrames: timeSchema
    .optional()
    .describe('Duration of the disassemble (center → split) move (default 0.5s).'),
  durationInFrames: timeSchema
    .optional()
    .describe('Total clip length; defaults to the enclosing Sequence duration.'),
})

export type SplitLockupSchemaProps = z.infer<typeof splitLockupSchema>
