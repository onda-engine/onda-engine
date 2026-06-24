//! Runtime prop schema for {@link Notification} — @onda-native (mirrors NotificationProps).
//! The Studio agent generates against this and the preview/export renderer validates with it.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const notificationSchema = z.object({
  app: z.string().default('Onda').describe('App / sender name (small, top row).'),
  title: z.string().default('Your render is ready').describe('Notification title (bold).'),
  body: z
    .string()
    .default('Tap to watch — exported in 4K.')
    .describe('Notification body — one muted line.'),
  time: z.string().default('now').describe('Timestamp (faint, top-right).'),
  delay: timeSchema.default(0).describe('Frames before the entrance begins.'),
  width: z.number().default(720).describe('Panel width in px.'),
  accent: z.string().optional().describe('App-icon square fill (default: theme accent).'),
  glassTint: z
    .string()
    .optional()
    .describe('Frosted tint (hex #rrggbbaa) — the glass fill (default: a translucent surface).'),
  borderColor: z.string().optional().describe('Panel border color (default: theme border).'),
  color: z.string().optional().describe('Title color (default: theme text).'),
  dimColor: z.string().optional().describe('App / body / time color (default: theme textMuted).'),
  cornerRadius: z.number().default(28).describe('Corner radius in px.'),
  fontFamily: z.string().optional().describe('Font family (default: theme fontFamily).'),
})

export type NotificationSchemaProps = z.infer<typeof notificationSchema>
