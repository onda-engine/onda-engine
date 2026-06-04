//! Runtime prop schema for {@link FadeIn} — @onda-native (mirrors FadeInProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const fadeInSchema = z.object({
  delay: z.number().default(0).describe("Frames to wait before starting the fade."),
  durationInFrames: z.number().optional().describe("Frames the fade takes to settle (default DURATION.base = 18)."),
})

export type FadeInSchemaProps = z.infer<typeof fadeInSchema>
