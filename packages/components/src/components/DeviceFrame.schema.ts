//! Runtime prop schema for {@link DeviceFrame} — @onda-native (mirrors DeviceFrameProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const deviceFrameSchema = z.object({
  device: z.enum(['phone', 'laptop']).default('phone').describe('Which device bezel to draw.'),
  src: z
    .string()
    .optional()
    .describe(
      'Image src shown inside when no children are passed (use the literal "DEMO_IMAGE" token in demos).',
    ),
  delay: timeSchema.default(0).describe('Frames before the entrance begins.'),
  animate: z.boolean().default(true).describe('Scale-and-fade the device in on the house spring.'),
  width: z
    .number()
    .default(420)
    .describe(
      'Device width in px (height is derived from the device aspect; shrunk to fit the canvas height).',
    ),
  color: z
    .string()
    .optional()
    .describe('Bezel color (hex #rrggbb / #rrggbbaa); defaults to theme surface.'),
  glass: z
    .boolean()
    .default(false)
    .describe(
      'Render the device as frosted GLASS — a real backdrop-blur translucent bezel + screen (blurring what is behind it) instead of an opaque bezel fill.',
    ),
  glassTint: z
    .string()
    .optional()
    .describe('Frosted tint (hex #rrggbbaa) when glass; defaults to a translucent surface.'),
})

export type DeviceFrameSchemaProps = z.infer<typeof deviceFrameSchema>
