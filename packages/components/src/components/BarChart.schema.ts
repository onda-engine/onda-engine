//! Runtime prop schema for {@link BarChart} — @onda-native (mirrors BarChartProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const barChartSchema = z.object({
  data: z.any().default([{ label: 'Remotion', value: 92 }, { label: 'After Effects', value: 64 }, { label: 'Lottie', value: 38 }]).describe("Bars to render as { label, value } objects. Order is preserved \u2014 top to bottom."),
  max: z.number().default(100).describe("Value mapped to a full-width bar. Bars cap at 100% of the track."),
  delay: z.number().int().default(0).describe("Frames before the first bar starts."),
  duration: z.number().int().optional().describe("Per-bar grow duration in frames. Bars want more time than text (default slow)."),
  stagger: z.number().int().optional().describe("Frames between consecutive bars (canonical STAGGER = 4)."),
  barHeight: z.number().default(32).describe("Bar (and track) height in px."),
  gap: z.number().default(16).describe("Pixel gap between rows."),
  labelWidth: z.number().default(220).describe("Pixels reserved for the label column (left of the track)."),
  labelGap: z.number().default(24).describe("Gap between the label column and the track, in px."),
  trackWidth: z.number().default(760).describe("Track length in px \u2014 the full-width target for a bar at max."),
  accentColor: z.string().optional().describe("Color of the largest bar \u2014 the earned accent. Defaults to theme.accent."),
  barColor: z.string().optional().describe("Color of non-largest bars. Defaults to theme.palette[0] (or theme.textMuted)."),
  trackColor: z.string().optional().describe("Bar track (background) color. Defaults to theme.surface."),
  color: z.string().optional().describe("Label and value text color. Defaults to theme.text."),
  showValues: z.boolean().default(false).describe("Show the numeric value at the end of each bar."),
  countUp: z.boolean().default(true).describe("Count each value up from 0 in sync with its bar's growth. Only applies when showValues is on."),
  title: z.string().optional().describe("Optional headline above the chart \u2014 tells viewers what the numbers measure."),
  titleSize: z.number().optional().describe("Title font size in px. Defaults to ~1.5x the label fontSize."),
  titleColor: z.string().optional().describe("Title color. Defaults to color."),
  fontSize: z.number().default(24).describe("Label / value font size in px."),
  fontFamily: z.string().optional().describe("Loaded font family for labels and values. Defaults to theme.fontFamily."),
})

export type BarChartSchemaProps = z.infer<typeof barChartSchema>
