//! Runtime prop schema for {@link SiteReveal} — @onda-native (mirrors SiteRevealProps).

import { z } from 'zod'

export const siteRevealSchema = z.object({
  src: z.string().default('').describe('Full-page screenshot (tall) — the homepage to scroll.'),
  url: z.string().default('').describe('Address-bar text.'),
  pageAspect: z.number().default(4.48).describe('Page height / width of src (drives the scroll extent).'),
  width: z.number().default(1360).describe('Card content width in px.'),
  height: z.number().default(770).describe('Viewport height in px below the chrome bar.'),
  offsetY: z.number().default(56).describe('Vertical nudge of the card from center (slightly low to leave room for a headline above).'),
  delay: z.number().int().default(0).describe('Frames before the card enters.'),
  typeUrl: z.boolean().default(true).describe('Type the URL into the address bar (with a blinking cursor) before scrolling.'),
  typeDurationInFrames: z.number().int().default(26).describe('Frames the URL takes to type in.'),
  scrollStart: z.number().default(0).describe('Page fraction (0..1) shown at the start of the scroll.'),
  scrollEnd: z.number().default(0.62).describe('Page fraction (0..1) reached at the end.'),
  scrollDurationInFrames: z.number().int().default(150).describe('Frames over which the scroll completes.'),
  surface: z.string().default('#fdfcf9').describe('Card body fill (near-white).'),
  barColor: z.string().default('#f1ece1').describe('Chrome bar fill (light warm gray).'),
  border: z.string().optional().describe('1px card border + chrome divider (defaults to theme border).'),
  dim: z.string().optional().describe('Address pill text color (defaults to theme textMuted).'),
  shadowColor: z.string().default('#2b201826').describe('Soft shadow color under the card.'),
  cardRadius: z.number().default(16).describe('Card corner radius in px.'),
})

export type SiteRevealSchemaProps = z.infer<typeof siteRevealSchema>
