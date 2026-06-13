//! Runtime prop schema for {@link BrowserFrame} — @onda-native (mirrors BrowserFrameProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const browserFrameSchema = z.object({
  url: z
    .string()
    .default('onda.video')
    .describe('URL shown in the address pill (and as the placeholder when empty).'),
  src: z
    .string()
    .optional()
    .describe(
      'Image to show inside the frame when no children are passed; scaled to fill the content width.',
    ),
  delay: timeSchema.default(0).describe('Frames before the entrance.'),
  animate: z.boolean().default(true).describe('Scale-and-fade the frame in on the house spring.'),
  width: z.number().default(1280).describe('Frame (and content) width in px.'),
  height: z.number().default(720).describe('Content height in px (excludes the chrome bar).'),
  from: z
    .number()
    .default(0.96)
    .describe('Starting scale for the entrance (restrained, like ondajs).'),
  surface: z.string().optional().describe('Card body fill (default: theme surface).'),
  border: z
    .string()
    .optional()
    .describe('1px card border and chrome divider color (default: theme border).'),
  borderLit: z.string().optional().describe('Traffic-light dot color (default: theme border).'),
  surface2: z.string().optional().describe('Address-pill fill (default: theme surface).'),
  bg: z.string().optional().describe('Content canvas background (default: theme background).'),
  dim: z.string().optional().describe('Pill/URL text color (default: theme textMuted).'),
  faint: z.string().optional().describe('Placeholder text color (default: theme textMuted).'),
  cardRadius: z.number().optional().describe('Card corner radius in px (default: theme radius).'),
  pillRadius: z
    .number()
    .optional()
    .describe('Address-pill corner radius in px (default: theme radius).'),
})

export type BrowserFrameSchemaProps = z.infer<typeof browserFrameSchema>
