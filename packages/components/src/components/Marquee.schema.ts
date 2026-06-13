//! Runtime prop schema for {@link Marquee} — @onda-native (mirrors MarqueeProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const marqueeSchema = z.object({
  items: z
    .array(z.string())
    .default(['ONDA', 'TYPESCRIPT', 'REACT'])
    .describe('Items to scroll; the list is repeated as needed for a seamless wrap.'),
  speed: z
    .number()
    .default(30)
    .describe('Scroll speed in pixels per second; keep low for restraint.'),
  direction: z.enum(['left', 'right']).default('left').describe('Scroll direction.'),
  gap: z.number().default(64).describe('Pixels between items.'),
  color: z.string().optional().describe('Text color; defaults to the theme textMuted token.'),
  fontSize: z.number().default(32).describe('Font size in pixels.'),
  fontFamily: z
    .string()
    .optional()
    .describe('Loaded font family; defaults to the theme fontFamily token.'),
  fontWeight: z.number().default(500).describe('CSS font weight, 1 to 1000.'),
  width: z
    .number()
    .optional()
    .describe('Viewport width to scroll within; defaults to the full composition width.'),
  height: z
    .number()
    .optional()
    .describe('Viewport height (the clip band); defaults to the full composition height.'),
})

export type MarqueeSchemaProps = z.infer<typeof marqueeSchema>
