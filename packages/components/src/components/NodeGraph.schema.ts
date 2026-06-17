//! Runtime prop schema for {@link NodeGraph} — @onda-native (mirrors NodeGraphProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { textStyleSchemaShape } from '../text-style.js'
import { timeSchema } from '../time.js'

export const nodeGraphSchema = z.object({
  ...textStyleSchemaShape,
  hubLabel: z
    .string()
    .default('AI')
    .describe('Label inside the central hub node \u2014 a single character or short word.'),
  satellites: z
    .any()
    .optional()
    .describe(
      'The orbiting satellites; each ({ label, radius, speed, startAngle }) flies in from off-frame, then settles into its elliptical orbit.',
    ),
  accent: z
    .string()
    .optional()
    .describe(
      'The earned accent \u2014 hub fill tint, the connection lines, and the glow (default: theme accent).',
    ),
  ellipse: z
    .number()
    .default(0.92)
    .describe('Vertical squash of every orbit (1 = circular, <1 = elliptical).'),
  seed: z
    .number()
    .default(7)
    .describe('Seed for the deterministic fly-in directions and connection-pulse phases.'),
  delay: timeSchema.default(0).describe('Frames before the constellation begins assembling.'),
  glow: z.boolean().default(true).describe('Show the soft accent glow behind the hub.'),
  hubDiameter: z.number().default(120).describe('Hub node diameter in px.'),
  hubFontSize: z.number().default(34).describe('Hub label size in px.'),
  background: z
    .string()
    .optional()
    .describe('Background canvas color behind the constellation (default: theme background).'),
  surface: z
    .string()
    .optional()
    .describe('Surface (fill) color of the satellite pills (default: theme surface).'),
  borderColor: z
    .string()
    .optional()
    .describe('Border color of the satellite pills (default: theme border).'),
  textColor: z.string().optional().describe('Text color of every label (default: theme text).'),
  satelliteFontSize: z.number().default(20).describe('Satellite label font size in px.'),
  centerX: z
    .number()
    .default(0.5)
    .describe('Horizontal center of the constellation as a 0\u20131 fraction of canvas width.'),
  centerY: z
    .number()
    .default(0.5)
    .describe('Vertical center of the constellation as a 0\u20131 fraction of canvas height.'),
  variant: z
    .number()
    .int()
    .optional()
    .describe(
      "Integer 'take' selector: derives a new deterministic seed from (seed, variant), so alternates never require hand-edited seeds. 0/omitted = the default take.",
    ),
})

export type NodeGraphSchemaProps = z.infer<typeof nodeGraphSchema>
