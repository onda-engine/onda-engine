//! Runtime prop schema for {@link AudioVisualizer} — @onda-native (mirrors AudioVisualizerProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const audioVisualizerSchema = z.object({
  type: z.enum(['bars', 'mirrored', 'waveform', 'radial', 'dots']).default('bars').describe("Render style: classic bars, mirrored EQ, smooth waveform ribbon, radial spectrum, or LED dot-matrix meter."),
  src: z.string().optional().describe("Audio file URL to drive the bars with real FFT frequency data; omit for the built-in procedural animation."),
  barCount: z.number().int().default(48).describe("Number of frequency bands."),
  color: z.any().optional().describe("Bar color: a single hex string for one tone, or a [top, bottom] array for a vertical gradient ramp (defaults to theme accent + palette[1])."),
  width: z.number().default(640).describe("Overall width of the visualizer, in px."),
  height: z.number().default(160).describe("Overall height of the visualizer (the tallest a band can reach), in px."),
  align: z.enum(['top', 'middle', 'bottom']).default('middle').describe("Vertical placement of the bars within height (bars style only)."),
  gap: z.number().default(4).describe("Pixel gap between adjacent bars."),
  barRadius: z.number().optional().describe("Bar corner radius in px (also the minimum bar height so idle bars read); defaults to theme radius."),
  speed: z.number().default(1).describe("Animation speed multiplier for the procedural spectrum's drift."),
  seed: z.any().default(1).describe("Deterministic seed (number or string) for the procedural spectrum."),
  delay: z.number().int().default(0).describe("Frames before the visualizer fades/grows in."),
  durationInFrames: z.number().int().optional().describe("Frames for the entrance grow-in."),
})

export type AudioVisualizerSchemaProps = z.infer<typeof audioVisualizerSchema>
