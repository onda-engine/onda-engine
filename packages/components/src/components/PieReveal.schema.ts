//! Runtime prop schema for {@link PieReveal} — @onda-native (mirrors PieRevealProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const pieRevealSchema = z.object({
  data: z
    .any()
    .default([
      { value: 64, color: '#d96b82', label: 'A' },
      { value: 22, color: '#8e8e98', label: 'B' },
      { value: 14, color: '#3a3a44', label: 'C' },
    ])
    .describe(
      "Slices to render, each `{ value, color, label? }`, drawn clockwise from 12 o'clock in array order; values split the circle proportionally.",
    ),
  radius: z.number().default(180).describe('Outer radius of the pie, in px.'),
  innerRadius: z
    .number()
    .default(0)
    .describe(
      'Inner radius (donut hole) in px; `0` is a solid pie. The hole is filled with holeColor.',
    ),
  holeColor: z
    .string()
    .optional()
    .describe(
      'Color filling the donut hole; match the composition background (default: theme `background`).',
    ),
  delay: timeSchema.default(0).describe('Frames before the first slice starts sweeping.'),
  duration: timeSchema
    .optional()
    .describe('Per-slice sweep duration on the house spring, in frames.'),
  stagger: timeSchema
    .optional()
    .describe('Frames between consecutive slices starting (default canonical STAGGER).'),
  x: z.number().default(0.5).describe('Horizontal center as a 0\u20131 fraction of canvas width.'),
  y: z.number().default(0.5).describe('Vertical center as a 0\u20131 fraction of canvas height.'),
  showLabel: z
    .boolean()
    .default(false)
    .describe(
      "Show labels: the center total (donut only) plus each slice's `label` drawn just outside the ring.",
    ),
  label: z.string().optional().describe('Center label text; defaults to the slice count.'),
  labelColor: z.string().optional().describe('Center label color (default: theme `text`).'),
  fontSize: z.number().default(56).describe('Center label font size in px.'),
  fontFamily: z
    .string()
    .optional()
    .describe(
      'Center label font family, must be loaded by the renderer (default: theme `headingFamily ?? fontFamily`).',
    ),
})

export type PieRevealSchemaProps = z.infer<typeof pieRevealSchema>
