//! Runtime prop schema for {@link VideoClip} — @onda-native (mirrors VideoClipProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const videoClipSchema = z.object({
  src: z
    .string()
    .describe(
      'URL or path to the video, decoded per composition frame by the player or onda export.',
    ),
  startAt: z
    .number()
    .default(0)
    .describe("Seconds into the source shown at the clip's frame 0 (trims the head)."),
  playbackRate: z
    .number()
    .default(1)
    .describe('Source seconds advanced per composition second (1 = realtime).'),
  endAt: z
    .number()
    .optional()
    .describe(
      "Seconds into the source to stop at (trims the tail); omit to play to the source's end.",
    ),
  loop: z
    .boolean()
    .optional()
    .describe('Loop the trimmed span [startAt, endAt) (requires endAt) while the clip is visible.'),
  previewFallback: z
    .enum(['skip', 'element'])
    .optional()
    .describe(
      "Preview-only handling of a source the player can't composite: 'skip' blanks it, 'element' overlays a plain video.",
    ),
  delay: timeSchema.default(0).describe('Frames the clip waits before its fade-in begins.'),
  fadeIn: z.number().int().optional().describe('Frames the fade-in takes (0 = hard cut in).'),
  fadeOut: z.number().int().optional().describe('Frames the fade-out takes (0 = hard cut out).'),
  durationInFrames: timeSchema
    .optional()
    .describe(
      'Visible hold of the clip in frames, used to time the fade-out; omit to skip the fade-out.',
    ),
  fit: z
    .enum(['cover', 'contain'])
    .default('cover')
    .describe(
      "How the frame fits its box: 'cover' crops to fill, 'contain' letterboxes against black.",
    ),
  width: z
    .number()
    .optional()
    .describe('Box width in px the clip occupies (default = full composition width).'),
  height: z
    .number()
    .optional()
    .describe('Box height in px the clip occupies (default = full composition height).'),
  x: z.number().default(0).describe('Top-left x of the box in px.'),
  y: z.number().default(0).describe('Top-left y of the box in px.'),
  borderRadius: z
    .number()
    .optional()
    .describe('Rounded corner radius of the box in px (defaults to theme radius).'),
  letterbox: z
    .number()
    .default(0)
    .describe('Cinematic black letterbox bars top & bottom, each this many px tall (0 = none).'),
  backgroundColor: z
    .string()
    .optional()
    .describe('Backing color shown behind/around the poster (defaults to theme background).'),
})

export type VideoClipSchemaProps = z.infer<typeof videoClipSchema>
