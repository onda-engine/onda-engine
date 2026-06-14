//! Runtime prop schema for {@link WordStagger} — @onda-native (mirrors WordStaggerProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { textStyleSchemaShape } from '../text-style.js'
import { timeSchema } from '../time.js'

export const wordStaggerSchema = z.object({
  ...textStyleSchemaShape,
  text: z
    .string()
    .default('motion that moves you')
    .describe('The phrase; split on whitespace into one reveal per word.'),
  fontSize: z.number().default(64).describe('Font size in px.'),
  width: z.number().default(1080).describe('Container width in px; the line wraps within this.'),
  justify: z
    .enum(['start', 'center', 'end'])
    .default('start')
    .describe('Horizontal alignment of words within each line.'),
  delay: timeSchema.default(0).describe('Frames before the first word starts.'),
  stagger: timeSchema
    .optional()
    .describe('Frames between consecutive words (defaults to STAGGER = 4).'),
})

export type WordStaggerSchemaProps = z.infer<typeof wordStaggerSchema>
