//! Runtime prop schema for {@link CameraShake} — @onda-native (mirrors CameraShakeProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const cameraShakeSchema = z.object({
  delay: timeSchema.default(0).describe("Frames before the shake starts; outside the window the offset is 0."),
  duration: timeSchema.optional().describe("Frames the shake lasts; before delay and after delay + duration the offset is exactly 0."),
  intensity: z.number().default(4).describe("Maximum positional offset in px; restrained by default, bump for impact moments."),
  rotationIntensity: z.number().default(0.6).describe("Maximum rotation amplitude in degrees (GPU/Vello only); set 0 for pure translational shake."),
  seed: z.number().default(0).describe("PRNG seed \u2014 the same seed always produces the same deterministic shake."),
  decay: z.boolean().default(true).describe("Linearly decay intensity and rotation to 0 over duration so the camera settles to rest by the end."),
  x: z.number().default(0).describe("Rest x offset of the wrapper in px relative to center; the shake jitters around this."),
  y: z.number().default(0).describe("Rest y offset of the wrapper in px relative to center; the shake jitters around this."),
  variant: z.number().int().optional().describe("Integer 'take' selector: derives a new deterministic seed from (seed, variant), so alternates never require hand-edited seeds. 0/omitted = the default take."),
})

export type CameraShakeSchemaProps = z.infer<typeof cameraShakeSchema>
