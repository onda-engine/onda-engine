//! Runtime prop schema for {@link AudioClip} — @onda-native (mirrors AudioClipProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const audioClipSchema = z.object({
  src: z
    .string()
    .default('https://www.w3schools.com/html/horse.mp3')
    .describe('URL or path to the audio file. AAC-in-MP4 or WAV preferred.'),
  startAt: z
    .any()
    .default(0)
    .describe(
      'Where to start in the source audio. Time spec \u2014 "0:04", "30s", "500ms", "90f", or a raw number of seconds.',
    ),
  endAt: z
    .any()
    .optional()
    .describe(
      "Where to stop in the source (same time spec as startAt). When omitted, plays to the source's end; required for loop.",
    ),
  volume: z.number().default(1).describe('Amplitude volume 0..1.'),
  gainDb: z
    .number()
    .optional()
    .describe(
      'Advanced gain in dB. When set, wins over volume. Converted via 10 ** (dB / 20): 0 = unity, -6 \u2248 0.5, -20 \u2248 0.1.',
    ),
  fade: z
    .boolean()
    .optional()
    .describe(
      'Apply an entry/exit volume envelope (default true). Accepted for API parity; not yet applied in preview.',
    ),
  fadeDuration: timeSchema
    .optional()
    .describe('Frames the fade-in / fade-out takes. Default 2 (~67ms @ 30fps).'),
  loop: z
    .boolean()
    .optional()
    .describe('Loop the trimmed clip. Requires endAt. Not yet applied in preview.'),
  muted: z.boolean().default(false).describe('Mute the clip.'),
  playbackRate: z.number().optional().describe('Playback speed. Not yet applied in preview.'),
  acceptableTimeShiftSeconds: z
    .number()
    .optional()
    .describe('Acceptable time-shift threshold before resync (seconds).'),
})

export type AudioClipSchemaProps = z.infer<typeof audioClipSchema>
