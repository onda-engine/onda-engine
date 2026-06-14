//! Runtime prop schema for {@link LogoSting} — @onda-native (mirrors LogoStingProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { textStyleSchemaShape } from '../text-style.js'
import { timeSchema } from '../time.js'

export const logoStingSchema = z.object({
  ...textStyleSchemaShape,
  d: z
    .string()
    .default('M 50 60 Q 100 20 150 60 T 250 60')
    .describe('SVG path `d` for the logo mark, in viewBox coordinate space.'),
  title: z.string().default('Onda').describe('The brand / product title beneath the mark.'),
  delay: timeSchema.default(0).describe('Frames before the sting starts.'),
  accent: z
    .boolean()
    .default(true)
    .describe('Draw the accent rule beneath the title (the single earned-color moment).'),
  viewBox: z
    .string()
    .default('0 0 300 120')
    .describe('SVG viewBox "minX minY width height" \u2014 must match the space of `d`.'),
  pathWidth: z.number().default(400).describe('Rendered width of the mark in px.'),
  pathHeight: z.number().default(160).describe('Rendered height of the mark in px.'),
  strokeWidth: z
    .number()
    .default(3)
    .describe('Stroke width in px (after the viewBox-to-pixel scale).'),
  stroke: z.string().optional().describe('Logo stroke color (defaults to theme `text`).'),
  accentColor: z
    .string()
    .optional()
    .describe(
      'Underline accent color \u2014 the signature dusty rose (defaults to theme `accent`).',
    ),
  titleFontSize: z.number().default(96).describe('Title font size in px.'),
})

export type LogoStingSchemaProps = z.infer<typeof logoStingSchema>
