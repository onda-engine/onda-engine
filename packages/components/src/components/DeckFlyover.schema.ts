//! Runtime prop schema for {@link DeckFlyover} — @onda-native (mirrors DeckFlyoverProps).
//! The Studio agent generates against this and the preview/export renderer validates
//! with it. Edit the component + re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { textStyleSchemaShape } from '../text-style.js'
import { timeSchema } from '../time.js'

/** One presentation slide on the board. `kind` drives the slide layout. */
export const deckSlideSchema = z.object({
  kind: z
    .enum(['title', 'features', 'bullets', 'agenda', 'quote', 'stats', 'contact', 'cover'])
    .optional()
    .describe(
      'Slide layout: title (logo + headline + subtitle over a liquid gradient — the hero), features (centered title + a grid of cards), bullets (title + a checked list), agenda (numbered index list), quote (big pull-quote + attribution), stats (big figures + labels), contact (headline + body over a glow), cover (a full-bleed `image` with an optional title/label caption — no chrome; for an all-image portfolio flythrough).',
    ),
  dark: z
    .boolean()
    .optional()
    .describe('Render this slide dark (navy) instead of light/white. Title + contact default dark.'),
  eyebrow: z.string().optional().describe('Small kicker above the slide title.'),
  title: z.string().optional().describe('Slide title / headline (supports \\n line breaks).'),
  subtitle: z.string().optional().describe('Sub-line under a title-slide or features headline.'),
  tag: z.string().optional().describe('Small label on the right of a title slide (e.g. a partner mark).'),
  body: z.string().optional().describe('Paragraph for a quote / contact slide (word-wrapped).'),
  label: z.string().optional().describe('Quote attribution, or the contact-slide CTA text.'),
  bullets: z.any().optional().describe('string[] — list rows for a bullets / agenda slide.'),
  items: z
    .any()
    .optional()
    .describe('Feature cards for a features slide: array of { title, body? }.'),
  stats: z.any().optional().describe('Stat figures for a stats slide: array of { value, label }.'),
  image: z
    .string()
    .optional()
    .describe(
      'Background image URL for this slide — fills it (replacing the gradient/flat surface); a dark scrim keeps text legible. The user/agent swaps this to brand a slide with a photo.',
    ),
  colSpan: z.number().int().optional().describe('Columns this slide spans (default 1).'),
  rowSpan: z.number().int().optional().describe('Rows this slide spans (default 1).'),
})

export const deckFlyoverSchema = z.object({
  ...textStyleSchemaShape,
  slides: z
    .any()
    .optional()
    .describe(
      'The presentation slides, laid out left-to-right, top-to-bottom on a board. The camera opens on the whole board, punches into the `heroIndex` slide, holds, pulls back, then pans across.',
    ),
  columns: z.number().int().default(3).describe('Number of board columns.'),
  gap: z.number().default(40).describe('Gap between slides in world px (the light gutter).'),
  width: z.number().default(2880).describe('Overall board width in world px (larger than canvas).'),
  rowHeight: z
    .number()
    .optional()
    .describe('Slide height in world px. Defaults to a 16:9 slide (column width × 9/16).'),
  padding: z.number().default(54).describe('Inner padding of each slide in px.'),
  heroIndex: z
    .number()
    .int()
    .default(4)
    .describe('Index of the slide the camera punches into when no `tour` is given.'),
  tour: z
    .any()
    .optional()
    .describe(
      'number[] — slide indices the camera tours in order (e.g. [4, 7, 10]); it flies + holds on each. Falls back to [heroIndex].',
    ),
  brandName: z.string().optional().describe('Wordmark shown in each slide’s top-left logo lockup.'),
  pushZoom: z
    .number()
    .optional()
    .describe('Camera zoom while framed on the hero. Omit to fill the hero ~90% of the viewport.'),
  boardZoom: z
    .number()
    .optional()
    .describe('Camera zoom showing the whole board. Omit to fit the board with a margin.'),
  driftX: z.number().default(240).describe('Horizontal world-px drift across the pan phase.'),
  driftY: z.number().default(120).describe('Vertical world-px drift across the pan phase.'),
  establishFrames: timeSchema
    .default(22)
    .describe('Frames holding on the whole board before the punch-in.'),
  punchFrames: timeSchema.default(16).describe('Frames of the fast punch-in to the hero.'),
  holdFrames: timeSchema.default(40).describe('Frames held framed on each tour slide.'),
  moveFrames: timeSchema.default(28).describe('Frames of each fly-over between tour stops.'),
  pullFrames: timeSchema.default(34).describe('Frames of the pull-back to the whole board.'),
  panFrames: timeSchema.default(132).describe('Frames of the slow pan/drift across the board.'),
  accentColor: z.string().optional().describe('Brand accent (logo mark, ticks, CTA). Default a corporate blue.'),
})

export type DeckFlyoverSchemaProps = z.infer<typeof deckFlyoverSchema>
